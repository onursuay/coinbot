"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { fmtNum, fmtPct, fmtUsd } from "@/lib/format";

export default function HomePage() {
  const [status, setStatus] = useState<any>(null);
  const [perf, setPerf] = useState<any>(null);
  const [signals, setSignals] = useState<any[]>([]);
  const [paper, setPaper] = useState<{ open: any[]; closed: any[] }>({ open: [], closed: [] });
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const [a, b, c, d] = await Promise.all([
      fetch("/api/bot/status").then((r) => r.json()),
      fetch("/api/paper-trades/performance").then((r) => r.json()),
      fetch("/api/signals?limit=10").then((r) => r.json()),
      fetch("/api/paper-trades?limit=20").then((r) => r.json()),
    ]);
    if (a.ok) setStatus(a.data);
    if (b.ok) setPerf(b.data);
    if (c.ok) setSignals(c.data ?? []);
    if (d.ok) setPaper(d.data);
  };
  useEffect(() => { refresh(); const t = setInterval(refresh, 10_000); return () => clearInterval(t); }, []);

  const act = async (path: string) => {
    setBusy(true);
    try { await fetch(path, { method: "POST" }); await refresh(); } finally { setBusy(false); }
  };

  const daily = status?.daily;
  const distance = Math.max(0, (daily?.dailyTargetUsd ?? 20) - (daily?.realizedPnlUsd ?? 0));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => act("/api/bot/start")} disabled={busy}>Start</button>
          <button className="btn-ghost" onClick={() => act("/api/bot/pause")} disabled={busy}>Pause</button>
          <button className="btn-ghost" onClick={() => act("/api/bot/resume")} disabled={busy}>Resume</button>
          <button className="btn-ghost" onClick={() => act("/api/bot/stop")} disabled={busy}>Stop</button>
          <button className="btn-primary" onClick={() => act("/api/bot/tick")} disabled={busy}>Run Tick</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Kpi label="Daily PnL" value={fmtUsd(daily?.realizedPnlUsd ?? 0)} accent={(daily?.realizedPnlUsd ?? 0) >= 0 ? "success" : "danger"} />
        <Kpi label="Daily Target" value={fmtUsd(daily?.dailyTargetUsd ?? 20)} sub={daily?.targetHit ? "Hedef tamam" : `Kalan ${fmtUsd(distance)}`} />
        <Kpi label="Total PnL (paper)" value={fmtUsd(perf?.totalPnl ?? 0)} accent={(perf?.totalPnl ?? 0) >= 0 ? "success" : "danger"} />
        <Kpi label="Win Rate" value={fmtPct(perf?.winRate ?? 0)} sub={`${perf?.totalTrades ?? 0} işlem`} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Kpi label="Profit Factor" value={fmtNum(perf?.profitFactor ?? 0)} />
        <Kpi label="Max Drawdown" value={fmtUsd(perf?.maxDrawdown ?? 0)} accent="danger" />
        <Kpi label="Open Positions" value={String(status?.openPositions ?? 0)} sub={`max ${status?.config?.maxAllowedLeverage ?? 5}x lev`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="card">
          <h2 className="font-semibold mb-3">Latest Signals</h2>
          <table className="t">
            <thead><tr><th>Sym</th><th>TF</th><th>Tip</th><th>Skor</th><th>R:R</th><th>Neden</th></tr></thead>
            <tbody>
              {signals.length === 0 && <tr><td colSpan={6} className="text-muted">henüz sinyal yok</td></tr>}
              {signals.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium">{s.symbol}</td>
                  <td>{s.timeframe}</td>
                  <td><span className={`tag-${s.signal_type === "LONG" ? "success" : s.signal_type === "SHORT" ? "danger" : "muted"}`}>{s.signal_type}</span></td>
                  <td>{fmtNum(s.signal_score, 0)}</td>
                  <td>{s.risk_reward_ratio ? `1:${fmtNum(s.risk_reward_ratio)}` : "—"}</td>
                  <td className="text-xs text-muted truncate max-w-xs">{s.rejected_reason ?? (Array.isArray(s.reasons) ? s.reasons[0] : "")}</td>
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
              {paper.open.length === 0 && <tr><td colSpan={6} className="text-muted">açık pozisyon yok</td></tr>}
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
        <h2 className="font-semibold mb-2">Disclaimer</h2>
        <p className="text-sm text-muted">
          Bu sistem garanti kâr iddiası taşımaz. Varsayılan mod paper trading'dir; live trading
          <code className="mx-1 text-warning">LIVE_TRADING=true</code> + risk engine + credential validation
          olmadan emir göndermez. Maks. kaldıraç sistemce <span className="text-warning">5x</span> ile kilitlenmiştir.
          Martingale, revenge trading, full balance işlem ve 5x üstü kaldıraç tasarımca yasaktır.
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
