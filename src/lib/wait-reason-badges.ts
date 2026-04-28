import type { WaitReasonCode } from "./engines/signal-engine";

// Per-column reason mapping for the Scanner table. Each technical blocker
// becomes its own column; a row's value is either a short status string
// ("Uyumsuz", "Zayıf", …) or undefined when that column does not apply.
// Presentation-only — never feeds back into the signal engine, scoring,
// or trade gates.

export type ReasonColumnKey =
  | "MA" | "EMA" | "MACD" | "RSI" | "ADX" | "VWAP"
  | "HACIM" | "BB" | "ATR" | "BTC" | "SKOR";

export const REASON_COLUMNS: { key: ReasonColumnKey; header: string }[] = [
  { key: "MA",    header: "MA" },
  { key: "EMA",   header: "EMA" },
  { key: "MACD",  header: "MACD" },
  { key: "RSI",   header: "RSI" },
  { key: "ADX",   header: "ADX" },
  { key: "VWAP",  header: "VWAP" },
  { key: "HACIM", header: "HACİM" },
  { key: "BB",    header: "BB" },
  { key: "ATR",   header: "ATR" },
  { key: "BTC",   header: "BTC" },
  { key: "SKOR",  header: "SKOR" },
];

const WAIT_CODE_COLUMN: Record<WaitReasonCode, { col: ReasonColumnKey; status: string }> = {
  EMA_ALIGNMENT_MISSING:     { col: "EMA",   status: "Dizilimi Eksik" },
  MA_FAST_SLOW_CONFLICT:     { col: "MA",    status: "Uyumsuz" },
  MACD_CONFLICT:             { col: "MACD",  status: "Uyumsuz" },
  RSI_NEUTRAL:               { col: "RSI",   status: "Nötr" },
  ADX_FLAT:                  { col: "ADX",   status: "Zayıf" },
  VWAP_NOT_CONFIRMED:        { col: "VWAP",  status: "Teyitsiz" },
  VOLUME_WEAK:               { col: "HACIM", status: "Zayıf" },
  BOLLINGER_NO_CONFIRMATION: { col: "BB",    status: "Teyitsiz" },
  ATR_REGIME_UNCLEAR:        { col: "ATR",   status: "Belirsiz" },
  BTC_DIRECTION_CONFLICT:    { col: "BTC",   status: "Zıt" },
};

// Free-text reject reasons emitted by signal-engine / risk-engine, normalised
// onto the same per-column shape so the table never has to render sentences.
const REJECT_PATTERNS: { test: RegExp; col: ReasonColumnKey; status: string }[] = [
  { test: /sinyal\s*skoru\s*d[üu]ş[üu]k/i, col: "SKOR", status: "Düşük" },
  { test: /btc\s*trend\s*negatif/i,         col: "BTC",  status: "Negatif" },
  { test: /btc\s*trend\s*pozitif/i,         col: "BTC",  status: "Pozitif" },
];

export type ReasonColumnValues = Partial<Record<ReasonColumnKey, string>>;

export function buildReasonColumns(input: {
  signalType: string;
  waitReasonCodes?: (WaitReasonCode | string)[];
  rejectReason?: string | null;
  riskRejectReason?: string | null;
}): ReasonColumnValues {
  const out: ReasonColumnValues = {};
  if (input.signalType === "WAIT") {
    for (const code of input.waitReasonCodes ?? []) {
      const m = WAIT_CODE_COLUMN[code as WaitReasonCode];
      if (m && !out[m.col]) out[m.col] = m.status;
    }
    return out;
  }
  const text = input.rejectReason ?? input.riskRejectReason ?? "";
  if (!text) return out;
  for (const p of REJECT_PATTERNS) {
    if (p.test.test(text)) {
      out[p.col] = p.status;
      break;
    }
  }
  return out;
}
