"use client";
import { useEffect, useState } from "react";
import { fmtNum, fmtPct, fmtUsd } from "@/lib/format";

export default function PerformancePage() {
  const [perf, setPerf] = useState<any>(null);
  const [closed, setClosed] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const [p, t] = await Promise.all([
        fetch("/api/paper-trades/performance").then((r) => r.json()),
        fetch("/api/paper-trades?limit=200").then((r) => r.json()),
      ]);
      if (p.ok) setPerf(p.data);
      if (t.ok) setClosed(t.data.closed);
    })();
  }, []);

  let equity = 0;
  const points = (closed ?? []).slice().reverse().map((t) => { equity += Number(t.pnl ?? 0); return equity; });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Performance</h1>
      <div className="grid md:grid-cols-4 gap-3">
        <Kpi label="Total PnL" value={fmtUsd(perf?.totalPnl ?? 0)} accent={(perf?.totalPnl ?? 0) >= 0 ? "success" : "danger"} />
        <Kpi label="Win Rate" value={fmtPct(perf?.winRate ?? 0)} />
        <Kpi label="Profit Factor" value={fmtNum(perf?.profitFactor ?? 0)} />
        <Kpi label="Max Drawdown" value={fmtUsd(perf?.maxDrawdown ?? 0)} accent="danger" />
      </div>
      <div className="card">
        <h2 className="font-semibold mb-2">Equity (paper, kronolojik)</h2>
        {points.length === 0 ? <div className="text-muted text-sm">veri yok</div> : (
          <svg viewBox={`0 0 ${Math.max(200, points.length * 6)} 120`} className="w-full h-32">
            {(() => {
              const w = Math.max(200, points.length * 6), h = 120, pad = 6;
              const min = Math.min(0, ...points), max = Math.max(0, ...points);
              const range = Math.max(1e-9, max - min);
              const sx = (w - pad * 2) / Math.max(1, points.length - 1);
              const path = points.map((v, i) => {
                const x = pad + i * sx;
                const y = h - pad - ((v - min) / range) * (h - pad * 2);
                return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
              }).join(" ");
              return <path d={path} fill="none" stroke="#22d3ee" strokeWidth={1.6} />;
            })()}
          </svg>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: "success" | "danger" }) {
  const cls = accent === "success" ? "value-positive" : accent === "danger" ? "value-negative" : "";
  return <div className="card"><div className="label">{label}</div><div className={`kpi ${cls}`}>{value}</div></div>;
}
