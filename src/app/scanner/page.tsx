"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { fmtNum, fmtPct, fmtUsd } from "@/lib/format";

const EXCHANGES = ["mexc", "binance", "okx", "bybit"] as const;
const UNIVERSES = [
  { value: "all_futures", label: "All Futures Markets" },
  { value: "top_volume", label: "Top Volume Futures" },
  { value: "watchlist_only", label: "Watchlist Only" },
] as const;

function fmtTime(ts: number | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

interface ScanStats {
  totalUniverse: number;
  preFiltered: number;
  deepAnalyzed: number;
  signalLong: number;
  signalShort: number;
  signalNoTrade: number;
  signalWait: number;
  nextCursor: string;
}

export default function ScannerPage() {
  const [exchange, setExchange] = useState<(typeof EXCHANGES)[number]>("mexc");
  const [universe, setUniverse] = useState<"all_futures" | "top_volume" | "watchlist_only">("all_futures");
  const [rows, setRows] = useState<any[]>([]);
  const [stats, setStats] = useState<ScanStats | null>(null);
  const [cursor, setCursor] = useState("0");
  const [loading, setLoading] = useState(false);
  const [debug, setDebug] = useState(false);

  const run = async (cur = "0") => {
    setLoading(true);
    try {
      const res = await fetch(`/api/scanner?exchange=${exchange}&universe=${universe}&cursor=${cur}`).then((r) => r.json());
      if (res.ok && res.data) {
        setRows(res.data.rows ?? []);
        setStats(res.data.stats ?? null);
        if (res.data.stats?.nextCursor) setCursor(res.data.stats.nextCursor);
      }
    } finally { setLoading(false); }
  };

  useEffect(() => { setCursor("0"); run("0"); }, [exchange, universe]);

  const colSpan = debug ? 16 : 12;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-semibold">Market Scanner</h1>
        <div className="flex gap-2 items-center flex-wrap">
          <label className="flex items-center gap-1 text-sm text-muted cursor-pointer">
            <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} className="accent-accent" />
            Debug
          </label>
          <select className="input w-40" value={universe} onChange={(e) => setUniverse(e.target.value as any)}>
            {UNIVERSES.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
          <select className="input w-32" value={exchange} onChange={(e) => setExchange(e.target.value as any)}>
            {EXCHANGES.map((x) => <option key={x} value={x}>{x.toUpperCase()}</option>)}
          </select>
          <button className="btn-primary whitespace-nowrap px-4" onClick={() => run(cursor)} disabled={loading}>
            {loading ? "Tarıyor..." : "Yeniden Tara"}
          </button>
          {stats?.nextCursor && stats.nextCursor !== "0" && (
            <button className="btn-secondary whitespace-nowrap px-3 text-sm" onClick={() => run(stats.nextCursor)} disabled={loading}>
              Sonraki Batch →
            </button>
          )}
        </div>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="card grid grid-cols-4 gap-3 sm:grid-cols-7 text-center py-2">
          <div>
            <div className="text-xs text-muted">Universe</div>
            <div className="font-semibold tabular-nums">{stats.totalUniverse}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Ön Eleme</div>
            <div className="font-semibold tabular-nums">{stats.preFiltered}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Analiz</div>
            <div className="font-semibold tabular-nums">{stats.deepAnalyzed}</div>
          </div>
          <div>
            <div className="text-xs text-success">LONG</div>
            <div className="font-semibold tabular-nums text-success">{stats.signalLong}</div>
          </div>
          <div>
            <div className="text-xs text-danger">SHORT</div>
            <div className="font-semibold tabular-nums text-danger">{stats.signalShort}</div>
          </div>
          <div>
            <div className="text-xs text-muted">WAIT</div>
            <div className="font-semibold tabular-nums">{stats.signalWait}</div>
          </div>
          <div>
            <div className="text-xs text-muted">NO_TRADE</div>
            <div className="font-semibold tabular-nums">{stats.signalNoTrade}</div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card overflow-x-auto">
        <table className="t">
          <thead>
            <tr>
              <th>Sym</th><th>Fiyat</th><th>24s Hacim</th><th>Spread</th><th>Funding</th>
              <th>Trend</th><th>Vol</th><th>Volatilite</th><th>Sinyal</th><th>Skor</th><th>Sınıf</th><th>Neden</th>
              {debug && <><th title="Candle count">Mum</th><th title="Last candle close time">Son Mum</th><th title="Indicator status">İnd. Durum</th><th title="ATR % of close">ATR%</th><th title="RSI">RSI</th></>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={colSpan} className="text-muted">{loading ? "Taranıyor..." : "veri yok"}</td></tr>}
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
                {debug && <>
                  <td className="text-xs tabular-nums">{r.candleCount ?? "—"}</td>
                  <td className="text-xs tabular-nums">{fmtTime(r.lastCandleTime)}</td>
                  <td className={`text-xs ${r.indicatorStatus === "ok" ? "text-success" : r.indicatorStatus === "error" ? "text-danger" : "text-muted"}`}>{r.indicatorStatus ?? "—"}</td>
                  <td className="text-xs tabular-nums">{r.atrPct !== null && r.atrPct !== undefined ? fmtNum(r.atrPct, 3) + "%" : "—"}</td>
                  <td className="text-xs tabular-nums">{r.rsi !== null && r.rsi !== undefined ? fmtNum(r.rsi, 1) : "—"}</td>
                </>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
