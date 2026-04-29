// Phase 12 — waitReasonCodes üretimi.
//
// Adaylığa karşılık gelen tarafın hangi koşulları sağlamadığını listeleyen
// kompakt sebep kodları. UI'a kısa Türkçe çeviri için summary.ts kullanılır.
// Bu kodlar trade kararını etkilemez, sadece açıklayıcıdır.

import type {
  DirectionCandidate,
  DirectionInputs,
  WaitReasonCode,
} from "./types";

export interface WaitReasonInputs extends DirectionInputs {
  directionCandidate: DirectionCandidate;
}

export function buildWaitReasonCodes(p: WaitReasonInputs): WaitReasonCode[] {
  const codes: WaitReasonCode[] = [];
  const want: "LONG" | "SHORT" | null =
    p.directionCandidate === "LONG_CANDIDATE" ? "LONG" :
    p.directionCandidate === "SHORT_CANDIDATE" ? "SHORT" : null;

  // EMA dizilim eksik
  if (Number.isFinite(p.e20) && Number.isFinite(p.e50) && Number.isFinite(p.e200)) {
    const bullStack = p.e20 > p.e50 && p.e50 > p.e200 && p.last > p.e50;
    const bearStack = p.e20 < p.e50 && p.e50 < p.e200 && p.last < p.e50;
    if (want === "LONG" && !bullStack) codes.push("EMA_ALIGNMENT_MISSING");
    else if (want === "SHORT" && !bearStack) codes.push("EMA_ALIGNMENT_MISSING");
    else if (!want && !bullStack && !bearStack) codes.push("EMA_ALIGNMENT_MISSING");
  }

  // MA8/MA55 uyumsuz
  if (Number.isFinite(p.ma8) && Number.isFinite(p.ma55)) {
    if (want === "LONG" && !(p.ma8 > p.ma55 && p.last > p.ma8)) codes.push("MA_FAST_SLOW_CONFLICT");
    else if (want === "SHORT" && !(p.ma8 < p.ma55 && p.last < p.ma8)) codes.push("MA_FAST_SLOW_CONFLICT");
  }

  // MACD uyumsuz
  if (Number.isFinite(p.macdHist)) {
    if (want === "LONG" && p.macdHist <= 0) codes.push("MACD_CONFLICT");
    else if (want === "SHORT" && p.macdHist >= 0) codes.push("MACD_CONFLICT");
    else if (!want && Math.abs(p.macdHist) < 1e-9) codes.push("MACD_CONFLICT");
  }

  // RSI nötr / aşırı
  if (Number.isFinite(p.rsi)) {
    if (p.rsi >= 45 && p.rsi <= 55) codes.push("RSI_NEUTRAL");
    else if (want === "LONG" && p.rsi > 70) codes.push("RSI_NEUTRAL");
    else if (want === "SHORT" && p.rsi < 30) codes.push("RSI_NEUTRAL");
  }

  // ADX zayıf
  if (Number.isFinite(p.adxVal) && p.adxVal < 20) codes.push("ADX_FLAT");

  // VWAP teyitsiz
  if (p.priceAboveVwap !== null) {
    if (want === "LONG" && p.priceAboveVwap === false) codes.push("VWAP_NOT_CONFIRMED");
    else if (want === "SHORT" && p.priceAboveVwap === true) codes.push("VWAP_NOT_CONFIRMED");
  }

  // Hacim zayıf
  if (Number.isFinite(p.volumeImpulse) && p.volumeImpulse < 1.0) codes.push("VOLUME_WEAK");

  // Bollinger teyitsiz
  if (want === "LONG" && !p.bbBreakoutUp) codes.push("BOLLINGER_NO_CONFIRMATION");
  else if (want === "SHORT" && !p.bbBreakoutDown) codes.push("BOLLINGER_NO_CONFIRMATION");
  else if (!want && !p.bbBreakoutUp && !p.bbBreakoutDown) codes.push("BOLLINGER_NO_CONFIRMATION");

  // ATR rejimi belirsiz
  if (Number.isFinite(p.atrPctileVal) && (p.atrPctileVal < 10 || p.atrPctileVal > 90)) {
    codes.push("ATR_REGIME_UNCLEAR");
  }

  // BTC yön çakışması
  if (p.btcUp !== null) {
    if (want === "LONG" && p.btcUp === false) codes.push("BTC_DIRECTION_CONFLICT");
    else if (want === "SHORT" && p.btcUp === true) codes.push("BTC_DIRECTION_CONFLICT");
  }

  return codes;
}

/** Tüm desteklenen sebep kodlarının sabit listesi — test/diagnostic kullanımı için. */
export const WAIT_REASON_VOCAB: readonly WaitReasonCode[] = [
  "EMA_ALIGNMENT_MISSING",
  "MA_FAST_SLOW_CONFLICT",
  "MACD_CONFLICT",
  "RSI_NEUTRAL",
  "ADX_FLAT",
  "VWAP_NOT_CONFIRMED",
  "VOLUME_WEAK",
  "BOLLINGER_NO_CONFIRMATION",
  "ATR_REGIME_UNCLEAR",
  "BTC_DIRECTION_CONFLICT",
] as const;
