// Faz 21 — Kârda scale-in karar modeli (advisory only — no real order).
//
// MUTLAK KURAL: Zararda pozisyon büyütme asla önerilmez.
//   • currentRMultiple < 0 → BLOCK_SCALE_IN_LOSING_POSITION
//   • averageDownEnabled=false invariantı korunur (bu modülde "averaging down"
//     söz konusu değildir; scale-in yalnızca kârda değerlendirilebilir).
//
// Scale-in önerisi (CONSIDER_PROFIT_SCALE_IN):
//   • currentRMultiple >= 1.5
//   • tradeSignalScore >= 70
//   • btcAligned = true
//   • volumeImpulse = true
//   • marketQualityScore >= 70
//   • setupScore >= 70
//   • mevcut SL en az breakeven (entry) seviyesine taşınabilir durumda
//   Bu fazda bu aksiyon yalnızca öneri/metadata; gerçek emir yok.

import type { PositionManagementInput, ScaleDecision } from "./types";

export function evaluateScaleIn(
  input: PositionManagementInput,
  rMultiple: number,
): ScaleDecision {
  // Absolute guard: losing position — never allow any scale-in
  if (rMultiple < 0) {
    return {
      scaleInAllowed: false,
      scaleInBlockedReason: `Zarar bölgesi (R=${rMultiple.toFixed(2)}) — zararda pozisyon büyütme yasaktır (averageDownEnabled=false)`,
      considerScaleIn: false,
    };
  }

  // Not yet in profit territory for scale consideration
  if (rMultiple < 1.5) {
    return {
      scaleInAllowed: false,
      scaleInBlockedReason: `R=${rMultiple.toFixed(2)} < 1.5 — kârda büyütme eşiği henüz ulaşılmadı`,
      considerScaleIn: false,
    };
  }

  // Check signal quality conditions
  const reasons: string[] = [];
  if (input.tradeSignalScore < 70) reasons.push(`sinyalScore=${input.tradeSignalScore} < 70`);
  if (!input.btcAligned) reasons.push("BTC trendi uyumsuz");
  if (!input.volumeImpulse) reasons.push("hacim impulsu zayıf");
  if (input.marketQualityScore < 70) reasons.push(`piyasaKalite=${input.marketQualityScore} < 70`);
  if (input.setupScore < 70) reasons.push(`setupScore=${input.setupScore} < 70`);

  // SL must be moveable to at least breakeven
  const slAtOrAboveBreakeven =
    input.side === "LONG"
      ? input.stopLoss >= input.entryPrice
      : input.stopLoss <= input.entryPrice;

  if (!slAtOrAboveBreakeven) {
    reasons.push("SL henüz breakeven seviyesine taşınmamış");
  }

  if (reasons.length > 0) {
    return {
      scaleInAllowed: false,
      scaleInBlockedReason: `Koşul sağlanmıyor: ${reasons.join(", ")}`,
      considerScaleIn: false,
    };
  }

  // All conditions met — emit advisory recommendation only
  return {
    scaleInAllowed: true,
    scaleInBlockedReason: null,
    considerScaleIn: true,
  };
}
