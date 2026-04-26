"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { fmtNum, fmtPct, fmtUsd } from "@/lib/format";

const EXCHANGES = ["mexc", "binance", "okx", "bybit"] as const;

export default function ScannerPage() {
  const [exchange, setExchange] = useState<(typeof EXCHANGES)[number]>("mexc");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const run = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/scanner?exchange=${exchange}`).then((r) => r.json());
      if (res.ok) setRows(res.data);
    } finally { setLoading(false); }
  };
  useEffect(() => { run(); }, [exchange]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Market Scanner</h1>
        <div className="flex gap-2 items-center">
          <select className="input w-32" value={exchange} onChange={(e) => setExchange(e.target.value as any)}>
            {EXCHANGES.map((x) => <option key={x} value={x}>{x.toUpperCase()}</option>)}
          </select>
          <button className="btn-primary" onClick={run} disabled={loading}>{loading ? "Tarıyor..." : "Yeniden Tara"}</button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="t">
          <thead>
            <tr>
              <th>Sym</th><th>Fiyat</th><th>24s Hacim</th><th>Spread</th><th>Funding</th>
              <th>Trend</th><th>Vol</th><th>Volatilite</th><th>Sinyal</th><th>Skor</th><th>Sınıf</th><th>Neden</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={12} className="text-muted">veri yok</td></tr>}
            {rows.map((r) => (
              <tr key={`${r.exchange}-${r.symbol}`}>
                <td className="font-medium"><Link className="text-accent" href={`/coins/${encodeURIComponent(r.symbol)}?exchange=${r.exchange}`}>{r.symbol}</Link></td>
                <td>{fmtNum(r.price, 4)}</td>
                <td>{fmtUsd(r.volume24hUsd, 0)}</td>
                <td>{fmtPct(r.spread * 100, 3)}</td>
                <td>{r.fundingRate !== null ? fmtPct(r.fundingRate * 100, 4) : "—"}</td>
                <td>{fmtNum(r.trendScore, 0)}</td>
                <td>{fmtNum(r.volumeScore, 0)}</td>
                <td>{fmtNum(r.volatilityScore, 0)}</td>
                <td><span className={`tag-${r.signal === "LONG" ? "success" : r.signal === "SHORT" ? "danger" : "muted"}`}>{r.signal}</span></td>
                <td>{fmtNum(r.signalScore, 0)}</td>
                <td>
                  <span className={`tag-${r.classification === "tradeable" ? "success" : r.classification === "watchlist" ? "accent" : r.classification === "high_risk" ? "warning" : "muted"}`}>
                    {r.classification}
                  </span>
                </td>
                <td className="text-xs text-muted max-w-sm truncate">{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
