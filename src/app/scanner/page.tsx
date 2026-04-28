"use client";
import { useState } from "react";
import Link from "next/link";
import { fmtPct } from "@/lib/format";
import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh";

interface TickStats {
  universe: number;
  prefiltered: number;
  scanned: number;
  lowVolumeRejected?: number;
  signals: number;
  rejected: number;
  opened: number;
  errors: number;
  durationMs: number;
  dynamicCandidates?: number;                // pre-filter pool size (volume/spread/momentum gates passed)
  dynamicOpportunityCandidates?: number;     // in-table count — only coins with real signal potential
  dynamicEliminatedLowSignal?: number;       // analyzed but no opportunity (total of three below)
  dynamicEliminatedQuality?: number;
  dynamicEliminatedSetup?: number;
  dynamicEliminatedSignal?: number;
  dynamicBtcTrendRejected?: number;
  dynamicRejectedLowVolume?: number;
  dynamicRejectedStablecoin?: number;
  dynamicRejectedHighSpread?: number;
  dynamicRejectedPumpDump?: number;
  dynamicRejectedWeakMomentum?: number;
  dynamicRejectedNoData?: number;
  dynamicRejectedInsufficientDepth?: number;
}

interface ScanRow {
  symbol: string;
  coinClass?: "CORE" | "DYNAMIC";
  tier: string;
  spreadPercent: number;
  atrPercent: number;
  fundingRate: number;
  orderBookDepth: number;
  signalType: string;
  signalScore: number;
  setupScore?: number;
  marketQualityScore?: number;
  scoreType?: "signal" | "setup" | "none";
  scoreReason?: string;
  rejectReason: string | null;
  riskAllowed: boolean | null;
  riskRejectReason: string | null;
  opened: boolean;
  opportunityCandidate?: boolean;
}

interface TickIdentity {
  worker_id:    string | null;
  container_id: string | null;
  git_commit:   string | null;
  process_pid:  number | null;
  generated_at: string | null;
}

interface DiagData {
  bot_status: string;
  trading_mode: string;
  active_exchange: string;
  last_tick_at: string | null;
  tick_stats: TickStats;
  scan_details: ScanRow[];
  worker_health: { online: boolean; status: string | null; ageMs: number | null };
  tick_identity: TickIdentity | null;
}

export default function ScannerPage() {
  const [data, setData] = useState<DiagData | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/bot/diagnostics", { cache: "no-store" }).then((r) => r.json());
      if (res.ok && res.data) {
        setData(res.data);
      }
    } finally {
      setLoading(false);
    }
  };

  useAutoRefresh(refresh);

  const stats = data?.tick_stats;
  const rows = data?.scan_details ?? [];
  const exchange = data?.active_exchange ?? "binance";

  // Görünürlük metrikleri — backend'den gelen mevcut veriden hesaplanır,
  // trading logic'i etkilemez. Tablo `scan_details` zaten worker tarafında
  // görünürlük filtresinden geçirilmiş hâlde gelir.
  const analyzedCount = stats?.scanned ?? 0;
  const visibleCount = rows.length;
  const visibleCoreCount = rows.filter((r) => (r.coinClass ?? "CORE") === "CORE").length;
  const visibleDynamicCount = rows.filter((r) => r.coinClass === "DYNAMIC").length;
  const dynamicCandidates = stats?.dynamicCandidates ?? 0;
  const filteredDynamicCount = Math.max(0, dynamicCandidates - visibleDynamicCount);

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      {stats && (
        <div className="card py-2 relative space-y-2">
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-9 text-center">
            <div>
              <div className="text-xs text-muted">Evren</div>
              <div className="font-semibold tabular-nums">{stats.universe}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Ön Eleme</div>
              <div className="font-semibold tabular-nums">{stats.prefiltered}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Hacim Filtresi</div>
              <div className="font-semibold tabular-nums text-muted">{stats.lowVolumeRejected ?? 0}</div>
            </div>
            <div>
              <div className="text-xs text-muted" title="Worker'ın değerlendirdiği toplam coin">Analiz Edilen</div>
              <div className="font-semibold tabular-nums">{analyzedCount}</div>
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

          {/* Görünürlük satırı — analiz edilen ile tabloda gösterilen ayrımı */}
          <div className="border-t border-default/40 pt-2 grid grid-cols-2 gap-3 sm:grid-cols-4 text-center">
            <div title="Scanner görünürlük filtresini geçen ve tabloda listelenen coin sayısı">
              <div className="text-xs text-muted">Tabloda Gösterilen</div>
              <div className="font-semibold tabular-nums">{visibleCount}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Core Gösterilen</div>
              <div className="font-semibold tabular-nums">{visibleCoreCount}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Dynamic Gösterilen</div>
              <div className="font-semibold tabular-nums">{visibleDynamicCount}</div>
            </div>
            <div title="Dynamic havuzdan filtrelenip tabloya alınmayan coin sayısı (kalite/setup/sinyal/likidite)">
              <div className="text-xs text-muted">Dynamic Filtrelenen</div>
              <div className="font-semibold tabular-nums text-muted">{filteredDynamicCount}</div>
            </div>
          </div>

          {/* Açıklama satırı */}
          {analyzedCount > 0 && (
            <div className="text-xs text-muted text-center px-2">
              {visibleDynamicCount === 0 ? (
                <>
                  Bu taramada dynamic fırsat adayı bulunmadı. Bu nedenle tabloda yalnızca {visibleCoreCount} core coin gösteriliyor.
                  {analyzedCount !== visibleCount && (
                    <> ({analyzedCount} analiz edildi · {visibleCount} gösteriliyor)</>
                  )}
                </>
              ) : (
                <>
                  Bu taramada {visibleCoreCount} core + {visibleDynamicCount} dynamic fırsat adayı gösteriliyor.
                  {analyzedCount !== visibleCount && (
                    <> ({analyzedCount} analiz edildi · {visibleCount} gösteriliyor)</>
                  )}
                </>
              )}
            </div>
          )}
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
                <th>Sınıf</th>
                <th>Kademe</th>
                <th>Spread</th>
                <th>ATR%</th>
                <th>Fonlama</th>
                <th>Sinyal</th>
                <th title="Piyasa kalite skoru — hacim, spread, derinlik, ATR, fonlama sağlığı">Kalite</th>
                <th title="Fırsat yapısı skoru — EMA/MA/MACD/RSI/Bollinger/ADX/VWAP/Hacim uyumu; WAIT dahil hesaplanır">Fırsat</th>
                <th title="İşlem güven skoru — 70+ = işlem açılır; sadece yön belirlenen coinlerde anlamlı">İşlem</th>
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
                    <span className={`tag-${r.coinClass === "DYNAMIC" ? "accent" : "muted"}`}>
                      {r.coinClass ?? "CORE"}
                    </span>
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
                  <td>
                    {(r.marketQualityScore ?? 0) > 0 ? (
                      <span className={`text-xs font-medium ${(r.marketQualityScore ?? 0) >= 70 ? "text-success" : (r.marketQualityScore ?? 0) >= 50 ? "text-warning" : "text-muted"}`}>
                        {r.marketQualityScore}
                      </span>
                    ) : (
                      <span className="text-muted text-xs">—</span>
                    )}
                  </td>
                  <td title={r.scoreReason ?? ""}>
                    {(r.setupScore ?? 0) > 0 ? (
                      <span className={`font-semibold ${(r.setupScore ?? 0) >= 70 ? "text-success" : (r.setupScore ?? 0) >= 50 ? "text-warning" : ""}`}>
                        {r.setupScore}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td>
                    {r.signalScore > 0 ? (
                      <span className={`text-xs font-medium ${r.signalScore >= 70 ? "text-success" : r.signalScore >= 50 ? "text-warning" : "text-muted"}`}>
                        {r.signalScore}
                      </span>
                    ) : (
                      <span className="text-muted text-xs">—</span>
                    )}
                  </td>
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

      {/* Worker identity debug panel */}
      {data?.tick_identity && (
        <details className="card text-xs">
          <summary className="cursor-pointer text-muted select-none">Worker Debug</summary>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 font-mono">
            <div><dt className="text-muted">worker_id</dt><dd className="truncate">{data.tick_identity.worker_id ?? "—"}</dd></div>
            <div><dt className="text-muted">container_id</dt><dd className="truncate">{data.tick_identity.container_id ?? "—"}</dd></div>
            <div><dt className="text-muted">git_commit</dt><dd className="truncate">{data.tick_identity.git_commit ?? "—"}</dd></div>
            <div><dt className="text-muted">pid</dt><dd>{data.tick_identity.process_pid ?? "—"}</dd></div>
            <div className="col-span-2"><dt className="text-muted">generated_at</dt><dd>{data.tick_identity.generated_at ? new Date(data.tick_identity.generated_at).toLocaleString("tr-TR") : "—"}</dd></div>
          </dl>
        </details>
      )}

    </div>
  );
}
