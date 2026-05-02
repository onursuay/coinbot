// Hard signal-score gate. Runs in EVERY mode (force paper / aggressive paper /
// normal). A trade can only be opened when:
//   • tradeSignalScore is a finite, positive number
//   • tradeSignalScore ≥ active mode's minimum (force=1, aggressive=45, normal=70)
//   • effectiveSignalType is "LONG" or "SHORT"
//   • directionCandidate alone (without a real LONG/SHORT signalType backed by
//     a sufficient score) never opens a position
//   • setup / quality / opportunity scores are NOT substitutes for tradeSignalScore
//
// This gate is the last line of defence after the signal engine, risk engine,
// and any paper-mode bypasses. It does not depend on Supabase/Binance and is
// safe to call from anywhere.

export type SignalScoreRejectCode =
  | "SCORE_NOT_NUMERIC"
  | "SIGNAL_SCORE_ZERO"
  | "NO_VALID_SIGNAL_SCORE"
  | "SIGNAL_TYPE_MISSING"
  | "DIRECTION_CANDIDATE_ONLY";

export interface SignalScoreGateInput {
  tradeSignalScore: unknown;
  signalType: string | null | undefined;
  effectiveSignalType: string | null | undefined;
  directionCandidate: string | null | undefined;
  /** Active mode minimum (force=1, aggressive=45, normal=70). */
  minSignalScore: number;
  modeLabel: "force_paper" | "aggressive_paper" | "normal";
}

export interface SignalScoreGateResult {
  ok: boolean;
  code: SignalScoreRejectCode | null;
  reason: string | null;
}

export function validateSignalScoreGate(input: SignalScoreGateInput): SignalScoreGateResult {
  const { tradeSignalScore, signalType, effectiveSignalType, directionCandidate, minSignalScore } = input;

  if (typeof tradeSignalScore !== "number" || !Number.isFinite(tradeSignalScore)) {
    return {
      ok: false,
      code: "SCORE_NOT_NUMERIC",
      reason: "İşlem açılmadı: geçerli sinyal skoru yok (SCORE_NOT_NUMERIC)",
    };
  }
  if (tradeSignalScore === 0) {
    return {
      ok: false,
      code: "SIGNAL_SCORE_ZERO",
      reason: "İşlem açılmadı: geçerli sinyal skoru yok (SIGNAL_SCORE_ZERO, score=0)",
    };
  }
  if (tradeSignalScore < 0) {
    return {
      ok: false,
      code: "NO_VALID_SIGNAL_SCORE",
      reason: `İşlem açılmadı: geçerli sinyal skoru yok (NO_VALID_SIGNAL_SCORE, score=${tradeSignalScore})`,
    };
  }

  const effective = effectiveSignalType === "LONG" || effectiveSignalType === "SHORT" ? effectiveSignalType : null;
  if (!effective) {
    return {
      ok: false,
      code: "SIGNAL_TYPE_MISSING",
      reason: `İşlem açılmadı: geçerli sinyal yönü yok (SIGNAL_TYPE_MISSING, signalType=${signalType ?? "null"})`,
    };
  }

  // Direction came purely from directionCandidate while the real signalType was
  // NO_TRADE/WAIT — i.e., the original signal was rejected by the signal engine.
  // Even in paper-learning modes, this cannot bypass the score floor.
  const dcOnly =
    signalType !== "LONG" &&
    signalType !== "SHORT" &&
    (directionCandidate === "LONG_CANDIDATE" || directionCandidate === "SHORT_CANDIDATE");
  if (dcOnly && tradeSignalScore < minSignalScore) {
    return {
      ok: false,
      code: "DIRECTION_CANDIDATE_ONLY",
      reason: `İşlem açılmadı: yön sadece aday — gerçek sinyal yok (DIRECTION_CANDIDATE_ONLY, score=${tradeSignalScore} < min=${minSignalScore})`,
    };
  }

  if (tradeSignalScore < minSignalScore) {
    return {
      ok: false,
      code: "NO_VALID_SIGNAL_SCORE",
      reason: `İşlem açılmadı: geçerli sinyal skoru yok (NO_VALID_SIGNAL_SCORE, score=${tradeSignalScore} < min=${minSignalScore})`,
    };
  }

  return { ok: true, code: null, reason: null };
}
