"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { fmtPct } from "@/lib/format";
import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh";
import { buildReasonColumns, REASON_COLUMNS } from "@/lib/wait-reason-badges";

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

type DirectionCandidate = "LONG_CANDIDATE" | "SHORT_CANDIDATE" | "MIXED" | "NONE";
type WaitReasonCode =
  | "EMA_ALIGNMENT_MISSING"
  | "MA_FAST_SLOW_CONFLICT"
  | "MACD_CONFLICT"
  | "RSI_NEUTRAL"
  | "ADX_FLAT"
  | "VWAP_NOT_CONFIRMED"
  | "VOLUME_WEAK"
  | "BOLLINGER_NO_CONFIRMATION"
  | "ATR_REGIME_UNCLEAR"
  | "BTC_DIRECTION_CONFLICT";

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
  longSetupScore?: number;
  shortSetupScore?: number;
  directionCandidate?: DirectionCandidate;
  directionConfidence?: number;
  waitReasonCodes?: WaitReasonCode[] | string[];
  scoreType?: "signal" | "setup" | "none";
  scoreReason?: string;
  rejectReason: string | null;
  riskAllowed: boolean | null;
  riskRejectReason: string | null;
  opened: boolean;
  opportunityCandidate?: boolean;
}

const DIRECTION_CANDIDATE_LABEL: Record<DirectionCandidate, string> = {
  LONG_CANDIDATE: "LONG",
  SHORT_CANDIDATE: "SHORT",
  MIXED: "KARIŞIK",
  NONE: "YOK",
};

// Advanced (toggleable) columns — controlled by the GELİŞMİŞ METRİKLER picker.
// Core columns (SEMBOL/SINIF/KADEME/SİNYAL/YÖN EĞİLİMİ/KALİTE/FIRSAT/İŞLEM/AÇILDI)
// are always rendered and never appear in the picker.
type AdvancedColumnKey =
  | "SPREAD" | "ATR_PCT" | "FUNDING"
  | "MA" | "EMA" | "MACD" | "RSI" | "ADX" | "VWAP"
  | "HACIM" | "BB" | "ATR" | "BTC" | "SKOR";

const ADVANCED_COLUMNS: { key: AdvancedColumnKey; header: string }[] = [
  { key: "SPREAD",  header: "SPREAD" },
  { key: "ATR_PCT", header: "ATR%" },
  { key: "FUNDING", header: "FONLAMA" },
  { key: "MA",      header: "MA" },
  { key: "EMA",     header: "EMA" },
  { key: "MACD",    header: "MACD" },
  { key: "RSI",     header: "RSI" },
  { key: "ADX",     header: "ADX" },
  { key: "VWAP",    header: "VWAP" },
  { key: "HACIM",   header: "HACİM" },
  { key: "BB",      header: "BB" },
  { key: "ATR",     header: "ATR" },
  { key: "BTC",     header: "BTC" },
  { key: "SKOR",    header: "SKOR" },
];

const ADVANCED_COLUMN_KEYS: AdvancedColumnKey[] = ADVANCED_COLUMNS.map((c) => c.key);
const STORAGE_KEY = "scanner:visibleAdvancedColumns";
// "Varsayılana Dön" ile dönülecek küratör seçim — temel piyasa metrikleri.
// "Tümünü Gizle" ile farklı sonuç vermesi için boş bırakılmıyor.
const DEFAULT_VISIBLE_ADVANCED: AdvancedColumnKey[] = ["SPREAD", "ATR_PCT", "FUNDING"];

function ReasonCell({ value }: { value?: string }) {
  if (!value) return <span className="text-muted">—</span>;
  return <span className="text-xs font-medium text-danger">{value}</span>;
}

const SIGNAL_TYPE_LABEL: Record<string, string> = {
  LONG: "LONG",
  SHORT: "SHORT",
  WAIT: "BEKLE",
  NO_TRADE: "İŞLEM YOK",
};

function SignalTag({ signalType }: { signalType: string }) {
  const label = SIGNAL_TYPE_LABEL[signalType] ?? (signalType || "—");
  if (signalType === "LONG") {
    return <span className="tag-success">{label}</span>;
  }
  if (signalType === "SHORT") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-blue-900/40 text-blue-300">
        {label}
      </span>
    );
  }
  return <span className="tag-muted whitespace-nowrap">{label}</span>;
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
      className="snake-border rounded-lg border border-accent/30 bg-accent/10 px-2 py-1.5 text-center"
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
  // Worker Debug paneli yalnızca geliştirici görünümünde açılır:
  // ?debug=1 query param ya da NEXT_PUBLIC_SCANNER_DEBUG=true env'i.
  // Müşteri/abonelik görünümünde panel render edilmez.
  const [debugMode, setDebugMode] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const qs = new URLSearchParams(window.location.search);
    const fromQuery = qs.get("debug") === "1";
    const fromEnv = process.env.NEXT_PUBLIC_SCANNER_DEBUG === "true";
    setDebugMode(fromQuery || fromEnv);
  }, []);

  // Gelişmiş kolon görünürlüğü — kullanıcı tercihi localStorage'a yazılır,
  // her oturum açılışında geri yüklenir. Yalnızca presentation; backend
  // ile alışverişi yok.
  const [visibleAdvanced, setVisibleAdvanced] = useState<Set<AdvancedColumnKey>>(
    () => new Set(DEFAULT_VISIBLE_ADVANCED),
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw) as unknown;
      if (!Array.isArray(arr)) return;
      const allowed = new Set<AdvancedColumnKey>(ADVANCED_COLUMN_KEYS);
      const filtered = arr.filter((k): k is AdvancedColumnKey => typeof k === "string" && allowed.has(k as AdvancedColumnKey));
      setVisibleAdvanced(new Set(filtered));
    } catch {
      /* corrupt storage — bırak default */
    }
  }, []);
  const persistVisible = (next: Set<AdvancedColumnKey>) => {
    setVisibleAdvanced(next);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(next))); } catch { /* ignore */ }
  };
  const toggleColumn = (k: AdvancedColumnKey) => {
    const next = new Set(visibleAdvanced);
    if (next.has(k)) next.delete(k); else next.add(k);
    persistVisible(next);
  };
  const showAllColumns = () => persistVisible(new Set(ADVANCED_COLUMN_KEYS));
  const hideAllColumns = () => persistVisible(new Set());
  const resetColumns = () => persistVisible(new Set(DEFAULT_VISIBLE_ADVANCED));
  const isAdvVisible = (k: AdvancedColumnKey) => visibleAdvanced.has(k);

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

      {/* Column picker — kolonları göster/gizle (icon button) */}
      {rows.length > 0 && (
        <div className="relative flex justify-end">
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            title="Kolonları yönet"
            aria-label="Kolonları yönet"
            aria-expanded={pickerOpen}
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-bg-soft text-slate-300 transition-colors hover:border-accent hover:text-accent"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
              <circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
              <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
              <circle cx="9" cy="18" r="2" fill="currentColor" stroke="none" />
            </svg>
            {visibleAdvanced.size > 0 && (
              <span className="absolute -right-1 -top-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold text-black">
                {visibleAdvanced.size}
              </span>
            )}
          </button>
          {pickerOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setPickerOpen(false)}
                aria-hidden
              />
              <div className="absolute right-0 top-full z-20 mt-2 w-80 rounded-xl border border-border bg-bg-card p-3 shadow-lg shadow-black/40">
                <div className="mb-3 grid grid-cols-3 gap-1.5 text-[10px] uppercase tracking-wider">
                  <button onClick={showAllColumns} className="rounded-md border border-border bg-bg-soft px-2 py-1.5 hover:border-accent">Tümünü Göster</button>
                  <button onClick={hideAllColumns} className="rounded-md border border-border bg-bg-soft px-2 py-1.5 hover:border-accent">Tümünü Gizle</button>
                  <button onClick={resetColumns}   className="rounded-md border border-border bg-bg-soft px-2 py-1.5 hover:border-accent">Varsayılana Dön</button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {ADVANCED_COLUMNS.map((c) => (
                    <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs text-slate-200 hover:bg-bg-soft">
                      <input
                        type="checkbox"
                        className="accent-accent"
                        checked={isAdvVisible(c.key)}
                        onChange={() => toggleColumn(c.key)}
                      />
                      <span className="font-medium tracking-wide">{c.header}</span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Scan details table */}
      {rows.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="t t-centered">
            <thead>
              <tr>
                <th>SEMBOL</th>
                <th>SINIF</th>
                <th>KADEME</th>
                {isAdvVisible("SPREAD")  && <th>SPREAD</th>}
                {isAdvVisible("ATR_PCT") && <th>ATR%</th>}
                {isAdvVisible("FUNDING") && <th>FONLAMA</th>}
                <th>SİNYAL</th>
                <th className="whitespace-nowrap">YÖN EĞİLİMİ</th>
                <th title="Piyasa kalite skoru — hacim, spread, derinlik, ATR, fonlama sağlığı">KALİTE</th>
                <th title="Fırsat yapısı skoru — EMA/MA/MACD/RSI/Bollinger/ADX/VWAP/Hacim uyumu; WAIT dahil hesaplanır">FIRSAT</th>
                <th title="İşlem güven skoru — 70+ = işlem açılır; sadece yön belirlenen coinlerde anlamlı">İŞLEM</th>
                {REASON_COLUMNS.filter((c) => isAdvVisible(c.key as AdvancedColumnKey)).map((c) => (
                  <th key={c.key}>{c.header}</th>
                ))}
                <th>AÇILDI</th>
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
                  {isAdvVisible("SPREAD")  && <td>{fmtPct(r.spreadPercent, 3)}</td>}
                  {isAdvVisible("ATR_PCT") && <td>{fmtPct(r.atrPercent, 2)}</td>}
                  {isAdvVisible("FUNDING") && <td>{fmtPct(r.fundingRate * 100, 4)}</td>}
                  <td>
                    <SignalTag signalType={r.signalType} />
                  </td>
                  <td>
                    {r.directionCandidate ? (
                      <span
                        className={`text-xs font-medium ${
                          r.directionCandidate === "LONG_CANDIDATE" ? "text-success" :
                          r.directionCandidate === "SHORT_CANDIDATE" ? "text-blue-300" :
                          r.directionCandidate === "MIXED" ? "text-warning" : "text-muted"
                        }`}
                        title={
                          (r.longSetupScore !== undefined || r.shortSetupScore !== undefined)
                            ? `LONG: ${r.longSetupScore ?? 0} / SHORT: ${r.shortSetupScore ?? 0} · güven ${r.directionConfidence ?? 0}`
                            : undefined
                        }
                      >
                        {DIRECTION_CANDIDATE_LABEL[r.directionCandidate]}
                      </span>
                    ) : (
                      <span className="text-muted text-xs">—</span>
                    )}
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
                  {(() => {
                    const cols = buildReasonColumns({
                      signalType: r.signalType,
                      waitReasonCodes: r.waitReasonCodes,
                      rejectReason: r.rejectReason,
                      riskRejectReason: r.riskRejectReason,
                    });
                    return REASON_COLUMNS
                      .filter((c) => isAdvVisible(c.key as AdvancedColumnKey))
                      .map((c) => (
                        <td key={c.key}>
                          <ReasonCell value={cols[c.key]} />
                        </td>
                      ));
                  })()}
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

      {/* Worker identity debug panel — sadece debug modunda görünür */}
      {debugMode && data?.tick_identity && (
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
