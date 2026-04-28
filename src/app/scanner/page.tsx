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

function StatTile({
  label, value, title,
}: {
  label: string;
  value: number | string;
  title?: string;
}) {
  return (
    <div
      className="rounded-lg border border-accent/30 bg-accent/10 px-2 py-1.5 text-center transition-colors"
      title={title}
    >
      <div className="text-[10px] uppercase tracking-wider text-slate-200 font-medium">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-white">{value}</div>
    </div>
  );
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
        <div className="rounded-2xl border border-border bg-gradient-to-br from-bg-card via-bg-card to-bg-soft/40 shadow-lg shadow-black/20 overflow-hidden">
          {/* Section: Tarama Akışı */}
          <div className="px-4 pt-3 pb-2">
            <div className="flex items-center gap-2 mb-2">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              <span className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium">Tarama Akışı</span>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-9">
              <StatTile label="Evren" value={stats.universe} />
              <StatTile label="Ön Eleme" value={stats.prefiltered} />
              <StatTile label="Hacim Filtresi" value={stats.lowVolumeRejected ?? 0} />
              <StatTile label="Analiz Edilen" value={analyzedCount} title="Worker'ın değerlendirdiği toplam coin" />
              <StatTile label="Sinyal" value={stats.signals} />
              <StatTile label="Reddedilen" value={stats.rejected} />
              <StatTile label="Açılan" value={stats.opened} />
              <StatTile label="Hata" value={stats.errors} />
              <StatTile label="Süre" value={`${stats.durationMs}ms`} />
            </div>
          </div>

          {/* Section: Görünürlük */}
          <div className="px-4 pt-2 pb-3 border-t border-border/60 bg-bg-soft/20">
            <div className="flex items-center gap-2 mb-2">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              <span className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium">Görünürlük</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatTile label="Tabloda Gösterilen" value={visibleCount} title="Scanner görünürlük filtresini geçen ve tabloda listelenen coin sayısı" />
              <StatTile label="Core Gösterilen" value={visibleCoreCount} />
              <StatTile label="Dynamic Gösterilen" value={visibleDynamicCount} />
              <StatTile label="Dynamic Filtrelenen" value={filteredDynamicCount} title="Dynamic havuzdan filtrelenip tabloya alınmayan coin sayısı (kalite/setup/sinyal/likidite)" />
            </div>

            {/* Açıklama banner */}
            {analyzedCount > 0 && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-bg-soft/60 border border-border/60 px-3 py-2 text-xs text-slate-300">
                <span className="mt-0.5 text-muted shrink-0">ℹ</span>
                <span>
                  {visibleDynamicCount === 0 ? (
                    <>
                      Bu taramada <span className="text-slate-100 font-medium">dynamic fırsat adayı bulunmadı</span>. Bu nedenle tabloda yalnızca <span className="text-slate-100 font-medium">{visibleCoreCount} core</span> coin gösteriliyor.
                    </>
                  ) : (
                    <>
                      Bu taramada <span className="text-slate-100 font-medium">{visibleCoreCount} core + {visibleDynamicCount} dynamic</span> fırsat adayı gösteriliyor.
                    </>
                  )}
                  {analyzedCount !== visibleCount && (
                    <span className="text-muted"> · {analyzedCount} analiz edildi · {visibleCount} gösteriliyor</span>
                  )}
                </span>
              </div>
            )}
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
