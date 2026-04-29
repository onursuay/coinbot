// Phase 9 — Dashboard ortak etiket/mapping yardımcıları.
//
// Bu modül yalnızca presentation katmanı için saf fonksiyonlar içerir.
// Trade kararı, signal-engine veya risk engine üzerinde HİÇBİR etkisi
// yoktur. Mapping kuralları Faz 8 Piyasa Tarayıcı ile birebir aynıdır;
// dashboard ve scanner sayfalarının tutarlı görünmesi için merkezîdir.

export type DirectionCandidate = "LONG_CANDIDATE" | "SHORT_CANDIDATE" | "MIXED" | "NONE";

export type DecisionLabel =
  | "LONG ADAY" | "LONG AÇILDI"
  | "SHORT ADAY" | "SHORT AÇILDI"
  | "YÖN BEKLİYOR" | "İŞLEM YOK"
  | "RİSK REDDİ" | "BTC FİLTRESİ";

export interface DecisionInput {
  signalType?: string;
  opened?: boolean;
  riskAllowed?: boolean | null;
  riskRejectReason?: string | null;
  btcTrendRejected?: boolean;
  directionCandidate?: DirectionCandidate;
  rejectReason?: string | null;
}

/** Yön kolonu: doğrultu eğilimi. */
export function mapDirectionLabel(row: DecisionInput): DecisionLabel {
  if (row.opened && row.signalType === "LONG") return "LONG AÇILDI";
  if (row.opened && row.signalType === "SHORT") return "SHORT AÇILDI";
  if (row.signalType === "LONG") return "LONG ADAY";
  if (row.signalType === "SHORT") return "SHORT ADAY";
  if (row.directionCandidate === "LONG_CANDIDATE") return "LONG ADAY";
  if (row.directionCandidate === "SHORT_CANDIDATE") return "SHORT ADAY";
  return "YÖN BEKLİYOR";
}

/** Karar kolonu: nihai karar. */
export function mapDecisionLabel(row: DecisionInput): DecisionLabel {
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

/** Aday/açıldı/red etiketleri için tek tip class. */
export function decisionClass(label: DecisionLabel, opened: boolean): string {
  if (opened) return "text-success";
  if (label === "SHORT AÇILDI") return "text-blue-300";
  if (label === "LONG ADAY") return "text-success";
  if (label === "SHORT ADAY") return "text-blue-300";
  if (label === "RİSK REDDİ" || label === "BTC FİLTRESİ") return "text-danger";
  if (label === "İŞLEM YOK") return "text-muted";
  return "text-muted";
}

// ── Kaynak (KAYNAK) mapping — GMT / MT / MİL / KRM ────────────────────
export interface SourceInput {
  sourceDisplay?: string | null;
  candidateSources?: string[];
}

export function mapSourceLabel(row: SourceInput): string {
  if (row.sourceDisplay) return row.sourceDisplay;
  const sources = row.candidateSources ?? [];
  if (sources.length >= 2) return "KRM";
  if (sources.length === 1) {
    const s = sources[0];
    if (s === "WIDE_MARKET") return "GMT";
    if (s === "MOMENTUM") return "MT";
    if (s === "MANUAL_LIST") return "MİL";
  }
  return "—";
}

// ── WAIT reason kodları → kısa Türkçe etiket ──────────────────────────
export const WAIT_CODE_TR: Record<string, string> = {
  EMA_ALIGNMENT_MISSING: "EMA dizilim",
  MA_FAST_SLOW_CONFLICT: "MA çatışma",
  MACD_CONFLICT: "MACD uyumsuz",
  RSI_NEUTRAL: "RSI nötr",
  ADX_FLAT: "ADX zayıf",
  VWAP_NOT_CONFIRMED: "VWAP teyitsiz",
  VOLUME_WEAK: "Hacim zayıf",
  BOLLINGER_NO_CONFIRMATION: "BB teyitsiz",
  ATR_REGIME_UNCLEAR: "ATR belirsiz",
  BTC_DIRECTION_CONFLICT: "BTC zıt",
};

/**
 * Kısa "ana eksik / sebep" metni — POZİSYONA EN YAKIN COINLER ve
 * KARAR MERKEZİ kartları için ortak.
 */
export function buildReasonText(row: {
  signalType?: string;
  waitReasonCodes?: string[];
  /** Faz 12 — backend tarafından üretilen kısa Türkçe özet (varsa öncelikli). */
  waitReasonSummary?: string;
  scoreReason?: string;
  rejectReason?: string | null;
  riskRejectReason?: string | null;
  btcTrendRejected?: boolean;
}): string {
  if (row.btcTrendRejected) return "BTC trend filtresi";
  if (row.riskRejectReason) return row.riskRejectReason;
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

/** Signal threshold (signal-engine'deki MIN_SIGNAL_CONFIDENCE = 70). */
export const SIGNAL_THRESHOLD = 70;

/** İşlem skorunun 70 eşiğine kalan farkı. */
export function distanceToThreshold(opts: {
  tradeSignalScore?: number;
  signalScore?: number;
  opened?: boolean;
}): number | null {
  const score = opts.tradeSignalScore ?? opts.signalScore ?? 0;
  if (opts.opened) return 0;
  if (score <= 0) return null;
  return Math.max(0, SIGNAL_THRESHOLD - score);
}
