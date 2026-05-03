// AI Aksiyon Merkezi — Faz 2.
//
// Faz 1.0'daki statik mimari kartları korunur; "Aktif Aksiyonlar" bölümü
// /api/ai-actions endpoint'inden canlı plan listesi çeker.
//
// SAFETY:
// - Bu sayfada hiçbir buton ayar değiştirmez.
// - "Uygula" butonu DISABLED — Faz 3'te aktifleşecek.
// - Gözlem / dismiss butonları yalnızca localStorage'a yazar.
// - Prompt butonu plan'dan markdown üretir, clipboard'a kopyalar.

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ActionPlan,
  ActionPlanResult,
  ActionPlanRiskLevel,
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

const DISMISS_KEY = "ai-actions:dismissed:v1";
const OBSERVE_KEY = "ai-actions:observed:v1";

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

export default function AIActionCenterPage() {
  const [data, setData] = useState<ActionPlanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [observed, setObserved] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<{ id: string; copied: boolean } | null>(
    null,
  );

  useEffect(() => {
    setDismissed(loadIdSet(DISMISS_KEY));
    setObserved(loadIdSet(OBSERVE_KEY));
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

  const toggleObserve = (id: string) => {
    setObserved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveIdSet(OBSERVE_KEY, next);
      return next;
    });
  };

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
            Faz 2 · Öneri Üretimi
          </span>
        </div>
        <p className="mt-2 rounded-md border border-border bg-bg-soft px-3 py-2 text-[11px] text-muted">
          {data?.phaseBanner ??
            "Faz 2: Sadece öneri üretir, ayar değiştirmez. Hiçbir aksiyon otomatik uygulanmaz."}
        </p>
      </div>

      {/* A) Merkez Durum Kartları */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatusTile
          label="Sistem Durumu"
          value="Faz 2 · Öneri Üretimi"
          hint="Plan üretir, uygulamaz"
          tone="warning"
        />
        <StatusTile
          label="Yetki Modu"
          value="Prompt Only"
          hint="Sadece prompt üretir, uygulamaz"
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

      {/* F) Aktif Aksiyonlar (canlı) — sayfanın üstüne taşındı */}
      <section className="card">
        <SectionHeader
          eyebrow="Aktif Aksiyonlar"
          title="Üretilen plan listesi"
          subtitle="Generator deterministiktir. Her plan kullanıcı onayı gerektirir; bu fazda uygulama kapalı."
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
                isObserved={observed.has(plan.id)}
                onToggleDetail={() =>
                  setOpenId((cur) => (cur === plan.id ? null : plan.id))
                }
                onObserve={() => toggleObserve(plan.id)}
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
              <SnapItem
                k="Toplam P&L"
                v={fmtUsd(data.sourceSnapshot.totalPnl)}
              />
              <SnapItem
                k="Günlük P&L"
                v={fmtUsd(data.sourceSnapshot.dailyPnl)}
              />
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
            futureRole="Branch / commit / PR aksiyon akışı (Faz 3)"
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
          subtitle="Aktif faz: Prompt Only. Diğer seviyeler ileriki fazlarda devreye girer."
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
            active={true}
            scope="Claude Code / GitHub promptu üretir. Kullanıcı manuel uygular."
          />
          <AuthorityCard
            level="approval_required"
            title="Onay Gerekir"
            tone="warning"
            active={false}
            scope="Riskli değişiklikler için kullanıcı onayı şart. Worker / risk / engine."
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
              "Claude Code prompt üretimi",
              "Aksiyon geçmişi",
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
              "Onaysız risk parametre değişikliği",
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
            <dt className="shrink-0 uppercase tracking-wider text-muted">
              {row.k}
            </dt>
            <dd className="truncate text-right font-mono text-slate-300">
              {row.v}
            </dd>
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
  isObserved,
  onToggleDetail,
  onObserve,
  onDismiss,
  onPrompt,
  copyState,
}: {
  plan: ActionPlan;
  isOpen: boolean;
  isObserved: boolean;
  onToggleDetail: () => void;
  onObserve: () => void;
  onDismiss: () => void;
  onPrompt: () => void;
  copyState: { id: string; copied: boolean } | null;
}) {
  const riskTone = RISK_TONE[plan.riskLevel];
  const isCopied = copyState?.id === plan.id && copyState.copied;
  const blocked = !plan.allowed;

  return (
    <div
      className={`rounded-lg border px-3 py-3 ${
        blocked
          ? "border-rose-500/30 bg-bg-soft"
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
            onClick={onObserve}
            className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1 text-[11px] font-semibold text-warning transition hover:border-warning/60"
          >
            {isObserved ? "Gözlemi Kaldır" : "Gözlem"}
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
            disabled
            title="Faz 3'te onaylı uygulama aktif olacak."
            className="cursor-not-allowed rounded-md border border-border bg-bg-card px-2.5 py-1 text-[11px] font-semibold text-muted opacity-60"
          >
            Uygula (Faz 3)
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
            body={`Kaynak: ${plan.source} · Onay gerekir: evet · Bu fazda otomatik uygulama yok.`}
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
      <span className="text-[10px] uppercase tracking-wider text-muted">
        {k}
      </span>
      <span className="font-mono text-[11px] text-slate-200">{v}</span>
    </div>
  );
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}
