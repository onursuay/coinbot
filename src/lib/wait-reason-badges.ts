import type { WaitReasonCode } from "./engines/signal-engine";

// Structured reason items rendered as a vertical 2-line list in the Scanner
// "Red Nedeni" column. Presentation-only — mapping never touches the signal
// engine, scoring, or trade gates.
export interface ReasonItem {
  title: string;   // technical heading, all-caps (e.g. "MA8", "EMA", "HACİM")
  status: string;  // short status (e.g. "Uyumsuz", "Dizilimi Eksik", "Zayıf")
}

export const WAIT_REASON_ITEM: Record<WaitReasonCode, ReasonItem> = {
  EMA_ALIGNMENT_MISSING:    { title: "EMA",   status: "Dizilimi Eksik" },
  MA_FAST_SLOW_CONFLICT:    { title: "MA8",   status: "Uyumsuz" },
  MACD_CONFLICT:            { title: "MACD",  status: "Uyumsuz" },
  RSI_NEUTRAL:              { title: "RSI",   status: "Nötr" },
  ADX_FLAT:                 { title: "ADX",   status: "Zayıf" },
  VWAP_NOT_CONFIRMED:       { title: "VWAP",  status: "Teyitsiz" },
  VOLUME_WEAK:              { title: "HACİM", status: "Zayıf" },
  BOLLINGER_NO_CONFIRMATION:{ title: "BB",    status: "Teyitsiz" },
  ATR_REGIME_UNCLEAR:       { title: "ATR",   status: "Belirsiz" },
  BTC_DIRECTION_CONFLICT:   { title: "BTC",   status: "Zıt" },
};

// Free-text reject reasons emitted by signal-engine / risk-engine, normalised
// into the same { title, status } shape so the cell never renders sentences.
const REJECT_REASON_PATTERNS: { test: RegExp; item: ReasonItem }[] = [
  { test: /sinyal\s*skoru\s*d[üu]ş[üu]k/i,     item: { title: "SKOR",    status: "Düşük" } },
  { test: /btc\s*trend\s*negatif/i,            item: { title: "BTC",     status: "Negatif" } },
  { test: /btc\s*trend\s*pozitif/i,            item: { title: "BTC",     status: "Pozitif" } },
  { test: /spread\s*çok\s*y[üu]ksek/i,         item: { title: "SPREAD",  status: "Yüksek" } },
  { test: /hacim\s*d[üu]ş[üu]k|likidite/i,     item: { title: "HACİM",   status: "Düşük" } },
  { test: /piyasa\s*ölü|atr\s*hesaplanamadı/i, item: { title: "ATR",     status: "Belirsiz" } },
  { test: /stop.*çok\s*dar/i,                  item: { title: "STOP",    status: "Dar" } },
  { test: /stop.*çok\s*geniş/i,                item: { title: "STOP",    status: "Geniş" } },
  { test: /risk\/?ödül\s*yetersiz/i,           item: { title: "R:R",     status: "Yetersiz" } },
  { test: /funding\s*rate\s*aşırı/i,           item: { title: "FUNDING", status: "Aşırı" } },
  { test: /yetersiz\s*mum\s*verisi/i,          item: { title: "VERİ",    status: "Eksik" } },
  { test: /entry\/?sl\/?tp\s*eksik/i,          item: { title: "SETUP",   status: "Eksik" } },
];

export function reasonItemFromText(reason: string): ReasonItem {
  for (const { test, item } of REJECT_REASON_PATTERNS) {
    if (test.test(reason)) return item;
  }
  return { title: "DİĞER", status: "Reddedildi" };
}

export function buildReasonItems(input: {
  signalType: string;
  waitReasonCodes?: (WaitReasonCode | string)[];
  rejectReason?: string | null;
  riskRejectReason?: string | null;
}): ReasonItem[] {
  if (input.signalType === "WAIT") {
    return (input.waitReasonCodes ?? [])
      .map((c) => WAIT_REASON_ITEM[c as WaitReasonCode])
      .filter((x): x is ReasonItem => Boolean(x));
  }
  const text = input.rejectReason ?? input.riskRejectReason;
  return text ? [reasonItemFromText(text)] : [];
}
