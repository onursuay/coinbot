"use client";
// Phase 8 — Piyasa Tarayıcı: temiz coin operasyon tablosu.
//
// Kapsam: dashboard/panel özetleri burada GÖSTERİLMEZ. Sayfa yalnızca
// taranan coinleri, karar metriklerini ve kaynağı sade bir tabloda
// listeler. Aktif tarama-modu özeti (GMT/MT/MİL aktif/pasif) yalnızca
// /scan-modes sayfasında bulunur.
//
// SAFETY:
//  - Trading logic, sinyal eşiği, risk engine, BTC trend filtresi ve
//    canlı trading gate'i bu sayfadan etkilenmez.
//  - Gelişmiş metrik seçici sadece UI kolon görünürlüğünü değiştirir;
//    state localStorage'da tutulur, backend'e gönderilmez.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fmtPct } from "@/lib/format";
import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh";
import { mapTickSkipReasonTr } from "@/lib/dashboard/labels";

// ── Tipler ─────────────────────────────────────────────────────────────
type DirectionCandidate = "LONG_CANDIDATE" | "SHORT_CANDIDATE" | "MIXED" | "NONE";

interface ScanIndicators {
  ma8?: number | null;
  ma55?: number | null;
  rsi?: number | null;
  macdHist?: number | null;
  adx?: number | null;
  vwap?: number | null;
  bollingerWidth?: number | null;
  atrPercentile?: number | null;
  volumeImpulse?: number | null;
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
  tradeSignalScore?: number;
  setupScore?: number;
  marketQualityScore?: number;
  marketQualityPreScore?: number;
  longSetupScore?: number;
  shortSetupScore?: number;
  directionCandidate?: DirectionCandidate;
  directionConfidence?: number;
  waitReasonCodes?: string[];
  /** Faz 12 — kısa Türkçe sebep özeti, varsa öncelikli olarak gösterilir. */
  waitReasonSummary?: string;
  scoreType?: "signal" | "setup" | "none";
  scoreReason?: string;
  rejectReason: string | null;
  riskAllowed: boolean | null;
  riskRejectReason: string | null;
  opened: boolean;
  opportunityCandidate?: boolean;
  btcTrendRejected?: boolean;
  // Phase 6 unified candidate metadata (display-only)
  sourceDisplay?: string | null;
  candidateSources?: string[];
  candidateRank?: number;
  // Display filter annotations — set by filterScanDetailsForDisplay, never gates trades.
  displayFilterPassed?: boolean;
  displayFilterReason?: string | null;
  displayFilterReasons?: string[];
  displayFilterReasonText?: string;
  // Optional 24h quote volume (USDT) — surfaced when worker provides it,
  // otherwise the UI falls back to "—" (no Binance call from the dashboard).
  quoteVolume24h?: number;
  indicators?: ScanIndicators;
}

interface DisplayFilterSummary {
  rawAnalyzedCount?: number;
  filteredVisibleCount?: number;
  dynamicAnalyzedCount?: number;
  dynamicFilteredCount?: number;
  coreCount?: number;
  gmtCount?: number;
  mtCount?: number;
  milCount?: number;
  krmCount?: number;
}

interface UnifiedDiagnostics {
  unifiedPoolSize?: number | null;
  unifiedProviderError?: string | null;
  unifiedCandidatePoolBlockedReason?: string | null;
}

interface DiagData {
  active_exchange: string;
  scan_details: ScanRow[];
  /** Preferred — all analyzed scan details including display-filter-eliminated rows. */
  scan_details_all?: ScanRow[];
  /** Legacy alias of scan_details_all (worker versions before alias rollout). */
  all_analyzed_scan_details?: ScanRow[];
  /** Alias of scan_details — kept for clarity. */
  scan_details_filtered?: ScanRow[];
  display_filter_summary?: DisplayFilterSummary | null;
  unified_diagnostics?: UnifiedDiagnostics | null;
  tickSkipped?: boolean;
  skipReason?: string | null;
  tickError?: string | null;
  diagnosticsStale?: boolean;
  diagnosticsAgeSec?: number | null;
}

// ── Sabitler: signal threshold ─────────────────────────────────────────
// MIN_SIGNAL_CONFIDENCE = 70 (signal-engine.ts:564) — UI gösterimi için
// kopyalanmıştır, eşik değişmez. Değişirse ürün kuralı ihlal olur.
const SIGNAL_THRESHOLD = 70;

// ── Source mapping (GMT / MT / MİL / KRM) ──────────────────────────────
function mapSourceLabel(row: ScanRow): string {
  if (row.sourceDisplay) return row.sourceDisplay;
  const sources = row.candidateSources ?? [];
  if (sources.length >= 2) return "KRM";
  if (sources.length === 1) {
    const s = sources[0];
    if (s === "WIDE_MARKET") return "GMT";
    if (s === "MOMENTUM") return "MT";
    if (s === "MANUAL_LIST") return "MİL";
  }
  if (row.coinClass === "CORE") return "CORE";
  return "—";
}

// ── Decision/direction mapping ─────────────────────────────────────────
type DecisionLabel =
  | "LONG ADAY" | "LONG AÇILDI"
  | "SHORT ADAY" | "SHORT AÇILDI"
  | "YÖN BEKLİYOR" | "İŞLEM YOK"
  | "RİSK REDDİ" | "BTC FİLTRESİ";

function mapDirectionLabel(row: ScanRow): DecisionLabel {
  // YÖN kolonu: doğrultu eğilimi (sadece LONG ADAY / SHORT ADAY / YÖN BEKLİYOR).
  if (row.opened && row.signalType === "LONG") return "LONG AÇILDI";
  if (row.opened && row.signalType === "SHORT") return "SHORT AÇILDI";
  if (row.signalType === "LONG") return "LONG ADAY";
  if (row.signalType === "SHORT") return "SHORT ADAY";
  if (row.directionCandidate === "LONG_CANDIDATE") return "LONG ADAY";
  if (row.directionCandidate === "SHORT_CANDIDATE") return "SHORT ADAY";
  return "YÖN BEKLİYOR";
}

function mapDecisionLabel(row: ScanRow): DecisionLabel {
  // KARAR kolonu: nihai karar.
  if (row.opened && row.signalType === "LONG") return "LONG AÇILDI";
  if (row.opened && row.signalType === "SHORT") return "SHORT AÇILDI";
  if (row.btcTrendRejected) return "BTC FİLTRESİ";
  if (row.riskAllowed === false || row.riskRejectReason) return "RİSK REDDİ";
  if (row.signalType === "LONG") return "LONG ADAY";
  if (row.signalType === "SHORT") return "SHORT ADAY";
  if (row.signalType === "NO_TRADE") return "İŞLEM YOK";
  if (row.directionCandidate === "LONG_CANDIDATE") return "LONG ADAY";
  if (row.directionCandidate === "SHORT_CANDIDATE") return "SHORT ADAY";
  return "YÖN BEKLİYOR";
}

function decisionClass(label: DecisionLabel, opened: boolean): string {
  if (opened) return "text-success";
  if (label === "SHORT AÇILDI") return "text-blue-300";
  if (label === "LONG ADAY") return "text-success";
  if (label === "SHORT ADAY") return "text-blue-300";
  if (label === "RİSK REDDİ" || label === "BTC FİLTRESİ") return "text-danger";
  if (label === "İŞLEM YOK") return "text-muted";
  return "text-muted"; // YÖN BEKLİYOR
}

// ── EŞİĞE KALAN ─────────────────────────────────────────────────────────
function distanceToThreshold(row: ScanRow): number | null {
  const score = row.tradeSignalScore ?? row.signalScore ?? 0;
  if (row.opened) return 0;
  if (score <= 0) return null;
  return Math.max(0, SIGNAL_THRESHOLD - score);
}

// ── SEBEP — wait codes / scoreReason / rejectReason kısa metni ──────────
const WAIT_CODE_TR: Record<string, string> = {
  EMA_ALIGNMENT_MISSING: "EMA dizilim",
  MA_FAST_SLOW_CONFLICT: "MA çatışma",
  MACD_CONFLICT: "MACD çatışma",
  RSI_NEUTRAL: "RSI nötr",
  ADX_FLAT: "ADX zayıf",
  VWAP_NOT_CONFIRMED: "VWAP teyitsiz",
  VOLUME_WEAK: "Hacim zayıf",
  BOLLINGER_NO_CONFIRMATION: "BB teyitsiz",
  ATR_REGIME_UNCLEAR: "ATR belirsiz",
  BTC_DIRECTION_CONFLICT: "BTC zıt",
};

// Display filter reason text mapping — mirrors backend buildDisplayFilterReasonText.
// Used as fallback when worker did not populate displayFilterReasonText (older versions).
const DISPLAY_FILTER_TR: Record<string, string> = {
  quality_below_threshold: "Filtrelendi: piyasa kalitesi düşük",
  setup_below_threshold: "Filtrelendi: setup eşiği düşük",
  signal_below_threshold: "Filtrelendi: işlem skoru düşük",
  low_volume: "Hacim zayıf",
  weak_momentum: "Yön teyidi bekleniyor: hacim zayıf",
  btc_conflict: "BTC yönü ters",
  no_confirmed_direction: "Yön teyidi yok",
};

function buildReasonText(row: ScanRow): string {
  // Display-filtered dynamic rows: explain WHY they didn't make the strict scanner gate.
  // Trade logic is unaffected — this is purely the SEBEP column for the user.
  if (row.displayFilterPassed === false) {
    if (row.displayFilterReasonText && row.displayFilterReasonText.length > 0) {
      return row.displayFilterReasonText;
    }
    const reasons = row.displayFilterReasons ?? (row.displayFilterReason ? [row.displayFilterReason] : []);
    if (reasons.length > 0) {
      return reasons.slice(0, 2).map((r) => DISPLAY_FILTER_TR[r] ?? r).join(" · ");
    }
  }
  if (row.btcTrendRejected) return "BTC trend filtresi";
  if (row.riskRejectReason) return row.riskRejectReason;
  // Faz 12 — backend tarafı zaten 2–3 sebebi içeren kısa Türkçe özet üretiyor.
  // Varsa onu tercih et; yoksa kod listesini etiketlere çevirerek göster.
  if (row.signalType === "WAIT" && row.waitReasonSummary && row.waitReasonSummary.length > 0) {
    return row.waitReasonSummary;
  }
  const codes = row.waitReasonCodes ?? [];
  if (codes.length > 0) {
    return codes.slice(0, 3).map((c) => WAIT_CODE_TR[c] ?? c).join(" · ");
  }
  if (row.scoreReason) return row.scoreReason;
  if (row.rejectReason) return row.rejectReason;
  return "—";
}

// ── Gelişmiş metrik kolonları ──────────────────────────────────────────
type AdvKey =
  | "RSI" | "MA8" | "MA55" | "MACD" | "ADX" | "VWAP"
  | "BB" | "ATR_PCTILE" | "VOL_IMP"
  | "SPREAD" | "QVOL" | "DEPTH";

const ADV_COLUMNS: { key: AdvKey; header: string }[] = [
  { key: "RSI",        header: "RSI" },
  { key: "MA8",        header: "MA8" },
  { key: "MA55",       header: "MA55" },
  { key: "MACD",       header: "MACD" },
  { key: "ADX",        header: "ADX" },
  { key: "VWAP",       header: "VWAP" },
  { key: "BB",         header: "BOLLİNGER" },
  { key: "ATR_PCTILE", header: "ATR PERSANTİL" },
  { key: "VOL_IMP",    header: "HACİM İVMESİ" },
  { key: "SPREAD",     header: "SPREAD" },
  { key: "QVOL",       header: "HACİM (USDT)" },
  { key: "DEPTH",      header: "DERİNLİK" },
];

const ADV_KEY_SET: readonly AdvKey[] = ADV_COLUMNS.map((c) => c.key);
const STORAGE_KEY = "scanner:advancedColumns:v8";
const DISMISS_STORAGE_KEY = "scanner:dismissedCandidates:v1";
const DISMISS_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface DismissEntry {
  symbol: string;
  direction: string;
  sourceDisplay: string;
  tradeSignalScore: number;
  setupScore: number;
  dismissedAt: number;
  dismissedUntil: number;
}

function fmtNumOrDash(n: unknown, digits = 2): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(digits) : "—";
}
function fmtCompact(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(0);
}

function getAdvValue(row: ScanRow, key: AdvKey): React.ReactNode {
  const ind = row.indicators ?? {};
  switch (key) {
    case "RSI":        return fmtNumOrDash(ind.rsi, 1);
    case "MA8":        return fmtNumOrDash(ind.ma8, 4);
    case "MA55":       return fmtNumOrDash(ind.ma55, 4);
    case "MACD":       return fmtNumOrDash(ind.macdHist, 4);
    case "ADX":        return fmtNumOrDash(ind.adx, 1);
    case "VWAP":       return fmtNumOrDash(ind.vwap, 4);
    case "BB":         return fmtNumOrDash(ind.bollingerWidth, 4);
    case "ATR_PCTILE": return fmtNumOrDash(ind.atrPercentile, 1);
    case "VOL_IMP":    return fmtNumOrDash(ind.volumeImpulse, 2);
    case "SPREAD":     return fmtPct(row.spreadPercent, 3);
    case "QVOL":       return fmtCompact(row.quoteVolume24h);
    case "DEPTH":      return fmtCompact(row.orderBookDepth);
  }
}

// ── Sayfa ───────────────────────────────────────────────────────────────
export default function ScannerPage() {
  const [data, setData] = useState<DiagData | null>(null);
  const [loading, setLoading] = useState(false);
  const [dismissals, setDismissals] = useState<Record<string, DismissEntry>>({});

  // Gelişmiş kolon görünürlüğü — kullanıcı tercihi localStorage'a yazılır.
  // Yalnızca presentation; backend ile alışverişi yok.
  const [visibleAdv, setVisibleAdv] = useState<Set<AdvKey>>(() => new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw) as unknown;
      if (!Array.isArray(arr)) return;
      const allowed = new Set<AdvKey>(ADV_KEY_SET);
      const filtered = arr.filter((k): k is AdvKey => typeof k === "string" && allowed.has(k as AdvKey));
      setVisibleAdv(new Set(filtered));
    } catch {
      /* corrupt storage — boş bırak */
    }
  }, []);
  const persistVisible = (next: Set<AdvKey>) => {
    setVisibleAdv(next);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(next))); } catch { /* ignore */ }
  };
  const toggleAdv = (k: AdvKey) => {
    const next = new Set(visibleAdv);
    if (next.has(k)) next.delete(k); else next.add(k);
    persistVisible(next);
  };
  const isAdvVisible = (k: AdvKey) => visibleAdv.has(k);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DISMISS_STORAGE_KEY);
      if (!raw) return;
      setDismissals(JSON.parse(raw) as Record<string, DismissEntry>);
    } catch { /* corrupt storage — ignore */ }
  }, []);

  const persistDismissals = (next: Record<string, DismissEntry>) => {
    setDismissals(next);
    try { window.localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const dismissRow = (row: ScanRow) => {
    const now = Date.now();
    const entry: DismissEntry = {
      symbol: row.symbol,
      direction: row.signalType ?? "WAIT",
      sourceDisplay: mapSourceLabel(row),
      tradeSignalScore: row.tradeSignalScore ?? row.signalScore ?? 0,
      setupScore: row.setupScore ?? 0,
      dismissedAt: now,
      dismissedUntil: now + DISMISS_TTL_MS,
    };
    persistDismissals({ ...dismissals, [row.symbol]: entry });
    console.log("scanner_candidate_dismissed", {
      ...entry,
      reason: "user_dismissed_candidate",
      mode: "paper",
    });
  };

  const clearDismissals = () => {
    persistDismissals({});
    try { window.localStorage.removeItem(DISMISS_STORAGE_KEY); } catch { /* ignore */ }
    console.log("scanner_dismissals_cleared");
  };

  const handleDismiss = (e: React.MouseEvent, row: ScanRow) => {
    e.stopPropagation();
    e.preventDefault();
    const confirmed = window.confirm(
      `Bu adayı şimdilik geçmek istiyor musun?\n\nCoin kalıcı olarak tarama dışına alınmaz; ileride tekrar güçlü fırsat oluşursa yeniden görünür.`
    );
    if (confirmed) dismissRow(row);
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/bot/diagnostics", { cache: "no-store" }).then((r) => r.json());
      if (res.ok && res.data) setData(res.data);
    } finally {
      setLoading(false);
    }
  };
  useAutoRefresh(refresh);

  // Data priority (Dynamic Market Visibility patch):
  //   1. scan_details_all   — preferred (canonical alias, all analyzed rows)
  //   2. all_analyzed_scan_details — legacy alias (older diagnostics)
  //   3. scan_details       — backward-compat fallback (filtered survivors only)
  // Dismiss filter: hide rows temporarily dismissed by the user unless a strong
  // signal (score>=70 / LONG / SHORT / opened) overrides the dismissal.
  // Cap at 80 rows — sort is decision-priority (real signal first, then scores).
  const rows = useMemo(() => {
    const now = Date.now();
    const raw = data?.scan_details_all ?? data?.all_analyzed_scan_details ?? data?.scan_details ?? [];
    if (raw.length === 0) return raw;
    const filtered = raw.filter((r) => {
      const entry = dismissals[r.symbol];
      if (!entry || now > entry.dismissedUntil) return true;
      if ((r.tradeSignalScore ?? r.signalScore ?? 0) >= 70) return true;
      if (r.signalType === "LONG" || r.signalType === "SHORT") return true;
      if (r.opened === true) return true;
      return false;
    });
    const sorted = filtered.sort((a, b) => {
      if (a.opened !== b.opened) return a.opened ? -1 : 1;
      const aHasDir = a.signalType === "LONG" || a.signalType === "SHORT" ? 1 : 0;
      const bHasDir = b.signalType === "LONG" || b.signalType === "SHORT" ? 1 : 0;
      if (aHasDir !== bHasDir) return bHasDir - aHasDir;
      const ta = a.tradeSignalScore ?? a.signalScore ?? 0;
      const tb = b.tradeSignalScore ?? b.signalScore ?? 0;
      if (tb !== ta) return tb - ta;
      const sa = a.setupScore ?? 0;
      const sb = b.setupScore ?? 0;
      if (sb !== sa) return sb - sa;
      return (b.marketQualityScore ?? 0) - (a.marketQualityScore ?? 0);
    });
    return sorted.slice(0, 80);
  }, [data, dismissals]);

  const dismissedCount = useMemo(() => {
    const now = Date.now();
    return Object.values(dismissals).filter((e) => now <= e.dismissedUntil).length;
  }, [dismissals]);
  const exchange = data?.active_exchange ?? "binance";
  const advColumns = ADV_COLUMNS.filter((c) => isAdvVisible(c.key));
  const isStale = data?.diagnosticsStale === true;
  const summary = data?.display_filter_summary ?? null;
  const unifiedDiag = data?.unified_diagnostics ?? null;
  const poolEmpty = unifiedDiag != null && (unifiedDiag.unifiedPoolSize === 0 || (unifiedDiag.unifiedProviderError != null && unifiedDiag.unifiedProviderError !== ""));
  const poolEmptyMessage = (() => {
    if (!unifiedDiag) return null;
    if (unifiedDiag.unifiedProviderError) return `Unified provider hata aldı: ${String(unifiedDiag.unifiedProviderError).slice(0, 120)}`;
    if (unifiedDiag.unifiedCandidatePoolBlockedReason) return `Geniş market ön eleme: ${unifiedDiag.unifiedCandidatePoolBlockedReason}`;
    if (unifiedDiag.unifiedPoolSize === 0) return "Dinamik aday havuzu boş.";
    return null;
  })();
  const emptyStateMessage = data?.tickSkipped === true
    ? `Tarama atlandı: ${mapTickSkipReasonTr(data.skipReason)}`
    : "Bu periyotta güçlü aday bulunamadı.";

  return (
    <div className="space-y-4">
      {/* Geçici dismiss bildirimi */}
      {dismissedCount > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-bg-soft px-3 py-2 text-xs text-muted">
          <span>Geçilen aday: <strong className="text-slate-300">{dismissedCount}</strong></span>
          <button
            type="button"
            onClick={clearDismissals}
            className="ml-auto text-xs text-accent hover:underline"
          >
            Geçilenleri sıfırla
          </button>
        </div>
      )}

      {/* Stale data uyarısı */}
      {isStale && (
        <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden>
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 3.5a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0v-3A.75.75 0 0 1 8 4.5zm0 7a.875.875 0 1 1 0-1.75.875.875 0 0 1 0 1.75z"/>
          </svg>
          Tarama verisi güncel değil. Son tick bekleniyor.
          {typeof data?.diagnosticsAgeSec === "number" && (
            <span className="ml-auto text-muted">{data.diagnosticsAgeSec}s önce</span>
          )}
        </div>
      )}

      {/* Compact source mix summary — shows the user the scanner actually swept the market */}
      {summary && (summary.rawAnalyzedCount ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
          <span>Analiz edilen: <strong className="text-slate-300">{summary.rawAnalyzedCount}</strong></span>
          {(summary.coreCount ?? 0) > 0 && <span>· CORE: <strong className="text-slate-300">{summary.coreCount}</strong></span>}
          {(summary.gmtCount ?? 0) > 0 && <span>· GMT: <strong className="text-slate-300">{summary.gmtCount}</strong></span>}
          {(summary.mtCount ?? 0) > 0 && <span>· MT: <strong className="text-slate-300">{summary.mtCount}</strong></span>}
          {(summary.milCount ?? 0) > 0 && <span>· MİL: <strong className="text-slate-300">{summary.milCount}</strong></span>}
          {(summary.krmCount ?? 0) > 0 && <span>· KRM: <strong className="text-slate-300">{summary.krmCount}</strong></span>}
          {(summary.dynamicFilteredCount ?? 0) > 0 && <span>· Filtrelenen: <strong className="text-slate-300">{summary.dynamicFilteredCount}</strong></span>}
        </div>
      )}

      {/* Candidate pool empty / provider error notice */}
      {poolEmpty && poolEmptyMessage && (
        <div className="rounded-md border border-border bg-bg-soft px-3 py-2 text-xs text-slate-400">
          {poolEmptyMessage}
        </div>
      )}

      {/* Empty / no-data */}
      {!data && !loading && (
        <div className="card text-muted text-sm text-center py-6">
          Worker henüz tarama yapmadı. Worker çalışıyorsa ~30 saniyede veri gelir.
        </div>
      )}

      {data && rows.length === 0 && (
        <div className="card text-muted text-center py-6">
          <span className={data.tickSkipped === true ? "text-xs" : "text-sm"}>
            {emptyStateMessage}
          </span>
        </div>
      )}

      {rows.length > 0 && (
        <div className="card relative overflow-x-auto">
          {/* Metrik seçici — yalnızca küçük vektörel ikon, tablo başlık
              satırının en sağında. Yazılı toplu-seçim butonu yoktur. */}
          <div className="absolute right-3 top-3 z-10">
            <button
              type="button"
              onClick={() => setPickerOpen((o) => !o)}
              title="Gelişmiş metrikler"
              aria-label="Gelişmiş metrikler"
              aria-expanded={pickerOpen}
              className="relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg-soft text-slate-300 transition-colors hover:border-accent hover:text-accent"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
              </svg>
              {visibleAdv.size > 0 && (
                <span className="absolute -right-1 -top-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold text-black">
                  {visibleAdv.size}
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
                <div className="absolute right-0 top-full z-20 mt-2 w-64 rounded-xl border border-border bg-bg-card p-2 shadow-lg shadow-black/40">
                  <div className="grid grid-cols-1 gap-0.5">
                    {ADV_COLUMNS.map((c) => (
                      <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-200 hover:bg-bg-soft">
                        <input
                          type="checkbox"
                          className="accent-accent"
                          checked={isAdvVisible(c.key)}
                          onChange={() => toggleAdv(c.key)}
                        />
                        <span className="font-medium tracking-wide">{c.header}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <table className="t t-centered">
            <thead>
              <tr>
                <th className="!text-left">COIN</th>
                <th>KAYNAK</th>
                <th>YÖN</th>
                <th title="Piyasa kalite skoru — hacim, spread, derinlik, ATR, fonlama sağlığı">KALİTE</th>
                <th title="Fırsat yapısı skoru — EMA/MA/MACD/RSI/Bollinger/ADX/VWAP/Hacim uyumu">FIRSAT</th>
                <th title="İşlem güven skoru — 70+ = işlem açılır">İŞLEM SKORU</th>
                <th title="İşlem skoru 70 eşiğine kalan puan">EŞİĞE KALAN</th>
                <th>KARAR</th>
                <th className="pr-12">SEBEP</th>
                {advColumns.map((c) => (
                  <th key={c.key}>{c.header}</th>
                ))}
                <th className="w-8" aria-label="Aksiyon"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const directionLabel = mapDirectionLabel(r);
                const decisionLabel = mapDecisionLabel(r);
                const dist = distanceToThreshold(r);
                const reasonText = buildReasonText(r);
                const opened = r.opened === true;
                const rowClass = opened
                  ? "font-semibold bg-success/5"
                  : "";
                const quality = r.marketQualityScore ?? r.marketQualityPreScore ?? 0;
                const setup = r.setupScore ?? 0;
                const trade = r.tradeSignalScore ?? r.signalScore ?? 0;

                return (
                  <tr key={r.symbol} className={`group${rowClass ? ` ${rowClass}` : ""}`}>
                    <td className={`!text-left ${opened ? "font-bold" : "font-medium"}`}>
                      <Link className="text-accent" href={`/coins/${encodeURIComponent(r.symbol)}?exchange=${exchange}`}>
                        {r.symbol}
                      </Link>
                      {isStale && (
                        <span className="ml-1 rounded px-1 py-0.5 text-[9px] font-medium bg-warning/15 text-warning align-middle">GÜNCEL DEĞİL</span>
                      )}
                    </td>
                    <td title={(r.candidateSources ?? []).join(", ") || undefined}>
                      <span className="text-xs font-medium text-slate-200">{mapSourceLabel(r)}</span>
                    </td>
                    <td>
                      <span className={`text-xs font-medium ${decisionClass(directionLabel, opened)}`}>
                        {directionLabel}
                      </span>
                    </td>
                    <td>
                      {quality > 0 ? (
                        <span className={`text-xs font-medium ${quality >= 70 ? "text-success" : quality >= 50 ? "text-warning" : "text-muted"}`}>
                          {quality}
                        </span>
                      ) : <span className="text-muted text-xs">—</span>}
                    </td>
                    <td title={r.scoreReason ?? ""}>
                      {setup > 0 ? (
                        <span className={`font-semibold ${setup >= 70 ? "text-success" : setup >= 50 ? "text-warning" : ""}`}>
                          {setup}
                        </span>
                      ) : <span className="text-muted">—</span>}
                    </td>
                    <td>
                      {trade > 0 ? (
                        <span className={`text-xs font-medium ${trade >= 70 ? "text-success" : trade >= 50 ? "text-warning" : "text-muted"}`}>
                          {trade}
                        </span>
                      ) : <span className="text-muted text-xs">—</span>}
                    </td>
                    <td>
                      {dist === null ? (
                        <span className="text-muted text-xs">—</span>
                      ) : dist === 0 ? (
                        <span className="text-success text-xs font-medium">0</span>
                      ) : (
                        <span className={`text-xs ${dist <= 10 ? "text-warning font-medium" : "text-muted"}`}>
                          {dist}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`text-xs ${opened ? "font-bold" : "font-medium"} ${decisionClass(decisionLabel, opened)}`}>
                        {decisionLabel}
                      </span>
                    </td>
                    <td className="pr-12 text-left max-w-[240px]" title={reasonText}>
                      <span className="text-xs text-slate-400 truncate inline-block max-w-[240px] align-middle">
                        {reasonText}
                      </span>
                    </td>
                    {advColumns.map((c) => (
                      <td key={c.key} className="tabular-nums text-xs text-slate-200">
                        {getAdvValue(r, c.key)}
                      </td>
                    ))}
                    <td className="w-8 text-center">
                      {!opened && (
                        <button
                          type="button"
                          aria-label={`${r.symbol} adayını geç`}
                          title="Bu adayı şimdilik geç"
                          onClick={(e) => handleDismiss(e, r)}
                          className="inline-flex items-center justify-center rounded p-1 text-slate-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-slate-300 hover:bg-slate-700/50 focus:opacity-100 focus:outline-none"
                        >
                          <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden>
                            <path d="M6.5 1.75a.25.25 0 0 1 .25-.25h2.5a.25.25 0 0 1 .25.25V3h-3V1.75zm4.5 0V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75zM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15H5.405a1.748 1.748 0 0 1-1.741-1.576l-.66-6.6a.75.75 0 1 1 1.492-.149z"/>
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
