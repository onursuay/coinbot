"use client";
// Phase 9 — Dashboard / Panel kart mimarisi.
//
// Bu sayfa düz yazı/raporlama formatında değil; geniş, simetrik ve
// kart tabanlıdır. Her kart `src/components/dashboard/` altında
// tanımlanmış pure-presentation bileşenidir; hesaplama mantığı
// `src/lib/dashboard/` altında saf fonksiyonlardadır.
//
// SAFETY:
// - Hiçbir kart trade kararı, signal-engine eşiği veya canlı trading
//   kapısı üzerinde değişiklik yapmaz.
// - Yeni Binance API çağrısı eklenmemiştir; tüm veriler mevcut
//   `/api/bot/*`, `/api/paper-trades*` endpoint'lerinden okunur.
import { useCallback, useEffect, useState } from "react";
import { fmtPct, fmtUsd } from "@/lib/format";
import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh";
// Trade-open ses bildirimi artık layout seviyesinde GlobalTradeSoundNotifier
// üzerinden tüm sayfalarda çalışıyor; panel sayfası ayrıca abone olmuyor.
import {
  BotStatusCard,
  MarketPulseCard,
  OpportunityRadarCard,
  OpenPositionsCard,
  PerformanceDecisionCard,
  AIDecisionAssistantCard,
  type DecisionRow,
  type OpenPositionRow,
  type PerformanceDecisionInput,
  type AIDecisionCardInput,
} from "@/components/dashboard/Cards";

interface Toast {
  id: number;
  type: "success" | "error" | "info";
  message: string;
  detail?: string;
}

interface TickResult {
  ok: boolean;
  reason?: string;
  scannedSymbols: string[];
  generatedSignals: { symbol: string; type: string; score: number }[];
  openedPaperTrades: { symbol: string; direction: string; entryPrice: number }[];
  rejectedSignals: { symbol: string; reason: string }[];
  errors: { symbol: string; error: string }[];
  durationMs: number;
}

let toastId = 0;

export default function HomePage() {
  const [status, setStatus] = useState<any>(null);
  const [perf, setPerf] = useState<any>(null);
  const [paper, setPaper] = useState<{ open: any[]; closed: any[] }>({ open: [], closed: [] });
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [, setLastTick] = useState<TickResult | null>(null);
  const [envCheck, setEnvCheck] = useState<any>(null);
  const [workerHealth, setWorkerHealth] = useState<any>(null);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [perfDecision, setPerfDecision] = useState<PerformanceDecisionInput | null>(null);
  // Faz 21 — position management recommendations (advisory, display-only)
  const [pmRecs, setPmRecs] = useState<any[]>([]);
  // AI Karar Asistanı — RAPORU YENİLE veya ilk yüklemede doldurulur; polling yok
  const [aiDecision, setAiDecision] = useState<AIDecisionCardInput | null>(null);

  const addToast = useCallback((t: Omit<Toast, "id">) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 8000);
  }, []);

  const refresh = useCallback(async () => {
    const noCache: RequestInit = { cache: "no-store" };
    const [a, b, c, d, e, h, j, k] = await Promise.all([
      fetch("/api/bot/status", noCache).then((r) => r.json()).catch(() => null),
      fetch("/api/paper-trades/performance", noCache).then((r) => r.json()).catch(() => null),
      fetch("/api/paper-trades?limit=20", noCache).then((r) => r.json()).catch(() => null),
      fetch("/api/system/env-check", noCache).then((r) => r.json()).catch(() => null),
      fetch("/api/bot/heartbeat", noCache).then((r) => r.json()).catch(() => null),
      fetch("/api/bot/diagnostics", noCache).then((r) => r.json()).catch(() => null),
      fetch("/api/trade-performance/decision-summary", noCache).then((r) => r.json()).catch(() => null),
      // Faz 21 — position management advisory (read-only, no orders)
      fetch("/api/position-management/recommendations?mode=paper", noCache).then((r) => r.json()).catch(() => null),
    ]);
    if (a?.ok) setStatus(a.data);
    if (b?.ok) setPerf(b.data);
    if (c?.ok) setPaper(c.data);
    if (d?.ok) setEnvCheck(d.data);
    if (e?.ok) setWorkerHealth(e.data);
    if (h?.ok) setDiagnostics(h.data);
    if (j?.ok && j.data?.decision) setPerfDecision(j.data.decision as PerformanceDecisionInput);
    if (k?.ok && Array.isArray(k.data?.recommendations)) setPmRecs(k.data.recommendations);
  }, []);

  const fetchAIDecision = useCallback(async (opts?: { notify?: boolean }): Promise<{ ok: boolean; message?: string }> => {
    try {
      const res = await fetch("/api/ai-decision/interpret", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "paper" }),
      }).then((r) => r.json()).catch(() => null);
      if (res?.ok && res.data?.response?.data) {
        setAiDecision(res.data.response.data);
        if (opts?.notify) {
          addToast({ type: "success", message: "AI raporu güncellendi" });
        }
        return { ok: true, message: "AI raporu güncellendi." };
      }
      const message = res?.error ?? "AI raporu alınamadı.";
      if (opts?.notify) {
        addToast({ type: "error", message: "AI raporu yenilenemedi", detail: message });
      }
      return { ok: false, message };
    } catch {
      const message = "AI raporu yenilenemedi.";
      if (opts?.notify) {
        addToast({ type: "error", message });
      }
      return { ok: false, message };
    }
  }, [addToast]);

  useAutoRefresh(refresh);
  // Initial load — useAutoRefresh başlangıçta da çağırır, ama emin olmak için.
  // AI kararı ayrı yüklenir; auto-refresh döngüsüne dahil değil (polling yok).
  useEffect(() => { refresh(); void fetchAIDecision(); }, [refresh, fetchAIDecision]);

  const actWithBody = async (path: string, label: string, body?: object) => {
    if (path.endsWith("/start") && envCheck && !envCheck.ok) {
      addToast({
        type: "error",
        message: "Supabase env eksik. Önce env yapılandır.",
        detail: [...(envCheck.missing ?? []), ...(envCheck.empty ?? [])].join(", "),
      });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      }).then((r) => r.json());
      if (res.ok) {
        const newStatus = (res.data?.status ?? "").toString().toUpperCase();
        addToast({ type: "success", message: `${label} başarılı`, detail: newStatus ? `Durum: ${newStatus}` : undefined });
      } else {
        addToast({ type: "error", message: `${label} hatası`, detail: res.error });
      }
      await refresh();
    } catch (e: any) {
      addToast({ type: "error", message: `${label} hatası`, detail: e?.message });
    } finally {
      setBusy(false);
    }
  };

  const runTick = async () => {
    if (envCheck && !envCheck.ok) {
      addToast({ type: "error", message: "Env eksik. Tick atlandı.", detail: [...(envCheck.missing ?? []), ...(envCheck.empty ?? [])].join(", ") });
      return;
    }
    const dbgStatus = (status?.debug?.botStatus ?? "").toString().toLowerCase();
    const rawStatus = status?.bot?.bot_status;
    const currentStatus = dbgStatus || rawStatus;
    if (currentStatus !== "running" && currentStatus !== "running_paper" && currentStatus !== "running_live") {
      addToast({ type: "info", message: "Bot durdu. Önce Başlat'a bas.", detail: `Mevcut durum: ${(currentStatus ?? "stopped").toUpperCase()}` });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/bot/tick", { method: "POST" }).then((r) => r.json());
      if (!res.ok) { addToast({ type: "error", message: "Tick başarısız", detail: res.error }); return; }
      const t: TickResult = res.data;
      setLastTick(t);
      if (!t.ok) {
        addToast({ type: "info", message: "Tick atlandı", detail: t.reason ?? "Koşul sağlanamadı" });
      } else {
        const detail = [
          `${t.scannedSymbols.length} sembol tarandı`,
          `${t.generatedSignals.length} sinyal üretildi`,
          `${t.openedPaperTrades.length} paper trade açıldı`,
          t.rejectedSignals.length > 0 ? `${t.rejectedSignals.length} reddedildi` : null,
          t.errors.length > 0 ? `${t.errors.length} hata` : null,
          `${t.durationMs}ms`,
        ].filter(Boolean).join(" • ");
        addToast({ type: t.openedPaperTrades.length > 0 ? "success" : "info", message: "Tick tamamlandı", detail });
      }
      await refresh();
    } catch (e: any) {
      addToast({ type: "error", message: "Tick başarısız", detail: e?.message });
    } finally {
      setBusy(false);
    }
  };

  // ── Veri türetimleri ─────────────────────────────────────────────────
  const botStatus = (status?.debug?.botStatus ?? status?.bot?.bot_status ?? "stopped").toString().toLowerCase();
  const isKillSwitch = botStatus === "kill_switch" || status?.bot?.kill_switch_active;

  const scanRows: DecisionRow[] = (diagnostics?.scan_details ?? []) as DecisionRow[];
  // Faz 21: merge position management advisory into open positions (display-only)
  const pmRecsBySymbol: Record<string, any> = {};
  for (const r of pmRecs) { if (r?.symbol) pmRecsBySymbol[r.symbol] = r; }
  const openPositions: OpenPositionRow[] = (paper.open ?? []).map((t: any) => {
    const pm = pmRecsBySymbol[t.symbol];
    return {
      id: t.id,
      symbol: t.symbol,
      direction: t.direction,
      entry_price: t.entry_price,
      stop_loss: t.stop_loss,
      take_profit: t.take_profit,
      leverage: t.leverage,
      unrealized_pnl: t.unrealized_pnl ?? null,
      pm_action: pm?.action ?? null,
      pm_explanation: pm?.explanation ?? null,
    };
  });

  const tickStats = diagnostics?.tick_stats ?? {};
  const daily = status?.daily ?? {};

  return (
    <div className="space-y-4">
      {/* Toasts */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto rounded-xl px-4 py-3 shadow-lg border text-sm transition-all ${
            t.type === "success" ? "bg-success/20 border-success/40 text-success"
            : t.type === "error"   ? "bg-bg-soft border-rose-500/30 text-danger"
            :                        "bg-accent/10 border-accent/30 text-accent"
          }`}>
            <div className="font-medium">{t.message}</div>
            {t.detail && <div className="opacity-80 mt-0.5 text-xs">{t.detail}</div>}
          </div>
        ))}
      </div>

      {/* 1. BOT DURUMU — operasyonel; MOD/SANAL/PAPER etiketi yok */}
      <BotStatusCard
        data={{
          bot_status: status?.bot?.bot_status,
          active_exchange: status?.bot?.active_exchange ?? "binance",
          worker_online: workerHealth?.online ?? null,
          binance_api_status: workerHealth?.binanceApiStatus ?? null,
          websocket_status: workerHealth?.websocketStatus ?? null,
          last_tick_at: diagnostics?.last_tick_at,
          tickSkipped: diagnostics?.tickSkipped ?? false,
          skipReason: diagnostics?.skipReason ?? null,
          tickError: diagnostics?.tickError ?? null,
          kill_switch_active: !!isKillSwitch,
          kill_switch_reason: status?.bot?.kill_switch_reason ?? null,
          busy,
        }}
        actions={{
          onStartPaper: () => actWithBody("/api/bot/start", "Başlat", { mode: "paper", enableLive: false }),
          onStop: () => actWithBody("/api/bot/stop", "Durdur"),
          onKillSwitch: () => {
            if (confirm("Acil durum: Kill switch aktif edilsin mi? Tüm işlemler durdurulur.")) {
              actWithBody("/api/bot/kill-switch", "Acil Durdur");
            }
          },
          onTick: runTick,
        }}
      />

      {/* 2 + 3 — Piyasa Nabzı + Fırsat Radarı yan yana */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MarketPulseCard
          rows={scanRows}
          scanned={tickStats.scanned}
          signals={tickStats.signals}
          rejected={tickStats.rejected}
          btcVeto={tickStats.dynamicBtcTrendRejected}
        />
        <OpportunityRadarCard rows={scanRows} />
      </div>

      {/* Hızlı performans satırı — karar merkezi başlamadan önce görünür.
          Tüm değerler tek canonical kaynaktan (paper_trades.pnl) gelir; Sanal
          İşlemler > Kapanan İşlemler tablosundaki Kâr/Zarar kolonu ile birebir
          tutarlıdır. perf.dailyPnl / perf.totalPnl aynı satırların net pnl
          toplamıdır (fees/slippage/funding paper_trades.pnl yazılırken zaten
          düşülmüştür — burada yeniden düşme). */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <KpiTile label="GÜNLÜK KÂR/ZARAR" value={fmtUsd(perf?.dailyPnl ?? daily?.realizedPnlUsd ?? 0)} tone={(perf?.dailyPnl ?? daily?.realizedPnlUsd ?? 0) >= 0 ? "success" : "danger"} />
        <KpiTile label="TOPLAM KÂR/ZARAR" value={fmtUsd(perf?.totalPnl ?? 0)} tone={(perf?.totalPnl ?? 0) >= 0 ? "success" : "danger"} />
        <KpiTile label="KAZANMA ORANI" value={fmtPct(perf?.winRate ?? 0)} tone="muted" />
        <KpiTile label="KAPANAN İŞLEM" value={String(perf?.totalTrades ?? 0)} tone="muted" />
        <KpiTile label="AÇIK POZİSYON" value={String(perf?.openTrades ?? (paper.open?.length ?? 0))} tone="muted" />
      </div>
      <p className="text-[11px] text-muted -mt-2">
        Sadece kapanmış paper işlemler dahildir. Açık pozisyonların gerçekleşmemiş PnL&apos;i bu toplamlara katılmaz; değerler{" "}
        <span className="font-mono">paper_trades.pnl</span> sütununun toplamıdır ve Sanal İşlemler ▸ Kapanan İşlemler tablosunun alt &quot;Toplam&quot; satırı ile birebir aynıdır.
      </p>

      {/* Açık Pozisyonlar */}
      <OpenPositionsCard rows={openPositions} />

      {/* Performans Karar Özeti */}
      <PerformanceDecisionCard
        data={perfDecision}
        onAction={(kind, actionId) => {
          // Yalnızca kayıt/log amaçlı. Hiçbir trade engine ayarına,
          // risk parametresine veya canlı trading gate'ine bağlanmaz.
          // Navigation (REVIEW_RISK) kart içinde router.push ile yapılır.
          void actionId;
          void kind;
        }}
      />

      {/* AI Karar Asistanı — ChatGPT API yorum katmanı; ayar değiştirmez, emir açmaz */}
      <AIDecisionAssistantCard
        data={aiDecision}
        onAction={async (action) => {
          if (action === "REFRESH") {
            return fetchAIDecision({ notify: true });
          }
          if (action === "OBSERVE") {
            console.info("ai_decision_observation_selected", {
              observeDays: aiDecision?.observeDays ?? 14,
              status: aiDecision?.status ?? "DATA_INSUFFICIENT",
              actionType: aiDecision?.actionType ?? "DATA_INSUFFICIENT",
            });
            addToast({
              type: "success",
              message: "14 gün gözlem kararı kaydedildi",
              detail: "Bu seçim ayar değiştirmez ve emir açmaz.",
            });
            return { ok: true, message: "14 gün gözlem kararı kaydedildi." };
          }
          if (action === "PROMPT") {
            return { ok: true, message: "Prompt hazırlandı; otomatik uygulanmaz." };
          }
          if (action === "COPY_PROMPT") {
            addToast({ type: "success", message: "Prompt kopyalandı" });
            return { ok: true, message: "Prompt kopyalandı." };
          }
        }}
      />
    </div>
  );
}

function KpiTile({ label, value, tone }: { label: string; value: string; tone: "success" | "danger" | "muted" }) {
  const cls = tone === "success" ? "value-positive" : tone === "danger" ? "value-negative" : "text-slate-200";
  return (
    <div className="card text-center">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
