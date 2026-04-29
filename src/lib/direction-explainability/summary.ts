// Phase 12 — Türkçe sebep özetleri.
//
// waitReasonCodes → kısa Türkçe etiket (UI badge / tooltip).
// waitReasonSummary → en fazla 2–3 ana sebep içeren tek satırlık özet.
//
// "Trend/momentum belirsiz" türü tek başına yetersiz açıklamalar yerine,
// kullanıcının hangi koşulun eksik olduğunu doğrudan görebilmesini sağlar.

import type {
  DirectionCandidate,
  WaitReasonCode,
} from "./types";

/** Kısa Türkçe etiket — kart/badge için. */
export const WAIT_REASON_TR: Record<WaitReasonCode, string> = {
  EMA_ALIGNMENT_MISSING: "EMA dizilimi eksik",
  MA_FAST_SLOW_CONFLICT: "hızlı/yavaş ortalama uyumsuz",
  MACD_CONFLICT: "MACD uyumsuz",
  RSI_NEUTRAL: "RSI nötr",
  ADX_FLAT: "trend gücü zayıf",
  VWAP_NOT_CONFIRMED: "VWAP teyidi yok",
  VOLUME_WEAK: "hacim zayıf",
  BOLLINGER_NO_CONFIRMATION: "Bollinger teyidi yok",
  ATR_REGIME_UNCLEAR: "volatilite rejimi belirsiz",
  BTC_DIRECTION_CONFLICT: "BTC yönü ters",
};

/** En fazla N (varsayılan 3) sebebi olan kompakt liste. */
export function topReasons(codes: WaitReasonCode[], maxN = 3): WaitReasonCode[] {
  return codes.slice(0, Math.max(0, maxN));
}

/**
 * waitReasonCodes ve directionCandidate'tan kısa Türkçe özet üretir.
 * En fazla 2–3 ana sebep gösterir; uzun teknik paragraf üretmez.
 *
 * Örnek çıktılar:
 *   - "LONG adayı ama EMA dizilimi eksik, hacim zayıf"
 *   - "SHORT adayı ama BTC yönü ters"
 *   - "Yön net değil: RSI nötr, trend gücü zayıf"
 *   - "Yön teyidi bekleniyor"            // hiç sebep yoksa
 *   - "Fırsat yapısı var, işlem şartı tamamlanmadı"  // explicit fallback
 */
export function buildWaitReasonSummary(
  directionCandidate: DirectionCandidate,
  codes: WaitReasonCode[],
): string {
  const top = topReasons(codes, 2)
    .map((c) => WAIT_REASON_TR[c])
    .filter(Boolean);

  if (directionCandidate === "LONG_CANDIDATE") {
    return top.length > 0
      ? `LONG adayı ama ${top.join(", ")}`
      : "LONG adayı, yön teyidi bekleniyor";
  }
  if (directionCandidate === "SHORT_CANDIDATE") {
    return top.length > 0
      ? `SHORT adayı ama ${top.join(", ")}`
      : "SHORT adayı, yön teyidi bekleniyor";
  }
  if (directionCandidate === "MIXED") {
    return top.length > 0
      ? `Yön karışık: ${top.join(", ")}`
      : "Yön karışık, teyit bekleniyor";
  }
  // NONE
  return top.length > 0
    ? `Yön net değil: ${top.join(", ")}`
    : "Yön teyidi bekleniyor";
}
