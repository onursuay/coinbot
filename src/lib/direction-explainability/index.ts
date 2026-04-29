// Phase 12 — Direction explainability barrel.
//
// AMAÇ: Bot WAIT / İŞLEM YOK kaldığında kullanıcıya hangi yöne yakın olduğunu
// ve hangi şartların eksik olduğunu net göstermek.
//
// KESİN KURALLAR:
//   • Bu modülün ürettiği hiçbir alan trade engine kararını etkilemez.
//   • directionCandidate, gerçek signalType (LONG/SHORT) yerine geçmez.
//   • longSetupScore / shortSetupScore, tradeSignalScore yerine geçmez.
//   • MIN_SIGNAL_CONFIDENCE=70 eşiği, BTC trend filtresi, SL/TP/R:R kontrolleri,
//     risk gate ve paper mode davranışı bu modülden bağımsızdır.

import { scoreDirection } from "./score-direction";
import { buildWaitReasonCodes } from "./wait-reasons";
import { buildWaitReasonSummary } from "./summary";
import type { DirectionExplainability, DirectionInputs } from "./types";

export type {
  DirectionCandidate,
  DirectionInputs,
  DirectionExplainability,
  WaitReasonCode,
} from "./types";

export { scoreDirection } from "./score-direction";
export { buildWaitReasonCodes, WAIT_REASON_VOCAB } from "./wait-reasons";
export { WAIT_REASON_TR, buildWaitReasonSummary, topReasons } from "./summary";

/**
 * Tek seferde longSetupScore / shortSetupScore / directionCandidate /
 * directionConfidence / waitReasonCodes / waitReasonSummary üretir.
 *
 * Eksik veride NaN/undefined üretmez; güvenli fallback'ler kullanır.
 */
export function computeDirectionExplainability(
  inputs: DirectionInputs,
): DirectionExplainability {
  const score = scoreDirection(inputs);
  const waitReasonCodes = buildWaitReasonCodes({
    ...inputs,
    directionCandidate: score.directionCandidate,
  });
  const waitReasonSummary = buildWaitReasonSummary(score.directionCandidate, waitReasonCodes);
  return {
    longSetupScore: score.longSetupScore,
    shortSetupScore: score.shortSetupScore,
    directionCandidate: score.directionCandidate,
    directionConfidence: score.directionConfidence,
    waitReasonCodes,
    waitReasonSummary,
  };
}
