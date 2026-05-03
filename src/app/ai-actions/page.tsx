// AI Aksiyon Merkezi — Faz 3.
//
// Faz 2'deki statik mimari kartları korunur; "Aktif Aksiyonlar" bölümü
// /api/ai-actions endpoint'inden canlı plan listesi çeker. Faz 3'te
// "Uygula" butonu yalnızca APPLICABLE_ACTION_TYPES için aktiftir ve
// ikinci onay modalı sonrası /api/ai-actions/apply endpoint'ine POST
// eder. Diğer aksiyon tipleri "Sadece İnceleme" / "Engelli" olarak
// disabled görünür.
//
// SAFETY:
// - Apply butonu sadece güvenli, düşürücü aksiyonlarda aktif.
// - Onay modalı olmadan POST gönderilmez (confirmApply=true zorunlu).
// - Server-side validator UI'dan gelen değerleri yeniden doğrular.
// - Live trading değişikliği, leverage artırma, Binance order yoktur.

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ActionPlan,
  ActionPlanResult,
  ActionPlanRiskLevel,
  ActionPlanType,
  HistoryItem,
  HistoryCategory,
  HistoryStatus,
} from "@/lib/ai-actions";
import { buildActionPrompt } from "@/lib/ai-actions/prompt-builder";
// Runtime label'ları doğrudan history modülünden al — index üzerinden
// gitmek decision-cache'in node:crypto bağımlılığını client bundle'a sızdırır.
import {
  HISTORY_STATUS_LABEL,
  HISTORY_CATEGORY_LABEL,
} from "@/lib/ai-actions/history";

type StatusTone = "success" | "warning" | "danger" | "muted" | "accent";

const TONE_CLASSES: Record<StatusTone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  muted: "text-muted",
  accent: "text-accent",
};

const TONE_BORDER: Record<StatusTone, string> = {
  success: "border-success/30 bg-success/10",
  warning: "border-warning/30 bg-warning/10",
  danger: "border-rose-500/30 bg-bg-soft",
  muted: "border-border bg-bg-soft",
  accent: "border-accent/30 bg-accent/10",
};

const RISK_TONE: Record<ActionPlanRiskLevel, StatusTone> = {
  low: "success",
  medium: "warning",
  high: "danger",
  critical: "danger",
};

const RISK_LABEL: Record<ActionPlanRiskLevel, string> = {
  low: "Düşük",
  medium: "Orta",
  high: "Yüksek",
  critical: "Kritik",
};

/** Faz 3'te apply edilebilir tipler. */
const APPLICABLE_TYPES: readonly ActionPlanType[] = [
  "UPDATE_RISK_PER_TRADE_DOWN",
  "UPDATE_MAX_DAILY_LOSS_DOWN",
  "UPDATE_MAX_OPEN_POSITIONS_DOWN",
  "UPDATE_MAX_DAILY_TRADES_DOWN",
  "SET_OBSERVATION_MODE",
] as const;

/** Faz 5'te rollback edilebilir tipler (yalnızca downward 4 tip). */
const ROLLBACK_ELIGIBLE_TYPES_UI: readonly string[] = [
  "UPDATE_RISK_PER_TRADE_DOWN",
  "UPDATE_MAX_DAILY_LOSS_DOWN",
  "UPDATE_MAX_OPEN_POSITIONS_DOWN",
  "UPDATE_MAX_DAILY_TRADES_DOWN",
] as const;

const DISMISS_KEY = "ai-actions:dismissed:v1";

function loadIdSet(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.map(String));
  } catch {
    // ignore
  }
  return new Set();
}

function saveIdSet(key: string, ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(Array.from(ids)));
  } catch {
    // ignore
  }
}

interface ApplyResult {
  planId: string;
  ok: boolean;
  status: "applied" | "observed" | "blocked" | "failed";
  message: string;
  oldValue?: string | null;
  newValue?: string | null;
}

interface RollbackNotice {
  ok: boolean;
  message: string;
}

interface RollbackModalState {
  item: HistoryItem;
}

interface AIDecisionSnapshot {
  status:
    | "NO_ACTION"
    | "OBSERVE"
    | "REVIEW_REQUIRED"
    | "CRITICAL_BLOCKER"
    | "DATA_INSUFFICIENT";
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  mainFinding: string;
  systemInterpretation: string;
  recommendation: string;
  actionType: string;
  confidence: number;
  observeDays: number;
  blockedBy: string[];
  fallbackReason?: string | null;
}

interface AIDecisionEnvelope {
  decision: AIDecisionSnapshot;
  generatedAt: string;
  ageSec: number;
  ttlSec: number;
  /** "cache" | "ai" | "ai_fallback" */
  source: string;
  sourceLabel: string;
  /** "fresh" | "stale_data" | "stale_ttl" | "no_cache" | "force_refresh" */
  cacheStatus: string;
  cacheStatusLabel: string;
  snapshotHash: string;
  fallbackReason?: string | null;
}

interface SystemHealth {
  workerOnline: boolean | null;
  workerStatus: string | null;
  binanceApiStatus: string | null;
  websocketStatus: string | null;
  lastHeartbeatAt: string | null;
  envOk: boolean | null;
  hardLiveTradingAllowed: boolean | null;
  enableLiveTrading: boolean | null;
  tradingMode: string | null;
}

const DECISION_LABEL: Record<AIDecisionSnapshot["status"], string> = {
  NO_ACTION: "Aksiyon Gerekmiyor",
  OBSERVE: "İnceleme Devam Ediyor",
  REVIEW_REQUIRED: "Manuel İnceleme Gerekli",
  CRITICAL_BLOCKER: "Kritik · Manuel İnceleme",
  DATA_INSUFFICIENT: "Veri Yetersiz",
};

const DECISION_TONE: Record<AIDecisionSnapshot["status"], StatusTone> = {
  NO_ACTION: "success",
  OBSERVE: "warning",
  REVIEW_REQUIRED: "warning",
  CRITICAL_BLOCKER: "danger",
  DATA_INSUFFICIENT: "muted",
};

const RISK_LEVEL_LABEL: Record<AIDecisionSnapshot["riskLevel"], string> = {
  LOW: "Düşük",
  MEDIUM: "Orta",
  HIGH: "Yüksek",
  CRITICAL: "Kritik",
};

const RISK_LEVEL_TONE: Record<AIDecisionSnapshot["riskLevel"], StatusTone> = {
  LOW: "success",
  MEDIUM: "warning",
  HIGH: "danger",
  CRITICAL: "danger",
};

export default function AIActionCenterPage() {
  const [data, setData] = useState<ActionPlanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<{ id: string; copied: boolean } | null>(
    null,
  );
  const [applyTarget, setApplyTarget] = useState<ActionPlan | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyResults, setApplyResults] = useState<Record<string, ApplyResult>>({});
  // Pasif entegrasyon — sistem sağlığı OTOMATİK fetch (LLM çağrısı yok).
  const [health, setHealth] = useState<SystemHealth | null>(null);
  // AI Karar Özeti — sayfa açıldığında otomatik /api/ai-actions/decision
  // çağrılır. Cache mantığı: snapshot hash değişmediyse ve TTL içindeyse
  // OpenAI çağrılmaz, cache'den döner. "Analizi Yenile" force=true ile
  // cache'i bypass eder.
  const [aiEnvelope, setAiEnvelope] = useState<AIDecisionEnvelope | null>(null);
  const [aiDecisionLoading, setAiDecisionLoading] = useState(false);
  const [aiDecisionError, setAiDecisionError] = useState<string | null>(null);
  const aiDecision = aiEnvelope?.decision ?? null;

  useEffect(() => {
    setDismissed(loadIdSet(DISMISS_KEY));
  }, []);

  // Sistem sağlığı — sayfa açıldığında lightweight endpoint'lerden okur.
  const fetchHealth = useCallback(async () => {
    try {
      const [statusRes, hbRes, envRes] = await Promise.all([
        fetch("/api/bot/status", { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => null),
        fetch("/api/bot/heartbeat", { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => null),
        fetch("/api/system/env-check", { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => null),
      ]);
      const next: SystemHealth = {
        workerOnline: hbRes?.data?.online ?? null,
        workerStatus: hbRes?.data?.status ?? null,
        binanceApiStatus: hbRes?.data?.binanceApiStatus ?? null,
        websocketStatus: hbRes?.data?.websocketStatus ?? null,
        lastHeartbeatAt: hbRes?.data?.lastHeartbeat ?? null,
        envOk: envRes?.data?.ok ?? null,
        hardLiveTradingAllowed:
          statusRes?.data?.hardLiveTradingAllowed ?? null,
        enableLiveTrading: statusRes?.data?.liveTrading ?? null,
        tradingMode: statusRes?.data?.debug?.tradingMode ?? null,
      };
      setHealth(next);
    } catch {
      setHealth(null);
    }
  }, []);

  useEffect(() => {
    void fetchHealth();
  }, [fetchHealth]);

  // AI karar — otomatik (cache + TTL) veya manuel override.
  // Sayfa açılışında ve plan refresh sonrası otomatik çağrılır.
  // OpenAI YALNIZCA snapshot değiştiyse veya TTL doldu ise tetiklenir.
  const refreshAIDecision = useCallback(
    async (opts?: { force?: boolean }) => {
      setAiDecisionLoading(true);
      setAiDecisionError(null);
      try {
        const url = opts?.force
          ? "/api/ai-actions/decision?force=true"
          : "/api/ai-actions/decision";
        const res = await fetch(url, { cache: "no-store" });
        const json = await res.json();
        if (!json.ok) {
          setAiDecisionError(json.error ?? "AI karar özeti alınamadı.");
          return;
        }
        setAiEnvelope(json.data as AIDecisionEnvelope);
      } catch (e) {
        setAiDecisionError(
          e instanceof Error ? e.message : "AI karar özeti alınamadı.",
        );
      } finally {
        setAiDecisionLoading(false);
      }
    },
    [],
  );

  // Otomatik fetch — sayfa açıldığında bir kez. Cache hit ise OpenAI çağrısı
  // yapılmaz; backend hash + TTL kontrolünü kendisi yönetir.
  useEffect(() => {
    void refreshAIDecision();
  }, [refreshAIDecision]);

  // ── Karar ve Aksiyon Geçmişi ──────────────────────────────────────────
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState<
    "all" | "applied" | "blocked" | "observation" | "decision" | "rollback"
  >("all");
  // Rollback state
  const [rollbackTarget, setRollbackTarget] = useState<RollbackModalState | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const [rollbackNotice, setRollbackNotice] = useState<RollbackNotice | null>(null);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch("/api/ai-actions/history?limit=50", {
        cache: "no-store",
      });
      const json = await res.json();
      if (!json.ok) {
        setHistoryError(json.error ?? "Aksiyon geçmişi alınamadı.");
        setHistoryItems([]);
        return;
      }
      setHistoryItems((json.data?.items ?? []) as HistoryItem[]);
    } catch (e) {
      setHistoryError(
        e instanceof Error ? e.message : "Aksiyon geçmişi alınamadı.",
      );
      setHistoryItems([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai-actions", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "Plan listesi alınamadı.");
        setData(null);
        return;
      }
      setData(json.data as ActionPlanResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Plan listesi alınamadı.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPlans();
  }, [fetchPlans]);

  const visiblePlans = useMemo(() => {
    if (!data?.plans) return [];
    return data.plans.filter((p) => !dismissed.has(p.id));
  }, [data, dismissed]);

  const submitRollback = useCallback(async () => {
    if (!rollbackTarget) return;
    setRollingBack(true);
    setRollbackError(null);
    try {
      const res = await fetch("/api/ai-actions/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          historyItemId: rollbackTarget.item.id,
          confirmRollback: true,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setRollbackError(json.error ?? "Geri alma başarısız.");
        return;
      }
      setRollbackTarget(null);
      setRollbackNotice({ ok: true, message: json.data?.message ?? "Aksiyon geri alındı." });
      await fetchHistory();
      await fetchPlans();
    } catch (e) {
      setRollbackError(e instanceof Error ? e.message : "Geri alma başarısız.");
    } finally {
      setRollingBack(false);
    }
  }, [rollbackTarget, fetchHistory, fetchPlans]);

  const dismissPlan = (id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveIdSet(DISMISS_KEY, next);
      return next;
    });
    if (openId === id) setOpenId(null);
  };

  const copyPrompt = async (plan: ActionPlan) => {
    const prompt = buildActionPrompt(plan);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(prompt);
      }
      setCopyState({ id: plan.id, copied: true });
      setTimeout(() => setCopyState(null), 2000);
    } catch {
      setCopyState({ id: plan.id, copied: false });
    }
  };

  const restoreDismissed = () => {
    setDismissed(new Set());
    saveIdSet(DISMISS_KEY, new Set());
  };

  const submitApply = useCallback(async () => {
    if (!applyTarget) return;
    setApplying(true);
    setApplyError(null);
    try {
      const res = await fetch("/api/ai-actions/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: applyTarget.id,
          actionType: applyTarget.type,
          recommendedValue: applyTarget.recommendedValue ?? "",
          confirmApply: true,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        const message = json.error ?? "Aksiyon uygulanamadı.";
        setApplyError(message);
        setApplyResults((prev) => ({
          ...prev,
          [applyTarget.id]: {
            planId: applyTarget.id,
            ok: false,
            status: (json.status as ApplyResult["status"]) ?? "failed",
            message,
            oldValue: json.oldValue ?? null,
            newValue: json.newValue ?? null,
          },
        }));
        return;
      }
      const status = json.data?.status as ApplyResult["status"];
      const message = json.data?.message ?? "Aksiyon uygulandı.";
      setApplyResults((prev) => ({
        ...prev,
        [applyTarget.id]: {
          planId: applyTarget.id,
          ok: true,
          status,
          message,
          oldValue: json.data?.oldValue ?? null,
          newValue: json.data?.newValue ?? null,
        },
      }));
      setApplyTarget(null);
      // Plan listesini yenile — yeni snapshot uygulanan değişikliği
      // sourceSnapshot.riskSettingsSummary'de yansıtmalı.
      await fetchPlans();
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : "Aksiyon uygulanamadı.");
    } finally {
      setApplying(false);
    }
  }, [applyTarget, fetchPlans]);

  const closeModal = () => {
    if (applying) return;
    setApplyTarget(null);
    setApplyError(null);
  };

  return (
    <div className="space-y-4">
      {/* Sayfa başlığı */}
      <div className="card">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-accent">AI Aksiyon Merkezi</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-300">
              CoinBot verilerini analiz eder, karar üretir ve onaylı
              aksiyonları GitHub ana kaynak, Vercel deploy ve VPS worker
              doğrulama akışına hazırlar.
            </p>
          </div>
          <span className="self-start rounded-full border border-warning/30 bg-warning/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-warning">
            Faz 3 · Onaylı Uygulama
          </span>
        </div>
        <p className="mt-2 rounded-md border border-border bg-bg-soft px-3 py-2 text-[11px] text-muted">
          {data?.phaseBanner ??
            "Faz 3: Sadece güvenli düşürücü aksiyonlar kullanıcı onayı ile uygulanabilir."}
        </p>
      </div>

      {/* A) Merkez Durum Kartları */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatusTile
          label="Sistem Durumu"
          value="Faz 3 · Onaylı Uygulama"
          hint="Düşürücü aksiyonlar uygulanabilir"
          tone="warning"
        />
        <StatusTile
          label="Yetki Modu"
          value="Approval Required"
          hint="İkinci onay modalı zorunlu"
          tone="accent"
        />
        <StatusTile
          label="Canlı İşlem"
          value="Kapalı"
          hint="HARD_LIVE_TRADING_ALLOWED=false"
          tone="success"
        />
        <StatusTile
          label="Ana Kaynak"
          value="GitHub"
          hint="onursuay/coinbot"
          tone="accent"
        />
      </div>

      {/* Sistem Sağlığı / Karar Durumu */}
      <SystemHealthSection
        health={health}
        decision={aiDecision}
        decisionLoading={aiDecisionLoading}
        decisionEnvelope={aiEnvelope}
      />

      {/* Son AI Karar Özeti — otomatik cache + manuel override */}
      <LatestAIDecisionSection
        envelope={aiEnvelope}
        loading={aiDecisionLoading}
        error={aiDecisionError}
        onForceRefresh={() => refreshAIDecision({ force: true })}
      />

      {/* Aktif Aksiyonlar (canlı) */}
      <section className="card">
        <SectionHeader
          eyebrow="Aktif Aksiyonlar"
          title="Üretilen plan listesi"
          subtitle="Generator deterministiktir. Apply yalnızca güvenli düşürücü tiplerde aktiftir; her uygulama ikinci onay gerektirir."
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fetchPlans()}
            disabled={loading}
            className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition hover:border-accent/60 disabled:opacity-50"
          >
            {loading ? "Yükleniyor…" : "Yenile"}
          </button>
          {dismissed.size > 0 && (
            <button
              type="button"
              onClick={restoreDismissed}
              className="rounded-lg border border-border bg-bg-soft px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-accent/40 hover:text-accent"
            >
              Geçilenleri geri yükle ({dismissed.size})
            </button>
          )}
          {data?.generatedAt && (
            <span className="text-[11px] text-muted">
              Snapshot: {new Date(data.generatedAt).toLocaleString("tr-TR")}
            </span>
          )}
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-rose-500/30 bg-bg-soft px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}

        {!error && visiblePlans.length === 0 && !loading && (
          <div className="mt-3 rounded-lg border border-dashed border-border bg-bg-soft px-4 py-8 text-center">
            <p className="text-sm font-medium text-slate-200">
              Şu an aktif öneri yok.
            </p>
            <p className="mt-1 text-xs text-muted">
              Sistem mevcut veriye göre güvenli bir öneri çıkarmadı; bot
              çalışmaya devam ettikçe tekrar değerlendirilir.
            </p>
          </div>
        )}

        {!error && visiblePlans.length > 0 && (
          <div className="mt-3 space-y-2">
            {visiblePlans.map((plan) => (
              <PlanRow
                key={plan.id}
                plan={plan}
                isOpen={openId === plan.id}
                applyResult={applyResults[plan.id]}
                onToggleDetail={() =>
                  setOpenId((cur) => (cur === plan.id ? null : plan.id))
                }
                onApplyClick={() => {
                  setApplyError(null);
                  setApplyTarget(plan);
                }}
                onDismiss={() => dismissPlan(plan.id)}
                onPrompt={() => copyPrompt(plan)}
                copyState={copyState}
              />
            ))}
          </div>
        )}

        {data?.sourceSnapshot && (
          <div className="mt-4 rounded-lg border border-border bg-bg-soft px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              Kaynak Snapshot
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] text-slate-300 sm:grid-cols-3 lg:grid-cols-4">
              <SnapItem
                k="Kapanan İşlem"
                v={String(data.sourceSnapshot.closedTrades)}
              />
              <SnapItem
                k="Açık Pozisyon"
                v={String(data.sourceSnapshot.openPositions)}
              />
              <SnapItem k="Toplam P&L" v={fmtUsd(data.sourceSnapshot.totalPnl)} />
              <SnapItem k="Günlük P&L" v={fmtUsd(data.sourceSnapshot.dailyPnl)} />
              <SnapItem
                k="Kazanma Oranı"
                v={`%${data.sourceSnapshot.winRate.toFixed(1)}`}
              />
              <SnapItem
                k="Profit Factor"
                v={data.sourceSnapshot.profitFactor.toFixed(2)}
              />
              <SnapItem
                k="Maks. Drawdown"
                v={`%${data.sourceSnapshot.maxDrawdownPercent.toFixed(1)}`}
              />
              <SnapItem
                k="Risk / İşlem"
                v={`%${data.sourceSnapshot.riskSettingsSummary.riskPerTradePercent.toFixed(1)}`}
              />
              <SnapItem
                k="Günlük Maks. Zarar"
                v={`%${data.sourceSnapshot.riskSettingsSummary.dailyMaxLossPercent.toFixed(1)}`}
              />
              <SnapItem
                k="Maks. Açık Pozisyon"
                v={String(
                  data.sourceSnapshot.riskSettingsSummary
                    .dynamicMaxOpenPositions,
                )}
              />
            </div>
          </div>
        )}
      </section>

      {/* Rollback notice */}
      {rollbackNotice && (
        <div
          className={`rounded-md border px-3 py-2 text-sm flex items-start justify-between gap-3 ${
            rollbackNotice.ok
              ? "border-success/30 bg-success/10 text-success"
              : "border-rose-500/30 bg-bg-soft text-danger"
          }`}
          role="status"
        >
          <span>{rollbackNotice.message}</span>
          <button
            type="button"
            onClick={() => setRollbackNotice(null)}
            className="text-xs opacity-70 hover:opacity-100 underline shrink-0"
          >
            kapat
          </button>
        </div>
      )}

      {/* Karar ve Aksiyon Geçmişi */}
      <HistorySection
        items={historyItems}
        loading={historyLoading}
        error={historyError}
        filter={historyFilter}
        onFilterChange={setHistoryFilter}
        onRefresh={fetchHistory}
        onRollback={(item) => {
          setRollbackError(null);
          setRollbackTarget({ item });
        }}
      />

      {/* B) Proje Kaynakları */}
      <section className="card">
        <SectionHeader
          eyebrow="B · Proje Kaynakları"
          title="Aksiyonlar bu kaynaklar üzerinde yürür"
          subtitle="Bu fazda kartlar yalnızca statik bilgi gösterir; GitHub / Vercel / SSH bağlantısı yapılmaz."
        />
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <ResourceCard
            code="GH"
            label="GitHub"
            statusLabel="Ana Kaynak"
            statusTone="success"
            rows={[
              { k: "Repo", v: "onursuay/coinbot" },
              { k: "URL", v: "https://github.com/onursuay/coinbot" },
              { k: "Branch", v: "main" },
            ]}
            futureRole="Branch / commit / PR aksiyon akışı (Faz 4+)"
          />
          <ResourceCard
            code="VC"
            label="Vercel"
            statusLabel="Deploy Kaynağı"
            statusTone="accent"
            rows={[
              { k: "Canlı URL", v: "https://coin.onursuay.com" },
              { k: "Trigger", v: "GitHub main push" },
              { k: "Kapsam", v: "Dashboard + API routes" },
            ]}
            futureRole="Deploy takibi ve doğrulama (Faz 5)"
          />
          <ResourceCard
            code="VPS"
            label="VPS Worker"
            statusLabel="Worker Runtime"
            statusTone="warning"
            rows={[
              { k: "Sağlayıcı", v: "Hostinger VPS" },
              { k: "Yol", v: "/opt/coinbot" },
              { k: "Runtime", v: "Docker · Node.js" },
            ]}
            futureRole="Worker deploy / heartbeat / log doğrulama (Faz 5-6)"
          />
          <ResourceCard
            code="LP"
            label="Lokal Proje"
            statusLabel="Senkron Ortam"
            statusTone="muted"
            rows={[
              {
                k: "Yol",
                v: "/Users/onursuay/Desktop/Onur Suay/Web Siteleri/coinbot",
              },
              { k: "Senkron", v: "git pull origin main" },
              { k: "Rol", v: "Geliştirme / inceleme" },
            ]}
            futureRole="GitHub'dan git pull ile senkron kalır"
          />
        </div>
      </section>

      {/* D) Yetki Modeli */}
      <section className="card">
        <SectionHeader
          eyebrow="D · Yetki Modeli"
          title="Her aksiyon bir yetki seviyesinde çalışır"
          subtitle="Aktif faz: Approval Required. observe_only ve prompt_only koruma altında."
        />
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <AuthorityCard
            level="observe_only"
            title="Sadece Analiz"
            tone="muted"
            active={false}
            scope="Karar üretir, prompt üretmez. Performans raporu, gözlem önerisi."
          />
          <AuthorityCard
            level="prompt_only"
            title="Prompt Üretir"
            tone="accent"
            active={false}
            scope="Claude Code / GitHub promptu üretir. Kullanıcı manuel uygular."
          />
          <AuthorityCard
            level="approval_required"
            title="Onay Gerekir"
            tone="warning"
            active={true}
            scope="Düşürücü risk ayarları için kullanıcı onayı şart. Apply ikinci onay sonrası DB'ye yazılır."
          />
          <AuthorityCard
            level="blocked"
            title="Engellendi"
            tone="danger"
            active={false}
            scope="Live trading açma, MIN_SIGNAL_CONFIDENCE düşürme, BTC trend kapatma."
          />
        </div>
      </section>

      {/* E) MVP Kapsam */}
      <section className="card">
        <SectionHeader
          eyebrow="E · MVP Kapsam"
          title="İlk sürümde olacaklar / olmayacaklar"
        />
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <ScopeColumn
            title="Olacaklar"
            tone="success"
            items={[
              "Performans analizi",
              "Kâr/Zarar kök neden analizi",
              "Scanner engel analizi",
              "Risk öneri kartları",
              "Kullanıcı onaylı düşürücü aksiyon uygulama",
              "Aksiyon geçmişi (bot_logs)",
            ]}
          />
          <ScopeColumn
            title="Olmayacaklar"
            tone="danger"
            items={[
              "Otomatik kod değiştirme",
              "Otomatik GitHub commit",
              "Otomatik Vercel deploy",
              "Otomatik VPS deploy",
              "Live trading değişikliği",
              "Risk parametre artırma",
            ]}
          />
        </div>
      </section>

      {/* F · Güvenlik Sınırları */}
      <SafetyBoundsCard />

      {/* Geri linki */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <Link
          href="/"
          className="rounded-lg border border-border bg-bg-soft px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-accent/40 hover:text-accent"
        >
          ← Genel Bakış&apos;a dön
        </Link>
      </div>

      {/* Onay Modal — Faz 3 ikinci onay */}
      {applyTarget && (
        <ApplyModal
          plan={applyTarget}
          applying={applying}
          error={applyError}
          onCancel={closeModal}
          onConfirm={submitApply}
        />
      )}

      {/* Geri Alma Modal — Faz 5 */}
      {rollbackTarget && (
        <RollbackModal
          state={rollbackTarget}
          rollingBack={rollingBack}
          error={rollbackError}
          onCancel={() => { setRollbackTarget(null); setRollbackError(null); }}
          onConfirm={submitRollback}
        />
      )}
    </div>
  );
}

// ─── Sub components ───────────────────────────────────────────────────────────

function SectionHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-accent">
        {eyebrow}
      </div>
      <div className="text-sm font-semibold text-slate-100">{title}</div>
      {subtitle && <div className="text-xs text-muted">{subtitle}</div>}
    </div>
  );
}

function SystemHealthSection({
  health,
  decision,
  decisionLoading,
  decisionEnvelope,
}: {
  health: SystemHealth | null;
  decision: AIDecisionSnapshot | null;
  decisionLoading: boolean;
  decisionEnvelope?: AIDecisionEnvelope | null;
}) {
  const liveOff =
    health?.hardLiveTradingAllowed === false ||
    health?.enableLiveTrading === false;

  const decisionStatus = decision?.status ?? null;
  const decisionTone: StatusTone = decisionStatus
    ? DECISION_TONE[decisionStatus]
    : "muted";
  const decisionLabel = decisionLoading
    ? "Yükleniyor…"
    : decisionStatus
    ? DECISION_LABEL[decisionStatus]
    : "Henüz analiz çalıştırılmadı";

  return (
    <section className="card">
      <SectionHeader
        eyebrow="Sistem Sağlığı"
        title="Bot durumu, paper modu ve güvenlik kilitleri"
        subtitle="Bu bilgiler dahili durum endpoint'lerinden okunur; LLM çağrısı yapmaz."
      />
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatusTile
          label="Bot Durumu"
          value={
            health?.workerStatus
              ? statusLabel(health.workerStatus)
              : health?.workerOnline === false
              ? "Çevrimdışı"
              : "Bekleniyor"
          }
          hint={
            health?.workerOnline
              ? `Worker online · last hb ${
                  health.lastHeartbeatAt
                    ? new Date(health.lastHeartbeatAt).toLocaleTimeString("tr-TR")
                    : "—"
                }`
              : "Heartbeat verisi yok"
          }
          tone={
            health?.workerOnline
              ? health?.workerStatus === "running_paper"
                ? "success"
                : "warning"
              : "muted"
          }
        />
        <StatusTile
          label="Trading Modu"
          value={(health?.tradingMode ?? "paper").toUpperCase()}
          hint="DEFAULT_TRADING_MODE=paper"
          tone="success"
        />
        <StatusTile
          label="Canlı İşlem Kilidi"
          value={liveOff ? "KAPALI" : health == null ? "—" : "AÇIK"}
          hint="HARD_LIVE_TRADING_ALLOWED=false"
          tone={liveOff ? "success" : health == null ? "muted" : "danger"}
        />
        <StatusTile
          label="Karar Durumu"
          value={decisionLabel}
          hint={
            decision?.fallbackReason
              ? `Fallback: ${decision.fallbackReason}`
              : decisionEnvelope?.generatedAt
              ? `Son analiz: ${new Date(decisionEnvelope.generatedAt).toLocaleTimeString("tr-TR")} (${decisionEnvelope.sourceLabel})`
              : "Otomatik kontrol bekleniyor"
          }
          tone={decisionTone}
        />
      </div>
    </section>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case "running_paper":
      return "Paper · Aktif";
    case "running_live":
      return "Live · Aktif";
    case "paused":
      return "Duraklatıldı";
    case "kill_switch":
      return "Kill Switch";
    case "stopped":
      return "Durdu";
    default:
      return status.toUpperCase();
  }
}

function LatestAIDecisionSection({
  envelope,
  loading,
  error,
  onForceRefresh,
}: {
  envelope: AIDecisionEnvelope | null;
  loading: boolean;
  error: string | null;
  onForceRefresh: () => void;
}) {
  const decision = envelope?.decision ?? null;
  const isCache = envelope?.source === "cache";
  const isFallback =
    envelope?.source === "ai_fallback" || decision?.fallbackReason;

  // Kaynak rozeti tonu
  const sourceTone: StatusTone = isCache
    ? "muted"
    : isFallback
    ? "warning"
    : "success";

  return (
    <section className="card">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <SectionHeader
          eyebrow="Son AI Karar Özeti"
          title="Yorumlayıcı analiz (cache + TTL)"
          subtitle="Sayfa otomatik kontrol eder; OpenAI yalnızca veri değiştiyse veya TTL doldu ise tetiklenir. 'Analizi Yenile' manuel override'dır."
        />
        <button
          type="button"
          onClick={onForceRefresh}
          disabled={loading}
          className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition hover:border-accent/70 hover:bg-accent/15 disabled:opacity-50"
        >
          {loading ? "Analiz çalışıyor…" : "Analizi Yenile"}
        </button>
      </div>

      {!envelope && !loading && !error && (
        <p className="mt-3 rounded-md border border-dashed border-border bg-bg-soft px-3 py-3 text-xs text-muted">
          Henüz AI karar özeti üretilmedi.
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-md border border-rose-500/30 bg-bg-soft px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      {envelope && decision && (
        <div className="mt-3 space-y-3">
          {/* Cache / kaynak meta bandı */}
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-bg-soft px-3 py-2">
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${TONE_BORDER[sourceTone]} ${TONE_CLASSES[sourceTone]}`}
            >
              Kaynak: {envelope.sourceLabel}
            </span>
            <span className="rounded-full border border-border bg-bg-card px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
              Durum: {envelope.cacheStatusLabel}
            </span>
            <span className="text-[11px] text-muted">
              Son analiz: {fmtRelativeAge(envelope.ageSec)} ·{" "}
              {new Date(envelope.generatedAt).toLocaleTimeString("tr-TR")}
            </span>
            <span className="text-[11px] text-muted">
              TTL: {Math.round(envelope.ttlSec / 60)} dk
            </span>
            <span className="font-mono text-[10px] text-muted">
              hash: {envelope.snapshotHash.slice(0, 10)}…
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${TONE_BORDER[DECISION_TONE[decision.status]]} ${TONE_CLASSES[DECISION_TONE[decision.status]]}`}
            >
              {DECISION_LABEL[decision.status]}
            </span>
            <span
              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${TONE_BORDER[RISK_LEVEL_TONE[decision.riskLevel]]} ${TONE_CLASSES[RISK_LEVEL_TONE[decision.riskLevel]]}`}
            >
              Risk: {RISK_LEVEL_LABEL[decision.riskLevel]}
            </span>
            <span className="rounded-full border border-border bg-bg-card px-2 py-0.5 font-mono text-[10px] text-muted">
              {decision.actionType}
            </span>
            <span className="rounded-full border border-border bg-bg-card px-2 py-0.5 text-[10px] font-semibold text-slate-300">
              Güven: %{decision.confidence}
            </span>
            {decision.observeDays > 0 && (
              <span className="rounded-full border border-border bg-bg-card px-2 py-0.5 text-[10px] font-semibold text-muted">
                Gözlem önerisi: {decision.observeDays} gün
              </span>
            )}
            {isFallback && (
              <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning">
                Fallback
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
            <DecisionPanel title="Ana Bulgu" body={decision.mainFinding} />
            <DecisionPanel
              title="Sistem Yorumu"
              body={decision.systemInterpretation}
            />
            <DecisionPanel title="Öneri" body={decision.recommendation} />
          </div>
          {decision.blockedBy.length > 0 && (
            <div className="rounded-md border border-rose-500/30 bg-bg-card px-3 py-2 text-[11px] text-danger">
              <span className="font-semibold">Bloke nedenleri: </span>
              {decision.blockedBy.join(", ")}
            </div>
          )}
          <p className="text-[11px] text-muted">
            Not: Bu özet pasif analiz çıktısıdır. Prompt üretimi ve uygulanabilir
            kararlar &quot;Aktif Aksiyonlar&quot; bölümünde listelenir.
          </p>
        </div>
      )}
    </section>
  );
}

type HistoryFilterKey =
  | "all"
  | "applied"
  | "blocked"
  | "observation"
  | "decision"
  | "rollback";

const HISTORY_STATUS_TONE: Record<HistoryStatus, StatusTone> = {
  applied: "success",
  blocked: "danger",
  failed: "danger",
  observed: "warning",
  requested: "muted",
  refreshed: "accent",
  cache_hit: "muted",
  cache_miss: "muted",
  fallback: "warning",
  rollback_applied: "accent",
  rollback_blocked: "danger",
  rollback_failed: "danger",
};

function applyHistoryFilter(items: HistoryItem[], f: HistoryFilterKey): HistoryItem[] {
  if (f === "all") return items;
  if (f === "applied") return items.filter((i) => i.status === "applied");
  if (f === "blocked")
    return items.filter((i) => i.status === "blocked" || i.status === "failed");
  if (f === "observation")
    return items.filter((i) => i.category === "observation");
  if (f === "decision") return items.filter((i) => i.category === "decision");
  if (f === "rollback")
    return items.filter(
      (i) =>
        i.status === "rollback_applied" ||
        i.status === "rollback_blocked" ||
        i.status === "rollback_failed" ||
        i.eventType === "ai_action_rollback_requested",
    );
  return items;
}

function HistorySection({
  items,
  loading,
  error,
  filter,
  onFilterChange,
  onRefresh,
  onRollback,
}: {
  items: HistoryItem[];
  loading: boolean;
  error: string | null;
  filter: HistoryFilterKey;
  onFilterChange: (f: HistoryFilterKey) => void;
  onRefresh: () => void;
  onRollback?: (item: HistoryItem) => void;
}) {
  // Build set of already-rolled-back event IDs from history.
  const rolledBackIds = new Set<string>(
    items
      .filter((i) => i.eventType === "ai_action_rollback_applied")
      .map((i) => String((i.metadataSafe as Record<string, unknown>).rollbackOfEventId ?? ""))
      .filter(Boolean),
  );

  const filtered = applyHistoryFilter(items, filter).slice(0, 20);
  const filters: { key: HistoryFilterKey; label: string }[] = [
    { key: "all", label: "Tümü" },
    { key: "applied", label: "Uygulanan" },
    { key: "blocked", label: "Engellenen" },
    { key: "observation", label: "Gözlem" },
    { key: "decision", label: "AI Yorum" },
    { key: "rollback", label: "Geri Alınanlar" },
  ];

  return (
    <section className="card" data-testid="ai-action-history">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <SectionHeader
          eyebrow="Karar ve Aksiyon Geçmişi"
          title="Son kayıtlar (bot_logs üzerinden)"
          subtitle="Apply / observation / AI yorum cache event'leri kronolojik sıralanır. Read-only; secret'lar redacted."
        />
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition hover:border-accent/60 disabled:opacity-50"
        >
          {loading ? "Yükleniyor…" : "Yenile"}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => onFilterChange(f.key)}
            className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
              filter === f.key
                ? "border-accent/60 bg-accent/15 text-accent"
                : "border-border bg-bg-soft text-slate-300 hover:border-accent/40 hover:text-accent"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-3 rounded-md border border-rose-500/30 bg-bg-soft px-3 py-2 text-xs text-danger">
          Aksiyon geçmişi alınamadı: {error}
        </p>
      )}

      {!error && filtered.length === 0 && !loading && (
        <p className="mt-3 rounded-md border border-dashed border-border bg-bg-soft px-3 py-3 text-center text-xs text-muted">
          Henüz aksiyon geçmişi yok.
        </p>
      )}

      {!error && filtered.length > 0 && (
        <ul className="mt-3 space-y-2">
          {filtered.map((it) => {
            const rollbackEligible =
              onRollback != null &&
              it.eventType === "ai_action_applied" &&
              it.actionType != null &&
              ROLLBACK_ELIGIBLE_TYPES_UI.includes(it.actionType) &&
              it.oldValue != null &&
              it.newValue != null;
            const alreadyRolledBack = rolledBackIds.has(it.id);
            return (
              <HistoryRow
                key={it.id}
                item={it}
                rollbackEligible={rollbackEligible && !alreadyRolledBack}
                alreadyRolledBack={rollbackEligible && alreadyRolledBack}
                onRollback={onRollback ? () => onRollback(it) : undefined}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}

function HistoryRow({
  item,
  rollbackEligible = false,
  alreadyRolledBack = false,
  onRollback,
}: {
  item: HistoryItem;
  rollbackEligible?: boolean;
  alreadyRolledBack?: boolean;
  onRollback?: () => void;
}) {
  const tone = HISTORY_STATUS_TONE[item.status] ?? "muted";
  const time = new Date(item.createdAt);
  const timeStr = isNaN(time.getTime())
    ? item.createdAt
    : time.toLocaleString("tr-TR");
  return (
    <li className="rounded-lg border border-border bg-bg-soft px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-100">
              {item.title}
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${TONE_BORDER[tone]} ${TONE_CLASSES[tone]}`}
            >
              {HISTORY_STATUS_LABEL[item.status]}
            </span>
            <span className="rounded-full border border-border bg-bg-card px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
              {HISTORY_CATEGORY_LABEL[item.category]}
            </span>
            {item.actionType && (
              <span className="rounded-full border border-border bg-bg-card px-2 py-0.5 font-mono text-[10px] tracking-wider text-muted">
                {item.actionType}
              </span>
            )}
            {alreadyRolledBack && (
              <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
                Geri Alındı
              </span>
            )}
          </div>
          {item.summary && (
            <p className="mt-1 truncate text-[12px] text-slate-300">
              {item.summary}
            </p>
          )}
          {(item.oldValue || item.newValue) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="rounded border border-border bg-bg-card px-2 py-0.5 font-mono text-slate-300">
                {item.oldValue ?? "—"}
              </span>
              <span className="text-muted">→</span>
              <span
                className={`rounded border px-2 py-0.5 font-mono ${TONE_BORDER[tone]} ${TONE_CLASSES[tone]}`}
              >
                {item.newValue ?? "—"}
              </span>
              {typeof item.confidence === "number" && (
                <span className="text-muted">Güven: %{item.confidence}</span>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5 text-right">
          <span className="text-[10px] uppercase tracking-wider text-muted">
            {timeStr}
          </span>
          {item.source && (
            <span className="font-mono text-[10px] text-muted">
              {item.source}
            </span>
          )}
          {rollbackEligible && onRollback && (
            <button
              type="button"
              onClick={onRollback}
              className="rounded-md border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning transition hover:border-warning/70 hover:bg-warning/20"
              title="Bu aksiyonu önceki değere geri al"
            >
              Geri Al
            </button>
          )}
          {alreadyRolledBack && (
            <span className="rounded-md border border-border bg-bg-card px-2 py-0.5 text-[10px] font-semibold text-muted cursor-default">
              Geri Alındı
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

function fmtRelativeAge(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  if (sec < 60) return `${sec} sn önce`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} dk önce`;
  const h = Math.round(min / 60);
  return `${h} sa önce`;
}

function DecisionPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-border bg-bg-card/50 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-accent">
        {title}
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-slate-200">
        {body || "—"}
      </p>
    </div>
  );
}

function SafetyBoundsCard() {
  const items: { label: string; tone: StatusTone; detail: string }[] = [
    {
      label: "Live trading",
      tone: "danger",
      detail: "Blocked. HARD_LIVE_TRADING_ALLOWED=false korunur; toggle açılamaz.",
    },
    {
      label: "Risk parametreleri",
      tone: "warning",
      detail:
        "Yalnızca kullanıcı onayıyla, yalnızca düşürme yönünde değişebilir; otomatik artırma yoktur.",
    },
    {
      label: "Worker / trade engine",
      tone: "warning",
      detail:
        "AI Aksiyon Merkezi worker'a, signal-engine'e veya risk-engine'e doğrudan dokunmaz.",
    },
    {
      label: "Pasif analiz",
      tone: "muted",
      detail:
        "Son AI Karar Özeti yalnızca yorum üretir; ayar uygulamaz, emir göndermez.",
    },
  ];
  return (
    <section className="card">
      <SectionHeader
        eyebrow="F · Güvenlik Sınırları"
        title="Bu fazda neler yapılmaz"
        subtitle="Aksiyon Merkezi'nin uyduğu sıkı kurallar — kod ve test'lerle korunur."
      />
      <ul className="mt-3 space-y-2">
        {items.map((it) => (
          <li
            key={it.label}
            className={`rounded-md border px-3 py-2 ${TONE_BORDER[it.tone]}`}
          >
            <div
              className={`text-[11px] font-semibold uppercase tracking-wider ${TONE_CLASSES[it.tone]}`}
            >
              {it.label}
            </div>
            <p className="mt-0.5 text-[12px] leading-relaxed text-slate-200">
              {it.detail}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatusTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: StatusTone;
}) {
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${TONE_BORDER[tone]}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </div>
      <div className={`mt-1 text-sm font-semibold ${TONE_CLASSES[tone]}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-muted">{hint}</div>
    </div>
  );
}

function ResourceCard({
  code,
  label,
  statusLabel,
  statusTone,
  rows,
  futureRole,
}: {
  code: string;
  label: string;
  statusLabel: string;
  statusTone: StatusTone;
  rows: { k: string; v: string }[];
  futureRole: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-soft px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex h-6 w-9 items-center justify-center rounded border border-border bg-bg-card text-[10px] font-black tracking-wider text-slate-300">
            {code}
          </span>
          <span className="truncate text-sm font-semibold text-slate-100">
            {label}
          </span>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${TONE_BORDER[statusTone]} ${TONE_CLASSES[statusTone]}`}
        >
          {statusLabel}
        </span>
      </div>
      <dl className="mt-2.5 space-y-1">
        {rows.map((row) => (
          <div
            key={row.k}
            className="flex items-start justify-between gap-3 text-[11px]"
          >
            <dt className="shrink-0 uppercase tracking-wider text-muted">{row.k}</dt>
            <dd className="truncate text-right font-mono text-slate-300">{row.v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 rounded-md border border-border/70 bg-bg-card/50 px-2.5 py-1.5 text-[11px] text-muted">
        <span className="font-semibold text-slate-300">Gelecek rol: </span>
        {futureRole}
      </div>
    </div>
  );
}

function AuthorityCard({
  level,
  title,
  tone,
  active,
  scope,
}: {
  level: string;
  title: string;
  tone: StatusTone;
  active: boolean;
  scope: string;
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-2.5 ${
        active ? TONE_BORDER[tone] : "border-border bg-bg-soft"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`text-sm font-semibold ${TONE_CLASSES[tone]}`}>
          {title}
        </span>
        {active ? (
          <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success">
            Aktif
          </span>
        ) : (
          <span className="rounded-full border border-border bg-bg-card px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
            Planlandı
          </span>
        )}
      </div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted">
        {level}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-300">{scope}</p>
    </div>
  );
}

function ScopeColumn({
  title,
  tone,
  items,
}: {
  title: string;
  tone: StatusTone;
  items: string[];
}) {
  const symbol = tone === "success" ? "✓" : "✕";
  return (
    <div className={`rounded-lg border px-3 py-3 ${TONE_BORDER[tone]}`}>
      <div
        className={`text-[11px] font-semibold uppercase tracking-wider ${TONE_CLASSES[tone]}`}
      >
        {title}
      </div>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li
            key={item}
            className="flex items-start gap-2 text-[12px] text-slate-200"
          >
            <span className={`mt-0.5 font-bold ${TONE_CLASSES[tone]}`}>
              {symbol}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlanRow({
  plan,
  isOpen,
  applyResult,
  onToggleDetail,
  onApplyClick,
  onDismiss,
  onPrompt,
  copyState,
}: {
  plan: ActionPlan;
  isOpen: boolean;
  applyResult?: ApplyResult;
  onToggleDetail: () => void;
  onApplyClick: () => void;
  onDismiss: () => void;
  onPrompt: () => void;
  copyState: { id: string; copied: boolean } | null;
}) {
  const riskTone = RISK_TONE[plan.riskLevel];
  const isCopied = copyState?.id === plan.id && copyState.copied;
  const blocked = !plan.allowed;
  const isApplied = applyResult?.ok && applyResult.status === "applied";
  const isObserved = applyResult?.ok && applyResult.status === "observed";
  const applyFailed = applyResult && !applyResult.ok;

  const isApplicable = (APPLICABLE_TYPES as readonly string[]).includes(plan.type);

  let applyBtnLabel: string;
  let applyBtnDisabled: boolean;
  let applyBtnTitle: string | undefined;
  let applyBtnClasses: string;
  if (blocked) {
    applyBtnLabel = "Engelli";
    applyBtnDisabled = true;
    applyBtnTitle = "Plan generator tarafından bloke edildi.";
    applyBtnClasses =
      "cursor-not-allowed border-rose-500/30 bg-bg-card text-danger opacity-70";
  } else if (!isApplicable) {
    applyBtnLabel = "Sadece İnceleme";
    applyBtnDisabled = true;
    applyBtnTitle = "Bu aksiyon tipi sadece inceleme/prompt amaçlıdır; uygulanmaz.";
    applyBtnClasses =
      "cursor-not-allowed border-border bg-bg-card text-muted opacity-70";
  } else if (isApplied) {
    applyBtnLabel = "Uygulandı";
    applyBtnDisabled = true;
    applyBtnTitle = applyResult?.message;
    applyBtnClasses =
      "cursor-default border-success/40 bg-success/10 text-success";
  } else if (isObserved) {
    applyBtnLabel = "Gözlemde";
    applyBtnDisabled = true;
    applyBtnTitle = applyResult?.message;
    applyBtnClasses =
      "cursor-default border-warning/30 bg-warning/10 text-warning";
  } else {
    applyBtnLabel = "Uygula";
    applyBtnDisabled = false;
    applyBtnClasses =
      "border-success/40 bg-success/10 text-success hover:border-success/70";
  }

  return (
    <div
      className={`rounded-lg border px-3 py-3 ${
        blocked
          ? "border-rose-500/30 bg-bg-soft"
          : isApplied
          ? "border-success/30 bg-success/5"
          : isObserved
          ? "border-warning/30 bg-warning/5"
          : "border-border bg-bg-soft"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-100">
              {plan.title}
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${TONE_BORDER[riskTone]} ${TONE_CLASSES[riskTone]}`}
            >
              {RISK_LABEL[plan.riskLevel]}
            </span>
            <span className="rounded-full border border-border bg-bg-card px-2 py-0.5 font-mono text-[10px] tracking-wider text-muted">
              {plan.type}
            </span>
            {isApplied && (
              <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success">
                Uygulandı
              </span>
            )}
            {isObserved && (
              <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning">
                Gözlemde
              </span>
            )}
            {blocked && (
              <span className="rounded-full border border-rose-500/30 bg-bg-card px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-danger">
                Bloke
              </span>
            )}
          </div>
          <p className="mt-1.5 text-xs text-slate-300">{plan.summary}</p>

          {(plan.currentValue || plan.recommendedValue) && (
            <div className="mt-2 flex items-center gap-2 text-[11px]">
              <span className="rounded border border-border bg-bg-card px-2 py-0.5 font-mono text-slate-300">
                {plan.currentValue ?? "—"}
              </span>
              <span className="text-muted">→</span>
              <span
                className={`rounded border px-2 py-0.5 font-mono ${TONE_BORDER[riskTone]} ${TONE_CLASSES[riskTone]}`}
              >
                {plan.recommendedValue ?? "—"}
              </span>
              <span className="text-[11px] text-muted">
                Güven: %{plan.confidence}
              </span>
            </div>
          )}

          {applyFailed && (
            <p className="mt-2 rounded-md border border-rose-500/30 bg-bg-card px-2 py-1 text-[11px] text-danger">
              Aksiyon uygulanamadı: {applyResult.message}
            </p>
          )}
          {(isApplied || isObserved) && applyResult?.message && (
            <p
              className={`mt-2 rounded-md border px-2 py-1 text-[11px] ${
                isApplied
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-warning/30 bg-warning/10 text-warning"
              }`}
            >
              {applyResult.message}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={onToggleDetail}
            className="rounded-md border border-border bg-bg-card px-2.5 py-1 text-[11px] font-semibold text-slate-200 transition hover:border-accent/40 hover:text-accent"
          >
            {isOpen ? "Detayı Gizle" : "Detay"}
          </button>
          <button
            type="button"
            onClick={onPrompt}
            className="rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-semibold text-accent transition hover:border-accent/60"
          >
            {isCopied ? "Kopyalandı ✓" : "Prompt"}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md border border-border bg-bg-card px-2.5 py-1 text-[11px] font-semibold text-muted transition hover:border-rose-500/40 hover:text-danger"
          >
            Geç
          </button>
          <button
            type="button"
            onClick={applyBtnDisabled ? undefined : onApplyClick}
            disabled={applyBtnDisabled}
            title={applyBtnTitle}
            className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition ${applyBtnClasses}`}
          >
            {applyBtnLabel}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
          <DetailPanel title="Gerekçe" body={plan.reason} />
          <DetailPanel title="Beklenen Etki" body={plan.impact} />
          {blocked && plan.blockedReason && (
            <DetailPanel
              title="Bloke Sebebi"
              body={plan.blockedReason}
              tone="danger"
            />
          )}
          <DetailPanel
            title="Kaynak / Onay"
            body={`Kaynak: ${plan.source} · Onay gerekir: evet · Apply ikinci onay sonrası DB'ye yazılır.`}
          />
        </div>
      )}
    </div>
  );
}

function DetailPanel({
  title,
  body,
  tone = "muted",
}: {
  title: string;
  body: string;
  tone?: StatusTone;
}) {
  return (
    <div className="rounded-md border border-border bg-bg-card/50 px-3 py-2">
      <div
        className={`text-[10px] font-semibold uppercase tracking-wider ${TONE_CLASSES[tone]}`}
      >
        {title}
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-slate-200">{body}</p>
    </div>
  );
}

function SnapItem({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[10px] uppercase tracking-wider text-muted">{k}</span>
      <span className="font-mono text-[11px] text-slate-200">{v}</span>
    </div>
  );
}

function ApplyModal({
  plan,
  applying,
  error,
  onCancel,
  onConfirm,
}: {
  plan: ActionPlan;
  applying: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isObservation = plan.type === "SET_OBSERVATION_MODE";
  const isPositionsChange = plan.type === "UPDATE_MAX_OPEN_POSITIONS_DOWN";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-bg-soft shadow-2xl">
        <div className="border-b border-border px-5 py-4">
          <h3 className="text-base font-semibold text-slate-100">
            Aksiyonu Uygula
          </h3>
          <p className="mt-1 text-[11px] text-muted">
            Bu işlem ikinci onay gerektirir. Uygulama sadece risk ayarını
            düşürür; canlı emir AÇILMAZ.
          </p>
        </div>

        <div className="space-y-3 px-5 py-4 text-sm">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              Aksiyon
            </div>
            <div className="text-sm font-semibold text-slate-100">{plan.title}</div>
            <div className="mt-0.5 font-mono text-[10px] text-muted">{plan.type}</div>
          </div>

          {!isObservation && (plan.currentValue || plan.recommendedValue) && (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-border bg-bg-card px-2.5 py-2">
                <div className="text-[10px] uppercase tracking-wider text-muted">
                  Eski Değer
                </div>
                <div className="font-mono text-sm text-slate-200">
                  {plan.currentValue ?? "—"}
                </div>
              </div>
              <div className="rounded-md border border-success/30 bg-success/10 px-2.5 py-2">
                <div className="text-[10px] uppercase tracking-wider text-success">
                  Yeni Değer
                </div>
                <div className="font-mono text-sm text-success">
                  {plan.recommendedValue ?? "—"}
                </div>
              </div>
            </div>
          )}

          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              Beklenen Etki
            </div>
            <p className="mt-0.5 text-[12px] leading-relaxed text-slate-200">
              {plan.impact}
            </p>
          </div>

          {isPositionsChange && (
            <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning">
              Bu değişiklik mevcut açık pozisyonları zorla kapatmaz; yalnızca
              yeni pozisyon açma davranışını etkiler.
            </div>
          )}

          <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-[11px] text-success">
            Bu işlem canlı emir açmaz. Sadece risk ayarını düşürür ve audit
            log&apos;a yazılır.
          </div>

          {error && (
            <div className="rounded-md border border-rose-500/30 bg-bg-card px-3 py-2 text-[11px] text-danger">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={applying}
            className="rounded-lg border border-border bg-bg-card px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-500 disabled:opacity-50"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={applying}
            className="rounded-lg border border-success/40 bg-success/15 px-3 py-1.5 text-xs font-semibold text-success transition hover:border-success/70 disabled:opacity-50"
          >
            {applying ? "Uygulanıyor…" : "Onayla ve Uygula"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RollbackModal({
  state,
  rollingBack,
  error,
  onCancel,
  onConfirm,
}: {
  state: RollbackModalState;
  rollingBack: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { item } = state;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-bg-soft shadow-2xl">
        <div className="border-b border-border px-5 py-4">
          <h3 className="text-base font-semibold text-slate-100">Aksiyonu Geri Al</h3>
          <p className="mt-1 text-[11px] text-muted">
            İkinci onay gerektirir. Bu işlem canlı emir açmaz.
          </p>
        </div>

        <div className="space-y-3 px-5 py-4 text-sm">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">Aksiyon</div>
            <div className="text-sm font-semibold text-slate-100">{item.title}</div>
            {item.actionType && (
              <div className="mt-0.5 font-mono text-[10px] text-muted">{item.actionType}</div>
            )}
          </div>

          {(item.oldValue || item.newValue) && (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-border bg-bg-card px-2.5 py-2">
                <div className="text-[10px] uppercase tracking-wider text-muted">Geri Dönülecek Değer</div>
                <div className="font-mono text-sm text-slate-200">{item.oldValue ?? "—"}</div>
              </div>
              <div className="rounded-md border border-border bg-bg-card px-2.5 py-2">
                <div className="text-[10px] uppercase tracking-wider text-muted">Mevcut Değer</div>
                <div className="font-mono text-sm text-slate-300">{item.newValue ?? "—"}</div>
              </div>
            </div>
          )}

          <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning">
            Bu değer önceki ayardır; risk seviyesini artırabilir. Canlı emir açmaz.
          </div>

          <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-[11px] text-success">
            Sadece bu aksiyonla değişen risk ayarını eski değere döndürür. Audit log&apos;a yazılır.
          </div>

          {error && (
            <div className="rounded-md border border-rose-500/30 bg-bg-card px-3 py-2 text-[11px] text-danger">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={rollingBack}
            className="rounded-lg border border-border bg-bg-card px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-500 disabled:opacity-50"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={rollingBack}
            className="rounded-lg border border-warning/40 bg-warning/15 px-3 py-1.5 text-xs font-semibold text-warning transition hover:border-warning/70 disabled:opacity-50"
          >
            {rollingBack ? "Geri Alınıyor…" : "Onayla ve Geri Al"}
          </button>
        </div>
      </div>
    </div>
  );
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}
