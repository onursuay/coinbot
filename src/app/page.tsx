"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { fmtNum, fmtPct, fmtUsd } from "@/lib/format";
import { getTopOpportunities } from "@/lib/top-opportunities";

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

interface Toast {
  id: number;
  type: "success" | "error" | "info";
  message: string;
  detail?: string;
}

interface WorkerHealth {
  online: boolean;
  workerId: string | null;
  status: string | null;
  lastHeartbeat: string | null;
  ageMs: number | null;
  websocketStatus: string | null;
  binanceApiStatus: string | null;
  openPositionsCount: number;
  lastError: string | null;
}

interface StrategyHealth {
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  consecutiveLosses: number;
  score: number;
  blocked: boolean;
  blockReason: string | null;
}

let toastId = 0;

export default function HomePage() {
  const [status, setStatus] = useState<any>(null);
  const [perf, setPerf] = useState<any>(null);
  const [paper, setPaper] = useState<{ open: any[]; closed: any[] }>({ open: [], closed: [] });
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [lastTick, setLastTick] = useState<TickResult | null>(null);
  const [lastStartResponse, setLastStartResponse] = useState<any>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [envCheck, setEnvCheck] = useState<any>(null);
  const [workerHealth, setWorkerHealth] = useState<WorkerHealth | null>(null);
  const [strategyHealth, setStrategyHealth] = useState<StrategyHealth | null>(null);
  const [hardLiveAllowed, setHardLiveAllowed] = useState<boolean>(false);
  const [liveReadiness, setLiveReadiness] = useState<any>(null);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [e2eStatus, setE2eStatus] = useState<any>(null);

  const addToast = (t: Omit<Toast, "id">) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 8000);
  };

  const refresh = async () => {
    const noCache: RequestInit = { cache: "no-store" };
    const [a, b, c, d, e, f, g, h, i] = await Promise.all([
      fetch("/api/bot/status", noCache).then((r) => r.json()).catch(() => null),
      fetch("/api/paper-trades/performance", noCache).then((r) => r.json()).catch(() => null),
      fetch("/api/paper-trades?limit=20", noCache).then((r) => r.json()).catch(() => null),
      fetch("/api/system/env-check", noCache).then((r) => r.json()).catch(() => null),
      fetch("/api/bot/heartbeat", noCache).then((r) => r.json()).catch(() => null),
      fetch("/api/bot/strategy-health", noCache).then((r) => r.json()).catch(() => null),
      fetch("/api/bot/live-readiness", noCache).then((r) => r.json()).catch(() => null),
      fetch("/api/bot/diagnostics", noCache).then((r) => r.json()).catch(() => null),
      fetch("/api/paper-trades/e2e-status", noCache).then((r) => r.json()).catch(() => null),
    ]);
    if (a?.ok) {
      setStatus(a.data);
      setHardLiveAllowed(a.data?.hardLiveTradingAllowed ?? false);
    }
    if (b?.ok) setPerf(b.data);
    if (c?.ok) setPaper(c.data);
    if (d?.ok) setEnvCheck(d.data);
    if (e?.ok) setWorkerHealth(e.data);
    if (f?.ok) setStrategyHealth(f.data);
    if (g?.ok) setLiveReadiness(g.data);
    if (h?.ok) setDiagnostics(h.data);
    if (i?.ok) setE2eStatus(i.data);
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, []);

  const actWithBody = async (path: string, label: string, body?: object) => {
    if (path.endsWith("/start") && envCheck && !envCheck.ok) {
      addToast({
        type: "error",
        message: "Supabase env missing. Configure Vercel environment variables first.",
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
      if (path.includes("/start")) setLastStartResponse(res);
      if (res.ok) {
        const newStatus = (res.data?.status ?? "").toString().toUpperCase();
        addToast({ type: "success", message: `${label} başarılı`, detail: newStatus ? `Status: ${newStatus}` : undefined });
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
      addToast({ type: "error", message: "Supabase env missing. Tick skipped.", detail: [...(envCheck.missing ?? []), ...(envCheck.empty ?? [])].join(", ") });
      return;
    }
    const dbgStatus = (status?.debug?.botStatus ?? "").toString().toLowerCase();
    const rawStatus = status?.bot?.bot_status;
    const currentStatus = dbgStatus || rawStatus;
    if (currentStatus !== "running" && currentStatus !== "running_paper" && currentStatus !== "running_live") {
      addToast({ type: "info", message: "Bot stopped. Press Start first.", detail: `Mevcut durum: ${(currentStatus ?? "stopped").toUpperCase()}` });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/bot/tick", { method: "POST" }).then((r) => r.json());
      if (!res.ok) { addToast({ type: "error", message: "Tick başarısız", detail: res.error }); return; }
      const t: TickResult = res.data;
      setLastTick(t);
      if (!t.ok) {
        addToast({ type: "info", message: "Tick skipped", detail: t.reason ?? "Bot running değil veya koşul sağlanamadı" });
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
      addToast({ type: "error", message: "Tick failed", detail: e?.message });
    } finally {
      setBusy(false);
    }
  };

  const daily = status?.daily;
  const distance = Math.max(0, (daily?.dailyTargetUsd ?? 20) - (daily?.realizedPnlUsd ?? 0));
  const dominantRejection = lastTick?.rejectedSignals[0]?.reason ?? null;

  const botStatus = (status?.debug?.botStatus ?? status?.bot?.bot_status ?? "stopped").toString().toLowerCase();
  const isRunning = botStatus.startsWith("running");
  const isKillSwitch = botStatus === "kill_switch" || status?.bot?.kill_switch_active;
  const tradingMode = status?.bot?.trading_mode ?? "paper";
  const enableLiveTrading = status?.bot?.enable_live_trading ?? false;
  // status===null: data not yet loaded → "..." avoids stale env value flash.
  // debug.activeExchange skipped — same env risk as config.defaultExchange.
  const activeExchange = status === null ? "..." : (status?.bot?.active_exchange ?? "binance");

  return (
    <div className="space-y-6">
      {/* Toasts */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80">
        {toasts.map((t) => (
          <div key={t.id} className={`rounded-xl px-4 py-3 shadow-lg border text-sm transition-all ${
            t.type === "success" ? "bg-success/20 border-success/40 text-success"
            : t.type === "error"   ? "bg-danger/20 border-danger/40 text-danger"
            :                        "bg-accent/10 border-accent/30 text-accent"
          }`}>
            <div className="font-medium">{t.message}</div>
            {t.detail && <div className="opacity-80 mt-0.5 text-xs">{t.detail}</div>}
          </div>
        ))}
      </div>

      {/* ===== Control Panel ===== */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Bot Kontrol Paneli</h2>
          <div className="flex items-center gap-2">
            <StatusBadge status={botStatus} />
            {isKillSwitch && <span className="tag-danger text-xs animate-pulse">KILL SWITCH</span>}
          </div>
        </div>

        {/* Mode + Exchange info row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          <InfoRow label="Mod" value={tradingMode.toUpperCase()} accent={tradingMode === "live" ? "danger" : "success"} />
          <InfoRow label="Borsa" value={activeExchange.toUpperCase()} />
          <InfoRow label="Canlı İşlem" value={enableLiveTrading ? "Evet" : "Hayır"} accent={enableLiveTrading ? "danger" : "muted"} />
          <InfoRow label="Canlı İşlem Kilidi" value={hardLiveAllowed ? "AÇIK" : "Kapalı"} accent={hardLiveAllowed ? "warning" : "success"} />
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-primary text-sm px-4 py-2"
            onClick={() => actWithBody("/api/bot/start", "Start Paper Bot", { mode: "paper", enableLive: false })}
            disabled={busy || isRunning}
          >
            Sanal İşlemi Başlat
          </button>

          <button
            className={`text-sm px-4 py-2 rounded-lg border font-medium transition-colors ${
              !hardLiveAllowed
                ? "opacity-40 cursor-not-allowed border-border text-muted"
                : "border-warning/60 text-warning hover:bg-warning/10"
            }`}
            onClick={() => {
              if (!hardLiveAllowed) {
                addToast({ type: "error", message: "Live trading kilitli", detail: "HARD_LIVE_TRADING_ALLOWED=false. Önce env'de etkinleştir." });
                return;
              }
              actWithBody("/api/bot/start", "Start Live Bot", { mode: "live", enableLive: true });
            }}
            disabled={busy || isRunning}
            title={!hardLiveAllowed ? "HARD_LIVE_TRADING_ALLOWED=false — devre dışı" : undefined}
          >
            Canlı İşlemi Başlat {!hardLiveAllowed && "🔒"}
          </button>

          <button
            className="btn-ghost text-sm px-4 py-2"
            onClick={() => actWithBody("/api/bot/stop", "Stop Bot")}
            disabled={busy || !isRunning}
          >
            Durdur
          </button>

          <button
            className="text-sm px-4 py-2 rounded-lg border border-danger/60 text-danger hover:bg-danger/10 font-medium transition-colors"
            onClick={() => {
              if (confirm("Acil durum: Kill switch aktif edilsin mi? Tüm işlemler durdurulur.")) {
                actWithBody("/api/bot/kill-switch", "Emergency Stop");
              }
            }}
            disabled={busy}
          >
            Acil Durdur
          </button>

          <button className="btn-primary text-sm px-4 py-2 ml-auto" onClick={runTick} disabled={busy}>
            {busy ? "Çalışıyor…" : "Taramayı Çalıştır"}
          </button>
        </div>

        {/* Kill switch reason */}
        {isKillSwitch && status?.bot?.kill_switch_reason && (
          <div className="rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
            Kill switch sebebi: {status.bot.kill_switch_reason}
          </div>
        )}
      </div>

      {/* ===== Worker Heartbeat ===== */}
      <div className={`card border ${workerHealth?.online ? "border-success/30" : "border-warning/30"}`}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Sunucu Bot Durumu</h2>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${workerHealth?.online ? "bg-success/20 text-success" : "bg-warning/20 text-warning"}`}>
            {workerHealth?.online ? "ÇEVRİMİÇİ" : "ÇEVRİMDIŞI / YOK"}
          </span>
        </div>
        {workerHealth ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <InfoRow label="Sunucu Bot ID" value={workerHealth.workerId ?? "—"} />
            <InfoRow label="Son Heartbeat" value={workerHealth.ageMs !== null ? `${Math.round(workerHealth.ageMs / 1000)}s önce` : "—"} accent={workerHealth.online ? "success" : "danger"} />
            <InfoRow label="WebSocket" value={workerHealth.websocketStatus ?? "—"} accent={workerHealth.websocketStatus === "connected" ? "success" : "muted"} />
            <InfoRow label="Binance API" value={workerHealth.binanceApiStatus ?? "—"} accent={workerHealth.binanceApiStatus === "ok" ? "success" : "muted"} />
          </div>
        ) : (
          <p className="text-sm text-muted">Heartbeat verisi bekleniyor…</p>
        )}
        {workerHealth?.lastError && (
          <div className="mt-2 text-xs text-danger">Son hata: {workerHealth.lastError}</div>
        )}
        <p className="mt-2 text-xs text-muted">
          Worker 60+ saniye heartbeat göndermezse OFFLINE sayılır. Dashboard yokken bile çalışması için VPS/Docker&apos;da çalıştır.
        </p>
      </div>

      {/* ===== Tick result summary ===== */}
      {lastTick && (
        <div className={`card border ${lastTick.openedPaperTrades.length > 0 ? "border-success/40" : "border-border"}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className="font-medium text-sm">Son Tick Sonucu</span>
            <span className="text-muted text-xs">{lastTick.durationMs}ms</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
            <Stat label="Taranan" value={String(lastTick.scannedSymbols.length)} />
            <Stat label="Sinyal" value={String(lastTick.generatedSignals.length)} accent="accent" />
            <Stat label="Açılan" value={String(lastTick.openedPaperTrades.length)} accent={lastTick.openedPaperTrades.length > 0 ? "success" : undefined} />
            <Stat label="Reddedilen" value={String(lastTick.rejectedSignals.length)} />
            <Stat label="Hata" value={String(lastTick.errors.length)} accent={lastTick.errors.length > 0 ? "danger" : undefined} />
          </div>
          {lastTick.openedPaperTrades.length > 0 && (
            <div className="mt-2 text-xs text-success">
              Açılan: {lastTick.openedPaperTrades.map((t) => `${t.direction} ${t.symbol} @${fmtNum(t.entryPrice, 4)}`).join(", ")}
            </div>
          )}
          {lastTick.openedPaperTrades.length === 0 && dominantRejection && (
            <div className="mt-2 text-xs text-muted">Hiç sinyal açılmadı. Sebep: {dominantRejection}</div>
          )}
          {lastTick.errors.length > 0 && (
            <div className="mt-2 text-xs text-danger">Hata: {lastTick.errors[0].symbol} — {lastTick.errors[0].error}</div>
          )}
        </div>
      )}

      {/* ===== Scanner Visibility ===== */}
      <ScannerVisibilityCard diagnostics={diagnostics} open={scannerOpen} onToggle={() => setScannerOpen((v) => !v)} />

      {/* ===== Dinamik Evren Özeti ===== */}
      <DynamicUniverseCard diagnostics={diagnostics} />

      {/* ===== Fırsata En Yakın 5 Coin ===== */}
      <TopOpportunityCard diagnostics={diagnostics} />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Kpi label="Günlük Kâr/Zarar" value={fmtUsd(daily?.realizedPnlUsd ?? 0)} accent={(daily?.realizedPnlUsd ?? 0) >= 0 ? "success" : "danger"} />
        <Kpi label="Günlük Hedef" value={fmtUsd(daily?.dailyTargetUsd ?? 20)} sub={daily?.targetHit ? "Hedef tamam!" : `Kalan ${fmtUsd(distance)}`} />
        <Kpi label="Toplam Kâr/Zarar (Sanal)" value={fmtUsd(perf?.totalPnl ?? 0)} accent={(perf?.totalPnl ?? 0) >= 0 ? "success" : "danger"} />
        <Kpi label="Kazanma Oranı" value={fmtPct(perf?.winRate ?? 0)} sub={`${perf?.totalTrades ?? 0} işlem`} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Kpi label="Kâr Faktörü" value={fmtNum(perf?.profitFactor ?? 0)} />
        <Kpi label="Maksimum Düşüş" value={fmtUsd(perf?.maxDrawdown ?? 0)} accent="danger" />
        <Kpi label="Açık Pozisyonlar" value={String(status?.openPositions ?? 0)} sub={`max ${status?.config?.maxAllowedLeverage ?? 5}x kaldıraç`} />
      </div>

      {/* ===== Strategy Health Score ===== */}
      {strategyHealth && (
        <div className={`card border ${strategyHealth.blocked ? "border-danger/50" : strategyHealth.score >= 80 ? "border-success/30" : "border-warning/30"}`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Strateji Sağlık Skoru</h2>
            <div className="flex items-center gap-2">
              <span className={`text-2xl font-bold ${strategyHealth.score >= 80 ? "text-success" : strategyHealth.score >= 60 ? "text-warning" : "text-danger"}`}>
                {strategyHealth.score}/100
              </span>
              {strategyHealth.blocked && <span className="tag-danger text-xs">BLOKLANMIŞ</span>}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <Stat label="İşlemler" value={String(strategyHealth.totalTrades)} />
            <Stat label="Kazanma Oranı" value={fmtPct(strategyHealth.winRate)} accent={strategyHealth.winRate >= 0.5 ? "success" : "danger"} />
            <Stat label="Profit Factor" value={fmtNum(strategyHealth.profitFactor)} accent={strategyHealth.profitFactor >= 1.5 ? "success" : "danger"} />
            <Stat label="Art Arda Kayıp" value={String(strategyHealth.consecutiveLosses)} accent={strategyHealth.consecutiveLosses >= 3 ? "danger" : undefined} />
          </div>
          {strategyHealth.blockReason && (
            <div className="mt-2 text-xs text-danger">{strategyHealth.blockReason}</div>
          )}
        </div>
      )}

      {/* Paper Trade E2E Validation */}
      <PaperE2ECard e2e={e2eStatus} />

      {/* System Config Status */}
      <SystemConfigCard envCheck={envCheck} status={status} />

      <div className="card min-w-0 overflow-hidden">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Açık Pozisyonlar ({paper.open.length})</h2>
          <Link href="/paper-trades" className="text-accent text-sm">Tüm işlemler →</Link>
        </div>
        <div className="overflow-hidden">
          <table className="t table-fixed w-full">
            <colgroup>
              <col className="w-[22%]" />
              <col className="w-[12%]" />
              <col className="w-[8%]" />
              <col className="w-[16%]" />
              <col className="w-[16%]" />
              <col className="w-[16%]" />
              <col className="w-[10%]" />
            </colgroup>
            <thead><tr><th>Sem</th><th>Yön</th><th>Lev</th><th>Entry</th><th>SL</th><th>TP</th><th>Durum</th></tr></thead>
            <tbody>
              {paper.open.length === 0 && (
                <tr><td colSpan={7} className="text-muted text-sm py-3">Açık pozisyon yok</td></tr>
              )}
              {paper.open.map((t) => (
                <tr key={t.id}>
                  <td className="font-medium truncate" title={t.symbol}>{t.symbol}</td>
                  <td className="truncate"><span className={`tag-${t.direction === "LONG" ? "success" : "danger"}`}>{t.direction}</span></td>
                  <td className="truncate">{t.leverage}x</td>
                  <td className="truncate">{fmtNum(t.entry_price, 4)}</td>
                  <td className="truncate">{fmtNum(t.stop_loss, 4)}</td>
                  <td className="truncate">{fmtNum(t.take_profit, 4)}</td>
                  <td className="truncate"><span className="tag-success text-xs">Açık</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <button
          className="text-xs text-muted hover:text-accent w-full text-left flex items-center justify-between"
          onClick={() => setDebugOpen((v) => !v)}
        >
          <span>Gelişmiş / Debug {debugOpen ? "▾" : "▸"}</span>
          <span className="text-muted">
            {(status?.debug?.botStatus ?? "—").toString().toUpperCase()} • src:{status?.debug?.source ?? "—"} • row:{status?.debug?.hasSettingsRow ? "yes" : "no"}
          </span>
        </button>
        {debugOpen && (
          <div className="mt-3 space-y-3">
            {lastTick?.rejectedSignals && lastTick.rejectedSignals.length > 0 && (
              <div className="card border border-border">
                <h3 className="text-sm font-medium mb-2 text-muted">Son Reddedilen Sinyaller</h3>
                <div className="space-y-1">
                  {lastTick.rejectedSignals.slice(0, 10).map((s, i) => (
                    <div key={i} className="text-xs text-muted flex items-center gap-2 min-w-0">
                      <span className="font-medium text-slate-300 flex-shrink-0">{s.symbol}</span>
                      <span className="truncate min-w-0 flex-1" title={s.reason}>{s.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <LiveReadinessCard readiness={liveReadiness} />
            <pre className="text-xs text-muted bg-bg-soft border border-border rounded-lg p-3 overflow-x-auto">
{JSON.stringify({
  statusSource: status?.debug?.source,
  hasSettingsRow: status?.debug?.hasSettingsRow,
  botStatus: status?.debug?.botStatus,
  tradingMode,
  enableLiveTrading,
  hardLiveAllowed,
  activeExchange,
  workerOnline: workerHealth?.online,
  workerStatus: workerHealth?.status,
  lastStartResponse,
}, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const cls =
    s.startsWith("running") ? "bg-success/20 text-success border-success/40" :
    s === "kill_switch" || s === "kill_switch_triggered" ? "bg-danger/20 text-danger border-danger/40 animate-pulse" :
    s === "paused" ? "bg-warning/20 text-warning border-warning/40" :
    "bg-muted/20 text-muted border-border";
  const label =
    s === "running" || s === "running_paper" ? "ÇALIŞIYOR" :
    s === "running_live" ? "CANLI ÇALIŞIYOR" :
    s === "stopped" ? "DURDU" :
    s === "kill_switch" || s === "kill_switch_triggered" ? "ACİL DURDURULDU" :
    s === "paused" ? "DURAKLADI" :
    status.toUpperCase().replace(/_/g, " ");
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cls}`}>
      {label}
    </span>
  );
}

function InfoRow({ label, value, accent }: { label: string; value: string; accent?: "success" | "danger" | "warning" | "muted" }) {
  const cls = accent === "success" ? "text-success" : accent === "danger" ? "text-danger" : accent === "warning" ? "text-warning" : "text-muted";
  return (
    <div className="bg-bg-soft border border-border rounded-lg px-3 py-2 flex flex-col gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      <span className={`text-xs font-semibold ${cls}`}>{value}</span>
    </div>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "success" | "danger" }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className={`kpi ${accent === "success" ? "text-success" : accent === "danger" ? "text-danger" : ""}`}>{value}</div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
    </div>
  );
}

function SystemConfigCard({ envCheck, status }: { envCheck: any; status: any }) {
  if (!envCheck) return null;
  const missingList = [...(envCheck.missing ?? []), ...(envCheck.empty ?? [])];
  const connectionOk = !missingList.some((k: string) => k.startsWith("NEXT_PUBLIC_SUPABASE") || k === "SUPABASE_SERVICE_ROLE_KEY");
  const securityOk = !missingList.includes("CREDENTIAL_ENCRYPTION_KEY");
  const cfg = envCheck.effectiveConfig ?? {};
  return (
    <div className={`card border ${envCheck.ok ? "" : "border-danger/50"}`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">Sistem Durumu</h2>
        {!envCheck.ok && <span className="tag-danger text-xs">CONFIG INCOMPLETE</span>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        <ConfigRow label="Bağlantı" value={connectionOk ? "Bağlı" : "Hata"} ok={connectionOk} />
        <ConfigRow label="Güvenlik" value={securityOk ? "Aktif" : "Hata"} ok={securityOk} />
        <ConfigRow label="Canlı İşlem" value={cfg.liveTrading ? "Açık" : "Kapalı"} ok={!cfg.liveTrading} />
        <ConfigRow label="Varsayılan Kaldıraç" value={`${cfg.maxLeverage ?? 3}x`} ok />
        <ConfigRow label="Maks. İzinli Kaldıraç" value={`${cfg.maxAllowedLeverage ?? 5}x`} ok />
        <ConfigRow label="Üst Limit" value={`${cfg.hardCap ?? 5}x`} ok />
      </div>
      {!envCheck.ok && (
        <div className="mt-3 rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
          Sistem yapılandırması eksik. Vercel ortam değişkenlerini kontrol edin.
        </div>
      )}
      {envCheck.warnings?.length > 0 && (
        <div className="mt-2 text-xs text-warning">{envCheck.warnings.join(" • ")}</div>
      )}
    </div>
  );
}

function ConfigRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between bg-bg-soft border border-border rounded-lg px-3 py-2">
      <span className="text-muted text-xs">{label}</span>
      <span className={`text-xs font-medium ${ok ? "text-success" : "text-danger"}`}>{value}</span>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "success" | "danger" | "accent" }) {
  const cls = accent === "success" ? "text-success" : accent === "danger" ? "text-danger" : accent === "accent" ? "text-accent" : "text-slate-200";
  return (
    <div className="bg-bg-soft border border-border rounded-lg px-3 py-2 text-center">
      <div className="label">{label}</div>
      <div className={`text-lg font-semibold ${cls}`}>{value}</div>
    </div>
  );
}

// Placeholder checks shown when API returns no data yet
const PLACEHOLDER_CHECKS = [
  { name: "Paper Trades", value: "—", required: "100", passed: false },
  { name: "Profit Factor", value: "—", required: "1.3", passed: false },
  { name: "Max Drawdown", value: "—", required: "≤10%", passed: false },
  { name: "Win Rate", value: "—", required: "≥45%", passed: false },
  { name: "Health Score", value: "—", required: "≥60", passed: false },
];

function LiveReadinessCard({ readiness }: { readiness: any }) {
  const completed = readiness?.paperTradesCompleted ?? 0;
  const required = readiness?.paperTradesRequired ?? 100;
  const ready = readiness?.ready ?? false;
  const checks: any[] = readiness?.checks?.length > 0 ? readiness.checks : PLACEHOLDER_CHECKS;
  const blockers: string[] = readiness?.blockers ?? [];

  return (
    <div className={`card border ${ready ? "border-success/40" : "border-warning/30"}`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">Live Readiness</h2>
        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${ready ? "bg-success/20 text-success" : "bg-warning/20 text-warning"}`}>
          {ready ? "HAZIR" : "HENÜZ HAZIR DEĞİL"}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-xs text-muted mb-1">
          <span>Paper Trades</span>
          <span>{completed} / {required}</span>
        </div>
        <div className="w-full bg-bg-soft rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${completed >= required ? "bg-success" : "bg-accent"}`}
            style={{ width: `${Math.min(100, required > 0 ? (completed / required) * 100 : 0)}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
        {checks.map((c: any) => (
          <div key={c.name} className={`bg-bg-soft border rounded-lg px-3 py-2 ${c.passed ? "border-success/30" : "border-border"}`}>
            <div className="text-xs text-muted">{c.name}</div>
            <div className={`text-sm font-semibold ${c.passed ? "text-success" : c.value === "—" ? "text-muted" : "text-danger"}`}>{c.value}</div>
            <div className="text-xs text-muted">gereken: {c.required}</div>
          </div>
        ))}
      </div>

      {blockers.length > 0 && (
        <div className="mt-2 text-xs text-warning">Engeller: {blockers.join(" • ")}</div>
      )}
    </div>
  );
}

function PaperE2ECard({ e2e }: { e2e: any }) {
  if (!e2e) return null;
  const allPassed = e2e.allPassed as boolean;
  const checks: { name: string; label: string; ok: boolean; detail: string; skipped?: boolean }[] = e2e.checks ?? [];
  const failed = checks.filter((c) => !c.ok && !c.skipped);
  const skipped = checks.filter((c) => c.skipped);

  return (
    <div className={`card border ${allPassed ? "border-success/30" : failed.length > 0 ? "border-danger/40" : "border-border"}`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">Paper İşlem Doğrulaması</h2>
        <div className="flex items-center gap-2">
          {allPassed ? (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-success/20 text-success">TÜMÜ GEÇTİ</span>
          ) : failed.length > 0 ? (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-danger/20 text-danger">{failed.length} BAŞARISIZ</span>
          ) : null}
          {skipped.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-bg-soft text-muted">{skipped.length} atlandı</span>
          )}
        </div>
      </div>

      <ul className="space-y-1.5">
        {checks.map((c) => (
          <li key={c.name} className="flex items-start gap-2 text-xs">
            <span className={`mt-0.5 font-bold flex-shrink-0 ${c.skipped ? "text-muted" : c.ok ? "text-success" : "text-danger"}`}>
              {c.skipped ? "—" : c.ok ? "+" : "x"}
            </span>
            <div className="flex-1 min-w-0">
              <span className={`font-medium ${c.skipped ? "text-muted" : c.ok ? "" : "text-danger"}`}>{c.label}</span>
              <span className="text-muted ml-2 truncate">{c.detail}</span>
            </div>
          </li>
        ))}
      </ul>

      <p className={`text-xs mt-3 ${allPassed ? "text-success" : failed.length > 0 ? "text-danger" : "text-muted"}`}>
        {e2e.summary}
      </p>
      {e2e.lastCheckedAt && (
        <p className="text-xs text-muted mt-1">
          Kontrol: {new Date(e2e.lastCheckedAt).toLocaleTimeString("tr-TR")}
        </p>
      )}
    </div>
  );
}

function DynamicUniverseCard({ diagnostics }: { diagnostics: any }) {
  const stats = diagnostics?.tick_stats;
  if (!stats) return null;

  const opportunity = stats.dynamicOpportunityCandidates ?? 0;
  const pool = stats.dynamicCandidates ?? 0;
  const eliminated = stats.dynamicEliminatedLowSignal ?? 0;
  const lowVol = stats.dynamicRejectedLowVolume ?? 0;
  const insufficientDepth = stats.dynamicRejectedInsufficientDepth ?? 0;
  const noData = stats.dynamicRejectedNoData ?? 0;
  const highSpread = stats.dynamicRejectedHighSpread ?? 0;
  const weakMom = stats.dynamicRejectedWeakMomentum ?? 0;
  const pumpDump = stats.dynamicRejectedPumpDump ?? 0;
  const stable = stats.dynamicRejectedStablecoin ?? 0;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">Dinamik Evren Özeti</h2>
        <Link href="/scanner" className="text-xs text-accent">Detay →</Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
        <Stat label="Core (sabit)" value="10" />
        <Stat label="Dinamik Fırsat Adayı" value={String(opportunity)} accent={opportunity > 0 ? "accent" : undefined} />
        <Stat label="Aday Havuzu" value={String(pool)} />
        <Stat label="Elenen Sinyal Yok" value={String(eliminated)} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm mt-2">
        <Stat label="Düşük Hacim" value={String(lowVol)} />
        <Stat label="Yetersiz Likidite" value={String(insufficientDepth)} />
        <Stat label="Veri Yok" value={String(noData)} />
        <Stat label="Yüksek Spread" value={String(highSpread)} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm mt-2">
        <Stat label="Zayıf Momentum" value={String(weakMom)} />
        <Stat label="Pump/Dump" value={String(pumpDump)} />
        <Stat label="Stablecoin/Sentetik" value={String(stable)} />
      </div>
      {opportunity === 0 && pool === 0 && (
        <p className="text-xs text-muted mt-2">Worker henüz tarama yapmadı. Bot başlatıldığında veriler gelir.</p>
      )}
      {opportunity === 0 && pool > 0 && (
        <p className="text-xs text-muted mt-2">Aday havuzu dolu ama sinyal potansiyeli olan dynamic coin yok — tarayıcı sadece 10 core gösteriyor.</p>
      )}
    </div>
  );
}

function TopOpportunityCard({ diagnostics }: { diagnostics: any }) {
  const scanDetails: any[] = diagnostics?.scan_details ?? [];
  const { items, hasStrongOpportunity, insufficientData } = getTopOpportunities(scanDetails);

  if (scanDetails.length === 0) {
    return (
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Fırsata En Yakın 5 Coin</h2>
        </div>
        <p className="text-sm text-muted">Bot başlatıldığında tarama verisi gelir.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">Fırsata En Yakın 5 Coin</h2>
        <div className="flex items-center gap-2">
          {hasStrongOpportunity && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-success/20 text-success">
              Eşik geçildi
            </span>
          )}
          {!hasStrongOpportunity && insufficientData && (
            <span className="text-xs text-muted">Güçlü fırsat yok</span>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted">Skoru 0 üzeri coin bulunamadı — tarama sonrası veriler gelir.</p>
      ) : (
        <>
          {insufficientData && !hasStrongOpportunity && (
            <p className="text-xs text-muted mb-2">Güçlü fırsat yok — mevcut en yüksek skorlar gösteriliyor.</p>
          )}
          <div className="overflow-x-auto">
            <table className="t table-fixed w-full text-sm">
              <colgroup>
                <col className="w-[18%]" />
                <col className="w-[12%]" />
                <col className="w-[12%]" />
                <col className="w-[13%]" />
                <col className="w-[25%]" />
                <col className="w-[20%]" />
              </colgroup>
              <thead>
                <tr>
                  <th>Coin</th>
                  <th>Yön</th>
                  <th>Skor</th>
                  <th>Eksik</th>
                  <th>Ana Sebep</th>
                  <th>Bot Kararı</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.symbol}
                    className={item.aboveThreshold || item.opened ? "bg-success/5" : ""}
                  >
                    <td className="font-medium truncate" title={item.symbol}>{item.symbol}</td>
                    <td>
                      {item.signalType === "NO_TRADE" || !item.signalType ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <span className={`tag-${item.signalType === "LONG" ? "success" : "danger"}`}>
                          {item.signalType}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`font-semibold ${item.aboveThreshold ? "text-success" : item.score >= 60 ? "text-warning" : ""}`}>
                        {item.score}/100
                      </span>
                    </td>
                    <td className="text-muted">
                      {item.missingPoints > 0 ? `${item.missingPoints} puan` : <span className="text-success">—</span>}
                    </td>
                    <td className="text-xs text-muted truncate" title={item.mainReason}>{item.mainReason}</td>
                    <td className={`text-xs truncate ${item.opened ? "text-success font-medium" : item.aboveThreshold ? "text-success" : "text-muted"}`}>
                      {item.decision}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function ScannerVisibilityCard({ diagnostics, open, onToggle }: { diagnostics: any; open: boolean; onToggle: () => void }) {
  const details: any[] = diagnostics?.scan_details ?? [];
  const stats = diagnostics?.tick_stats;
  const lastTickAt = diagnostics?.last_tick_at;
  const ageLabel = lastTickAt
    ? `${Math.round((Date.now() - new Date(lastTickAt).getTime()) / 1000)}s önce`
    : "—";

  return (
    <div className="card">
      <button
        className="w-full text-left flex items-center justify-between"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          <span className="font-semibold">Tarama Görünümü</span>
          {stats && (
            <span className="text-xs text-muted">
              {stats.scanned} tarandı · {stats.signals} sinyal · {stats.opened} açıldı · {stats.rejected} reddedildi · {stats.durationMs}ms
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>Son tick: {ageLabel}</span>
          <span>{open ? "▾" : "▸"}</span>
        </div>
      </button>

      {open && (
        <div className="mt-3">
          {details.length === 0 ? (
            <p className="text-sm text-muted py-2">Henüz tarama verisi yok. Paper bot başlatıldığında ve worker tick çalıştığında burada sembol bazlı scan sonuçları görünecek.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="t w-full text-xs">
                <thead>
                  <tr>
                    <th>Sembol</th>
                    <th>Tier</th>
                    <th>Sinyal</th>
                    <th>Skor</th>
                    <th>Spread%</th>
                    <th>ATR%</th>
                    <th>Funding</th>
                    <th>Risk</th>
                    <th>Durum</th>
                    <th>Red Sebebi</th>
                  </tr>
                </thead>
                <tbody>
                  {details.map((d, i) => (
                    <tr key={i} className={d.opened ? "bg-success/5" : ""}>
                      <td className="font-medium">{d.symbol}</td>
                      <td>
                        <span className={`text-xs ${d.tier === "TIER_1" ? "text-success" : d.tier === "TIER_2" ? "text-accent" : d.tier === "TIER_3" ? "text-warning" : "text-danger"}`}>
                          {d.tier}
                        </span>
                      </td>
                      <td>
                        <span className={`tag-${d.signalType === "LONG" ? "success" : d.signalType === "SHORT" ? "danger" : "muted"}`}>
                          {d.signalType}
                        </span>
                      </td>
                      <td>{d.signalScore > 0 ? d.signalScore : "—"}</td>
                      <td className={d.spreadPercent > 0.1 ? "text-warning" : ""}>{d.spreadPercent > 0 ? d.spreadPercent.toFixed(3) : "—"}</td>
                      <td className={d.atrPercent > 5 ? "text-warning" : ""}>{d.atrPercent > 0 ? d.atrPercent.toFixed(2) : "—"}</td>
                      <td className={Math.abs(d.fundingRate) > 0.003 ? "text-warning" : ""}>{d.fundingRate !== 0 ? (d.fundingRate * 100).toFixed(4) + "%" : "—"}</td>
                      <td>
                        {d.riskAllowed === null ? <span className="text-muted">—</span>
                          : d.riskAllowed ? <span className="text-success">✓</span>
                          : <span className="text-danger">✗</span>}
                      </td>
                      <td>
                        {d.opened
                          ? <span className="text-success font-semibold">AÇILDI</span>
                          : <span className="text-muted">—</span>}
                      </td>
                      <td className="text-muted max-w-xs truncate" title={d.rejectReason ?? ""}>
                        {d.rejectReason ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Top reject reasons summary */}
          {(diagnostics?.last_rejected_signals ?? []).length > 0 && (
            <div className="mt-3 space-y-1">
              <div className="text-xs font-medium text-muted mb-1">En sık ret sebepleri:</div>
              {diagnostics.last_rejected_signals.slice(0, 5).map((r: string, i: number) => (
                <div key={i} className="text-xs text-muted">• {r}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
