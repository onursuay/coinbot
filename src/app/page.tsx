"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fmtNum, fmtPct, fmtUsd } from "@/lib/format";

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
  const [signals, setSignals] = useState<any[]>([]);
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

  const addToast = (t: Omit<Toast, "id">) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 8000);
  };

  const refresh = async () => {
    const noCache: RequestInit = { cache: "no-store" };
    const [a, b, c, d, e, f, g] = await Promise.all([
      fetch("/api/bot/status", noCache).then((r) => r.json()).catch(() => null),
      fetch("/api/paper-trades/performance", noCache).then((r) => r.json()).catch(() => null),
      fetch("/api/signals?limit=10", noCache).then((r) => r.json()).catch(() => null),
      fetch("/api/paper-trades?limit=20", noCache).then((r) => r.json()).catch(() => null),
      fetch("/api/system/env-check", noCache).then((r) => r.json()).catch(() => null),
      fetch("/api/bot/heartbeat", noCache).then((r) => r.json()).catch(() => null),
      fetch("/api/bot/strategy-health", noCache).then((r) => r.json()).catch(() => null),
    ]);
    if (a?.ok) {
      setStatus(a.data);
      setHardLiveAllowed(a.data?.hardLiveTradingAllowed ?? false);
    }
    if (b?.ok) setPerf(b.data);
    if (c?.ok) setSignals(c.data ?? []);
    if (d?.ok) setPaper(d.data);
    if (e?.ok) setEnvCheck(e.data);
    if (f?.ok) setWorkerHealth(f.data);
    if (g?.ok) setStrategyHealth(g.data);
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
  const activeExchange = status?.bot?.active_exchange ?? "binance";

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

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Dashboard</h1>
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
          <InfoRow label="Live Enable" value={enableLiveTrading ? "Evet" : "Hayır"} accent={enableLiveTrading ? "danger" : "muted"} />
          <InfoRow label="HARD_LIVE_GATE" value={hardLiveAllowed ? "AÇIK" : "KAPALI"} accent={hardLiveAllowed ? "warning" : "success"} />
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-primary text-sm px-4 py-2"
            onClick={() => actWithBody("/api/bot/start", "Start Paper Bot", { mode: "paper", enableLive: false })}
            disabled={busy || isRunning}
          >
            Paper Başlat
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
            Live Başlat {!hardLiveAllowed && "🔒"}
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
            Acil Dur
          </button>

          <button className="btn-primary text-sm px-4 py-2 ml-auto" onClick={runTick} disabled={busy}>
            {busy ? "Çalışıyor…" : "Tick Çalıştır"}
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
          <h2 className="font-semibold">Worker Durumu</h2>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${workerHealth?.online ? "bg-success/20 text-success" : "bg-warning/20 text-warning"}`}>
            {workerHealth?.online ? "ONLINE" : "OFFLINE / YOK"}
          </span>
        </div>
        {workerHealth ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <InfoRow label="Worker ID" value={workerHealth.workerId ?? "—"} />
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
          Worker 60+ saniye heartbeat göndermezse OFFLINE sayılır. Dashboard yokken bile çalışması için VPS/Docker'da çalıştır.
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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Kpi label="Daily PnL" value={fmtUsd(daily?.realizedPnlUsd ?? 0)} accent={(daily?.realizedPnlUsd ?? 0) >= 0 ? "success" : "danger"} />
        <Kpi label="Daily Target" value={fmtUsd(daily?.dailyTargetUsd ?? 20)} sub={daily?.targetHit ? "Hedef tamam!" : `Kalan ${fmtUsd(distance)}`} />
        <Kpi label="Total PnL (paper)" value={fmtUsd(perf?.totalPnl ?? 0)} accent={(perf?.totalPnl ?? 0) >= 0 ? "success" : "danger"} />
        <Kpi label="Win Rate" value={fmtPct(perf?.winRate ?? 0)} sub={`${perf?.totalTrades ?? 0} işlem`} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Kpi label="Profit Factor" value={fmtNum(perf?.profitFactor ?? 0)} />
        <Kpi label="Max Drawdown" value={fmtUsd(perf?.maxDrawdown ?? 0)} accent="danger" />
        <Kpi label="Open Positions" value={String(status?.openPositions ?? 0)} sub={`max ${status?.config?.maxAllowedLeverage ?? 5}x lev`} />
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

      {/* System Config Status */}
      <SystemConfigCard envCheck={envCheck} status={status} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="card">
          <h2 className="font-semibold mb-3">Son Sinyaller</h2>
          <table className="t">
            <thead><tr><th>Sym</th><th>TF</th><th>Tip</th><th>Skor</th><th>R:R</th><th>Neden / Red</th></tr></thead>
            <tbody>
              {signals.length === 0 && (
                <tr><td colSpan={6} className="text-muted text-sm py-3">Henüz sinyal yok — Tick Çalıştır ile tarama başlatın.</td></tr>
              )}
              {signals.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium">{s.symbol}</td>
                  <td>{s.timeframe}</td>
                  <td>
                    <span className={`tag-${s.signal_type === "LONG" ? "success" : s.signal_type === "SHORT" ? "danger" : "muted"}`}>
                      {s.signal_type}
                    </span>
                  </td>
                  <td>{fmtNum(s.signal_score, 0)}</td>
                  <td>{s.risk_reward_ratio ? `1:${fmtNum(s.risk_reward_ratio)}` : "—"}</td>
                  <td className="text-xs text-muted truncate max-w-xs">
                    {s.rejected_reason ?? (Array.isArray(s.reasons) ? s.reasons[0] : "")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Link href="/scanner" className="text-accent text-sm mt-2 inline-block">Scanner →</Link>
        </section>

        <section className="card">
          <h2 className="font-semibold mb-3">Açık Paper Pozisyonlar</h2>
          <table className="t">
            <thead><tr><th>Sym</th><th>Yön</th><th>Lev</th><th>Entry</th><th>SL</th><th>TP</th></tr></thead>
            <tbody>
              {paper.open.length === 0 && (
                <tr><td colSpan={6} className="text-muted text-sm py-3">Açık pozisyon yok</td></tr>
              )}
              {paper.open.map((t) => (
                <tr key={t.id}>
                  <td className="font-medium">{t.symbol}</td>
                  <td><span className={`tag-${t.direction === "LONG" ? "success" : "danger"}`}>{t.direction}</span></td>
                  <td>{t.leverage}x</td>
                  <td>{fmtNum(t.entry_price, 4)}</td>
                  <td>{fmtNum(t.stop_loss, 4)}</td>
                  <td>{fmtNum(t.take_profit, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Link href="/paper-trades" className="text-accent text-sm mt-2 inline-block">Tüm işlemler →</Link>
        </section>
      </div>

      <div className="card">
        <button
          className="text-xs text-muted hover:text-accent w-full text-left flex items-center justify-between"
          onClick={() => setDebugOpen((v) => !v)}
        >
          <span>Debug {debugOpen ? "▾" : "▸"}</span>
          <span className="text-muted">
            {(status?.debug?.botStatus ?? "—").toString().toUpperCase()} • src:{status?.debug?.source ?? "—"} • row:{status?.debug?.hasSettingsRow ? "yes" : "no"}
          </span>
        </button>
        {debugOpen && (
          <pre className="text-xs text-muted bg-bg-soft border border-border rounded-lg p-3 mt-2 overflow-x-auto">
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
        )}
      </div>

      <div className="card">
        <h2 className="font-semibold mb-2">Sistem Garantileri</h2>
        <p className="text-sm text-muted">
          Varsayılan mod <span className="text-success">PAPER</span> — live trading{" "}
          <code className="mx-1 text-warning">HARD_LIVE_TRADING_ALLOWED=true</code> + DB enable_live_trading olmadan emir göndermez.
          Maks. kaldıraç <span className="text-warning">5x</span> ile kilitlidir.
          Triple gate: env + DB.trading_mode + DB.enable_live_trading.
        </p>
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
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cls}`}>
      {status.toUpperCase().replace("_", " ")}
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
        <h2 className="font-semibold">System Status</h2>
        {!envCheck.ok && <span className="tag-danger text-xs">CONFIG INCOMPLETE</span>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        <ConfigRow label="Connection" value={connectionOk ? "Connected" : "Error"} ok={connectionOk} />
        <ConfigRow label="Security" value={securityOk ? "Active" : "Error"} ok={securityOk} />
        <ConfigRow label="Live Trading" value={cfg.liveTrading ? "Enabled" : "Disabled"} ok={!cfg.liveTrading} />
        <ConfigRow label="Default Leverage" value={`${cfg.maxLeverage ?? 3}x`} ok />
        <ConfigRow label="Max Allowed Leverage" value={`${cfg.maxAllowedLeverage ?? 5}x`} ok />
        <ConfigRow label="Hard Cap" value={`${cfg.hardCap ?? 5}x`} ok />
      </div>
      {!envCheck.ok && (
        <div className="mt-3 rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
          System configuration is incomplete. Please contact support.
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
