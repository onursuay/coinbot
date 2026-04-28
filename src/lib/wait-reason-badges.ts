import type { WaitReasonCode } from "./engines/signal-engine";

// Compact uppercase chip labels for the Scanner "Red Nedeni" column.
// Presentation-only — does not feed back into the signal engine or trade gates.
export const WAIT_REASON_BADGE_LABEL: Record<WaitReasonCode, string> = {
  EMA_ALIGNMENT_MISSING: "EMA: EKSİK",
  MA_FAST_SLOW_CONFLICT: "MA: UYUMSUZ",
  MACD_CONFLICT: "MACD: UYUMSUZ",
  RSI_NEUTRAL: "RSI: NÖTR",
  ADX_FLAT: "ADX: ZAYIF",
  VWAP_NOT_CONFIRMED: "VWAP: TEYİTSİZ",
  VOLUME_WEAK: "HACİM: ZAYIF",
  BOLLINGER_NO_CONFIRMATION: "BB: TEYİTSİZ",
  ATR_REGIME_UNCLEAR: "ATR: BELİRSİZ",
  BTC_DIRECTION_CONFLICT: "BTC: ZIT",
};

export function badgeLabelForWaitReason(code: WaitReasonCode | string): string {
  return WAIT_REASON_BADGE_LABEL[code as WaitReasonCode] ?? String(code).toUpperCase();
}
