"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { fmtNum, fmtPct } from "@/lib/format";

interface TickStats {
  universe: number;
  prefiltered: number;
  scanned: number;
  signals: number;
  rejected: number;
  opened: number;
  errors: number;
  durationMs: number;
}

interface ScanRow {
  symbol: string;
  tier: string;
  spreadPercent: number;
  atrPercent: number;
  fundingRate: number;
  orderBookDepth: number;
  signalType: string;
  signalScore: number;
  rejectReason: string | null;
  riskAllowed: boolean | null;
  riskRejectReason: string | null;
  opened: boolean;
}

interface DiagData {
  bot_status: string;
  trading_mode: string;
  active_exchange: string;
  last_tick_at: string | null;
  tick_stats: TickStats;
  scan_details: ScanRow[];
  worker_health: { online: boolean; status: string | null; ageMs: number | null };
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function ScannerPage() {
  const [data, setData] = useState<DiagData | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/bot/diagnostics", { cache: "no-store" }).then((r) => r.json());
      if (res.ok && res.data) {
        setData(res.data);
        setLastRefresh(new Date());
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const stats = data?.tick_stats;
  const rows = data?.scan_details ?? [];
  const exchange = data?.active_exchange ?? "binance";
  const workerOnline = data?.worker_health?.online ?? false;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Market Scanner</h1>
          <p className="text-xs text-muted mt-0.5">
            Tarama VPS worker tarafından otomatik yapılır. Bu buton sadece son tarama verilerini yeniler.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`tag ${workerOnline ? "tag-success" : "tag-danger"}`}>
            {workerOnline ? "WORKER ONLINE" : "WORKER OFFLINE"}
          </span>
          <span className="tag-muted">{exchange.toUpperCase()}</span>
          {data?.last_tick_at && (
            <span className="text-xs text-muted">Son tick: {fmtTime(data.last_tick_at)}</span>
          )}
          <button
            className="btn-primary whitespace-nowrap px-4"
            onClick={refresh}
            disabled={loading}
          >
            {loading ? "Yükleniyor..." : "Verileri Yenile"}
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="card grid grid-cols-4 gap-3 sm:grid-cols-8 text-center py-2">
          <div>
            <div className="text-xs text-muted">Universe</div>
            <div className="font-semibold tabular-nums">{stats.universe}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Ön Eleme</div>
            <div className="font-semibold tabular-nums">{stats.prefiltered}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Analiz</div>
            <div className="font-semibold tabular-nums">{stats.scanned}</div>
          </div>
          <div>
            <div className="text-xs text-success">Sinyal</div>
            <div className="font-semibold tabular-nums text-success">{stats.signals}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Reddedilen</div>
            <div className="font-semibold tabular-nums">{stats.rejected}</div>
          </div>
          <div>
            <div className="text-xs text-accent">Açılan</div>
            <div className="font-semibold tabular-nums text-accent">{stats.opened}</div>
          </div>
          <div>
            <div className="text-xs text-danger">Hata</div>
            <div className={`font-semibold tabular-nums ${stats.errors > 0 ? "text-danger" : ""}`}>
              {stats.errors}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted">Süre</div>
            <div className="font-semibold tabular-nums">{stats.durationMs}ms</div>
          </div>
        </div>
      )}

      {/* No data */}
      {!data && !loading && (
        <div className="card text-muted text-sm text-center py-8">
          Worker henüz tarama yapmadı. Worker çalışıyorsa ~30 saniyede veri gelir.
        </div>
      )}

      {rows.length === 0 && data && (
        <div className="card text-muted text-sm text-center py-6">
          Son tick tarama verisi boş. Worker bir sonraki tickte dolduracak.
        </div>
      )}

      {/* Scan details table */}
      {rows.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="t">
            <thead>
              <tr>
                <th>Sembol</th>
                <th>Tier</th>
                <th>Spread</th>
                <th>ATR%</th>
                <th>Funding</th>
                <th>Sinyal</th>
                <th>Skor</th>
                <th>Red Nedeni</th>
                <th>Açıldı</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol}>
                  <td className="font-medium">
                    <Link className="text-accent" href={`/coins/${encodeURIComponent(r.symbol)}?exchange=${exchange}`}>
                      {r.symbol}
                    </Link>
                  </td>
                  <td>
                    <span className={`tag-${r.tier === "TIER_1" ? "success" : r.tier === "TIER_2" ? "accent" : "muted"}`}>
                      {r.tier}
                    </span>
                  </td>
                  <td>{fmtPct(r.spreadPercent, 3)}</td>
                  <td>{fmtPct(r.atrPercent, 2)}</td>
                  <td>{fmtPct(r.fundingRate * 100, 4)}</td>
                  <td>
                    <span className={`tag-${r.signalType === "LONG" ? "success" : r.signalType === "SHORT" ? "danger" : "muted"}`}>
                      {r.signalType || "—"}
                    </span>
                  </td>
                  <td>{fmtNum(r.signalScore, 0)}</td>
                  <td className="text-xs text-muted max-w-xs truncate">
                    {r.rejectReason ?? r.riskRejectReason ?? "—"}
                  </td>
                  <td>
                    {r.opened
                      ? <span className="tag-success text-xs">✓</span>
                      : <span className="text-muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {lastRefresh && (
        <p className="text-xs text-muted text-right">
          Son güncelleme: {lastRefresh.toLocaleTimeString("tr-TR")}
        </p>
      )}
    </div>
  );
}
