// Faz 21 — Ana kademeli yönetim karar motoru (advisory only).
//
// Tüm çıktılar öneri/metadata niteliğindedir:
//   • Gerçek emir gönderilmez.
//   • Binance API çağrısı yapılmaz.
//   • Kaldıraç execution yoktur.
//   • Zararda pozisyon büyütme yasaktır.

import type {
  PositionManagementInput,
  PositionManagementAction,
  PositionManagementDecision,
  ProgressiveStage,
} from "./types";
import { calculateTrailingStop } from "./trailing-stop";
import { evaluateScaleIn } from "./scale-rules";

function classifyStage(rMultiple: number): ProgressiveStage {
  if (rMultiple < 0) return "losing";
  if (rMultiple < 0.5) return "breakeven";
  if (rMultiple < 1) return "early_profit";
  if (rMultiple < 1.5) return "at_1r";
  if (rMultiple < 2) return "at_1_5r";
  return "at_2r_plus";
}

function computeRMultiple(input: PositionManagementInput): number {
  if (input.currentRMultiple !== undefined) return input.currentRMultiple;
  if (!input.riskAmountUsdt || input.riskAmountUsdt <= 0) return 0;
  return input.unrealizedPnl / input.riskAmountUsdt;
}

export function evaluatePosition(
  input: PositionManagementInput,
): PositionManagementDecision {
  const rMultiple = computeRMultiple(input);
  const stage = classifyStage(rMultiple);
  const warnings: string[] = [];

  // Validate input sanity
  if (!Number.isFinite(rMultiple)) {
    warnings.push("R-multiple hesaplanamadı — veri eksik");
  }
  if (input.riskAmountUsdt <= 0) {
    warnings.push("riskAmountUsdt tanımsız — R-multiple hesabı güvenilmez");
  }

  const trailing = calculateTrailingStop(input, rMultiple);
  const scale = evaluateScaleIn(input, rMultiple);

  let action: PositionManagementAction = "HOLD";
  let actionPriority: PositionManagementDecision["actionPriority"] = "none";
  let recommendedPartialTakeProfitPercent: number | null = null;
  let explanation = "";

  switch (stage) {
    case "losing": {
      action = "BLOCK_SCALE_IN_LOSING_POSITION";
      actionPriority = "none";
      explanation = `Pozisyon zarar bölgesinde (R=${rMultiple.toFixed(2)}). Pozisyon izleniyor — scale-in engellendi.`;
      warnings.push("Zararda büyütme engellendi (averageDownEnabled=false)");
      break;
    }
    case "breakeven": {
      action = "HOLD";
      actionPriority = "none";
      explanation = `Pozisyon başabaş bölgesinde (R=${rMultiple.toFixed(2)}). İzle.`;
      break;
    }
    case "early_profit": {
      action = "HOLD";
      actionPriority = "low";
      explanation = `Erken kâr bölgesi (R=${rMultiple.toFixed(2)}). 1R hedefine yaklaş.`;
      break;
    }
    case "at_1r": {
      action = "MOVE_SL_TO_BREAKEVEN";
      actionPriority = "medium";
      explanation = `1R aşamasında (R=${rMultiple.toFixed(2)}). SL breakeven'a taşıma önerilir.`;
      break;
    }
    case "at_1_5r": {
      if (trailing.trailingStopRecommended) {
        action = "ENABLE_TRAILING_STOP";
        actionPriority = "medium";
      } else {
        action = "PARTIAL_TAKE_PROFIT";
        actionPriority = "medium";
      }
      recommendedPartialTakeProfitPercent = 25;
      explanation = `1.5R aşamasında (R=${rMultiple.toFixed(2)}). Kısmi kâr (%25) veya trailing stop önerilir.`;

      if (scale.considerScaleIn) {
        action = "CONSIDER_PROFIT_SCALE_IN";
        actionPriority = "low";
        explanation += " Kârda büyütme koşulları sağlandı (yalnızca öneri).";
      }
      break;
    }
    case "at_2r_plus": {
      if (trailing.trailingStopRecommended && rMultiple >= 3) {
        action = "TIGHTEN_TRAILING_STOP";
        actionPriority = "high";
      } else {
        action = "ENABLE_TRAILING_STOP";
        actionPriority = "medium";
      }
      recommendedPartialTakeProfitPercent = 50;
      explanation = `2R+ aşamasında (R=${rMultiple.toFixed(2)}). Trailing stop güçlü önerilir, %50 kısmi kâr seçeneği.`;
      break;
    }
  }

  return {
    symbol: input.symbol,
    side: input.side,
    action,
    actionPriority,
    currentRMultiple: Number.isFinite(rMultiple) ? rMultiple : 0,
    stage,
    recommendedStopLoss: trailing.recommendedStopLoss,
    recommendedPartialTakeProfitPercent,
    scaleInAllowed: scale.scaleInAllowed,
    scaleInBlockedReason: scale.scaleInBlockedReason,
    trailingStopRecommended: trailing.trailingStopRecommended,
    explanation,
    warnings,
    isLive: input.mode === "live",
    mode: input.mode,
  };
}
