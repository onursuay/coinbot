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

  const addToast = (t: Omit<Toast, "id">) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 8000);
  };

  const [envCheck, setEnvCheck] = useState<any>(null);

  const refresh = async () => {
    const noCache: RequestInit = { cache: "no-store" };
    const [a, b, c, d, e] = await Promise.all([
      fetch("/api/bot/status", noCache).then((r) => r.json()).catch(() => null),
      fetch("/api/paper-trades/performance", noCache).then((r) => r.json()).catch(() => null),
      fetch("/api/signals?limit=10", noCache).then((r) => r.json()).catch(() => null),
      fetch("/api/paper-trades?limit=20", noCache).then((r) => r.json()).catch(() => null),
      fetch("/api/system/env-check", noCache).then((r) => r.json()).catch(() => null),
    ]);
    if (a?.ok) setStatus(a.data);
    if (b?.ok) setPerf(b.data);
    if (c?.ok) setSignals(c.data ?? []);
    if (d?.ok) setPaper(d.data);
    if (e?.ok) setEnvCheck(e.data);
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, []);

  const act = async (path: string, label: string) => {
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
      const res = await fetch(path, { method: "POST" }).then((r) => r.json());
      if (path.endsWith("/start")) setLastStartResponse(res);
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
      addToast({
        type: "error",
        message: "Supabase env missing. Tick skipped.",
        detail: [...(envCheck.missing ?? []), ...(envCheck.empty ?? [])].join(", "),
      });
      return;
    }
    const dbgStatus = (status?.debug?.botStatus ?? "").toString().toLowerCase();
    const rawStatus = status?.bot?.bot_status;
    const currentStatus = dbgStatus || rawStatus;
    if (currentStatus !== "running") {
      addToast({
        type: "info",
        message: "Bot stopped. Press Start first.",
        detail: `Mevcut durum: ${(currentStatus ?? "stopped").toUpperCase()}`,
      });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/bot/tick", { method: "POST" }).then((r) => r.json());
      if (!res.ok) {
        addToast({ type: "error", message: "Tick başarısız", detail: res.error });
        return;
      }
      const t: TickResult = res.data;
      setLastTick(t);
      if (!t.ok) {
        addToast({
          type: "info",
          message: "Tick skipped",
          detail: t.reason ?? "Bot running değil veya koşul sağlanamadı",
        });
      } else {
        const detail = [
          `${t.scannedSymbols.length} sembol tarandı`,
          `${t.generatedSignals.length} sinyal üretildi`,
          `${t.openedPaperTrades.length} paper trade açıldı`,
          t.rejectedSignals.length > 0 ? `${t.rejectedSignals.length} reddedildi` : null,
          t.errors.length > 0 ? `${t.errors.length} hata` : null,
          `${t.durationMs}ms`,
        ].filter(Boolean).join(" • ");
        addToast({
          type: t.openedPaperTrades.length > 0 ? "success" : "info",
          message: `Tick tamamlandı`,
          detail,
        });
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
        <div className="flex gap-2 flex-wrap">
          <button className="btn-ghost" onClick={() => act("/api/bot/start", "Start")} disabled={busy}>Start</button>
          <button className="btn-ghost" onClick={() => act("/api/bot/pause", "Pause")} disabled={busy}>Pause</button>
          <button className="btn-ghost" onClick={() => act("/api/bot/resume", "Resume")} disabled={busy}>Resume</button>
          <button className="btn-ghost" onClick={() => act("/api/bot/stop", "Stop")} disabled={busy}>Stop</button>
          <button className="btn-primary" onClick={runTick} disabled={busy}>{busy ? "Çalışıyor…" : "Run Tick"}</button>
        </div>
      </div>

      {/* Tick result summary card */}
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
            <div className="mt-2 text-xs text-muted">
              Hiç sinyal açılmadı. Sebep: {dominantRejection}
            </div>
          )}
          {lastTick.errors.length > 0 && (
            <div className="mt-2 text-xs text-danger">
              Hata: {lastTick.errors[0].symbol} — {lastTick.errors[0].error}
            </div>
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

      {/* System Config Status */}
      <SystemConfigCard envCheck={envCheck} status={status} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="card">
          <h2 className="font-semibold mb-3">Latest Signals</h2>
          <table className="t">
            <thead><tr><th>Sym</th><th>TF</th><th>Tip</th><th>Skor</th><th>R:R</th><th>Neden / Red</th></tr></thead>
            <tbody>
              {signals.length === 0 && (
                <tr><td colSpan={6} className="text-muted text-sm py-3">
                  Henüz sinyal yok — Run Tick ile tarama başlatın.
                </td></tr>
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
          <h2 className="font-semibold mb-3">Open Paper Positions</h2>
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
  liveTrading: status?.liveTrading,
  openPositions: status?.openPositions,
  lastStartResponse,
}, null, 2)}
          </pre>
        )}
      </div>

      <div className="card">
        <h2 className="font-semibold mb-2">Sistem Garantileri</h2>
        <p className="text-sm text-muted">
          Varsayılan mod <span className="text-success">PAPER</span> — live trading{" "}
          <code className="mx-1 text-warning">LIVE_TRADING=true</code> olmadan emir göndermez.
          Maks. kaldıraç <span className="text-warning">5x</span> ile kilitlidir.
          Martingale, revenge trading, full-balance trade ve 5x+ kaldıraç tasarımca yasaktır.
        </p>
      </div>
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
        <div className="mt-2 text-xs text-warning">
          {envCheck.warnings.join(" • ")}
        </div>
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
