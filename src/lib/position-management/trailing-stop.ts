// Faz 21 — Trailing stop karar modeli (advisory only — no real order update).
//
// Kurallar:
//   • Long: SL sadece yukarı hareket eder.
//   • Short: SL sadece aşağı hareket eder.
//   • SL asla riski artıracak yönde (entry'den uzaklaşacak şekilde) geri alınmaz.
//   • Breakeven sonrası stop yalnızca kârı koruyacak yönde güncellenir.
//   • Gerçek order update yoktur; yalnızca recommendedStopLoss üretilir.

import type { PositionManagementInput, TrailingStopState } from "./types";

export function calculateTrailingStop(
  input: PositionManagementInput,
  rMultiple: number,
): TrailingStopState {
  const { side, entryPrice, currentPrice, stopLoss } = input;

  // Compute original stop distance as a fraction of entry
  const origStopDistFrac =
    entryPrice > 0 ? Math.abs(entryPrice - stopLoss) / entryPrice : 0;

  // Trailing tightness by R-multiple stage
  // At 1R: use full origStopDist (trail at entry ± origStop)
  // At 1.5R: use 75% of origStopDist
  // At 2R+: use 50% of origStopDist (tightest trail)
  let trailFrac: number;
  if (rMultiple >= 2) {
    trailFrac = origStopDistFrac * 0.5;
  } else if (rMultiple >= 1.5) {
    trailFrac = origStopDistFrac * 0.75;
  } else if (rMultiple >= 1) {
    trailFrac = origStopDistFrac;
  } else {
    return {
      trailingStopRecommended: false,
      recommendedStopLoss: null,
      stopMoveReason: null,
      stopShouldNotMoveReason: `R-multiple ${rMultiple.toFixed(2)} < 1 — trailing henüz aktif değil`,
    };
  }

  let recommendedSl: number;
  if (side === "LONG") {
    // Trail below current price by trailFrac
    recommendedSl = currentPrice * (1 - trailFrac);
    // RULE: never move SL below its current level for a long (don't increase risk)
    if (recommendedSl <= stopLoss) {
      return {
        trailingStopRecommended: false,
        recommendedStopLoss: null,
        stopMoveReason: null,
        stopShouldNotMoveReason: `Önerilen SL (${recommendedSl.toFixed(4)}) mevcut SL (${stopLoss}) altında — hareket edilmez`,
      };
    }
    // Also: never move below breakeven (entry)
    if (rMultiple >= 1 && recommendedSl < entryPrice) {
      recommendedSl = entryPrice; // minimum = breakeven
    }
  } else {
    // SHORT: trail above current price
    recommendedSl = currentPrice * (1 + trailFrac);
    // RULE: never move SL above its current level for a short (don't increase risk)
    if (recommendedSl >= stopLoss) {
      return {
        trailingStopRecommended: false,
        recommendedStopLoss: null,
        stopMoveReason: null,
        stopShouldNotMoveReason: `Önerilen SL (${recommendedSl.toFixed(4)}) mevcut SL (${stopLoss}) üzerinde — hareket edilmez`,
      };
    }
    if (rMultiple >= 1 && recommendedSl > entryPrice) {
      recommendedSl = entryPrice;
    }
  }

  if (!Number.isFinite(recommendedSl) || recommendedSl <= 0) {
    return {
      trailingStopRecommended: false,
      recommendedStopLoss: null,
      stopMoveReason: null,
      stopShouldNotMoveReason: "Hesaplama geçersiz",
    };
  }

  const stageLabel = rMultiple >= 2 ? "2R+" : rMultiple >= 1.5 ? "1.5R" : "1R";
  return {
    trailingStopRecommended: true,
    recommendedStopLoss: recommendedSl,
    stopMoveReason: `${side} trailing stop — ${stageLabel} aşamasında SL ${recommendedSl.toFixed(4)} öneriliyor (yalnızca öneri)`,
    stopShouldNotMoveReason: null,
  };
}
