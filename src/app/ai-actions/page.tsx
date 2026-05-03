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
} from "@/lib/ai-actions";
import { buildActionPrompt } from "@/lib/ai-actions/prompt-builder";

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

  useEffect(() => {
    setDismissed(loadIdSet(DISMISS_KEY));
  }, []);

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

      {/* Geri linki */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <Link
          href="/"
          className="rounded-lg border border-border bg-bg-soft px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-accent/40 hover:text-accent"
        >
          ← Panel&apos;e dön
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

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}
