// Phase 12 — longSetupScore / shortSetupScore ve directionCandidate üretimi.
//
// Bu fonksiyon yalnızca açıklayıcılık içindir; tradeSignalScore'u veya
// signalType'ı etkilemez.
//
// Skorlar 0–100 aralığına clamp edilir; eksik veride güvenli fallback'ler
// vardır, NaN/undefined üretmez.

import type {
  DirectionCandidate,
  DirectionInputs,
} from "./types";

function clamp01_100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export interface DirectionScoreResult {
  longSetupScore: number;
  shortSetupScore: number;
  directionCandidate: DirectionCandidate;
  directionConfidence: number;
}

export function scoreDirection(p: DirectionInputs): DirectionScoreResult {
  let lng = 0;
  let sht = 0;

  // 1. EMA dizilimi (15) + fiyat-vs-EMA50 (10) = 25 toplam
  if (Number.isFinite(p.e20) && Number.isFinite(p.e50) && Number.isFinite(p.e200)) {
    if (p.e20 > p.e50 && p.e50 > p.e200) lng += 15;
    else if (p.e20 < p.e50 && p.e50 < p.e200) sht += 15;
    else if (p.e20 > p.e50) lng += 8;
    else if (p.e20 < p.e50) sht += 8;
    if (p.last > p.e50) lng += 10;
    else if (p.last < p.e50) sht += 10;
  }

  // 2. MA8 / MA55 kısa-orta dizilim (12)
  if (Number.isFinite(p.ma8) && Number.isFinite(p.ma55)) {
    if (p.ma8 > p.ma55 && p.last > p.ma8) lng += 12;
    else if (p.ma8 < p.ma55 && p.last < p.ma8) sht += 12;
    else if (p.ma8 > p.ma55) lng += 6;
    else if (p.ma8 < p.ma55) sht += 6;
  }

  // 3. MACD histogram (12)
  if (Number.isFinite(p.macdHist)) {
    if (p.macdHist > 0) lng += 12;
    else if (p.macdHist < 0) sht += 12;
  }

  // 4. RSI (8)
  if (Number.isFinite(p.rsi)) {
    if (p.rsi >= 50 && p.rsi <= 65) lng += 8;
    else if (p.rsi >= 40 && p.rsi <= 55) { lng += 4; sht += 4; }
    else if (p.rsi >= 35 && p.rsi <= 50) sht += 8;
    else if (p.rsi > 70) sht += 4;
    else if (p.rsi < 30) lng += 4;
  }

  // 5. Bollinger (10)
  if (p.bbBreakoutUp && Number.isFinite(p.volumeImpulse) && p.volumeImpulse >= 1.3) lng += 10;
  else if (p.bbBreakoutDown && Number.isFinite(p.volumeImpulse) && p.volumeImpulse >= 1.3) sht += 10;
  else if (p.bbBreakoutUp) lng += 6;
  else if (p.bbBreakoutDown) sht += 6;
  else if (Number.isFinite(p.bbMiddle) && p.last > p.bbMiddle) lng += 4;
  else if (Number.isFinite(p.bbMiddle) && p.last < p.bbMiddle) sht += 4;

  // 6. ADX (8) — önde olan tarafı güçlendirir
  if (Number.isFinite(p.adxVal)) {
    const lead = lng - sht;
    if (p.adxVal >= 25) {
      if (lead > 0) lng += 8;
      else if (lead < 0) sht += 8;
      else { lng += 3; sht += 3; }
    } else if (p.adxVal >= 20) {
      if (lead > 0) lng += 5;
      else if (lead < 0) sht += 5;
    } else if (p.adxVal >= 15) {
      lng += 2; sht += 2;
    }
  }

  // 7. VWAP (8)
  if (p.priceAboveVwap === true) lng += 8;
  else if (p.priceAboveVwap === false) sht += 8;

  // 8. Volume impulse (10)
  if (Number.isFinite(p.volumeImpulse)) {
    const lead = lng - sht;
    if (p.volumeImpulse >= 1.5) {
      if (lead > 0) lng += 10;
      else if (lead < 0) sht += 10;
      else { lng += 4; sht += 4; }
    } else if (p.volumeImpulse >= 1.1) {
      if (lead > 0) lng += 6;
      else if (lead < 0) sht += 6;
    } else if (p.volumeImpulse >= 0.8) {
      lng += 2; sht += 2;
    }
  }

  // 9. BTC trend uyumu (5)
  if (p.btcUp === true) lng += 5;
  else if (p.btcUp === false) sht += 5;

  const longSetupScore = clamp01_100(lng);
  const shortSetupScore = clamp01_100(sht);

  // ── directionCandidate / directionConfidence ──
  const lead = longSetupScore - shortSetupScore;
  const top = Math.max(longSetupScore, shortSetupScore);
  const bottom = Math.min(longSetupScore, shortSetupScore);
  let directionCandidate: DirectionCandidate;
  if (top < 30) {
    directionCandidate = "NONE";
  } else if (lead >= 15 && longSetupScore >= 40) {
    directionCandidate = "LONG_CANDIDATE";
  } else if (-lead >= 15 && shortSetupScore >= 40) {
    directionCandidate = "SHORT_CANDIDATE";
  } else if (bottom >= 30) {
    directionCandidate = "MIXED";
  } else if (longSetupScore >= 40) {
    directionCandidate = "LONG_CANDIDATE";
  } else if (shortSetupScore >= 40) {
    directionCandidate = "SHORT_CANDIDATE";
  } else {
    directionCandidate = "MIXED";
  }
  const directionConfidence = top > 0 ? clamp01_100((Math.abs(lead) / top) * 100) : 0;

  return { longSetupScore, shortSetupScore, directionCandidate, directionConfidence };
}
