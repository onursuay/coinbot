// Phase 3 — Momentum Taraması: types and config.
//
// SCOPE: scaffold only. Pure data-shape definitions for the momentum
// screener layer. No I/O. No Binance traffic. Designed to feed directly
// into the Phase 2 candidate pool (MomentumCandidate extends
// LightweightCandidate so buildCandidatePool() accepts it as-is).
//
// Product rule: Momentum Taraması always considers both top gainers AND
// top losers together — there is no user-facing "Yükselenler / Düşenler /
// İkisi" knob. The UI exposes only Aktif/Pasif (see lib/scan-modes/types).

import type { LightweightCandidate } from "@/lib/market-universe/types";

export type MomentumDirectionBias = "UP" | "DOWN";

/**
 * A momentum candidate. Extends LightweightCandidate so it can be fed
 * unmodified into Phase-2 buildCandidatePool, while carrying momentum-
 * specific metadata (direction, rank, score) for downstream display.
 *
 * sourceCandidates is always ["MOMENTUM"] at the moment a candidate is
 * produced; the candidate-pool layer is responsible for merging sources
 * when the same symbol arrives from multiple modes (→ MIXED → "KRM").
 */
export interface MomentumCandidate extends LightweightCandidate {
  directionBias: MomentumDirectionBias;
  /** 1-based rank within the combined gainers+losers list, sorted by score desc. */
  momentumRank: number;
  /** 0..100 momentum quality score — see computeMomentumScore for components. */
  momentumScore: number;
}

/**
 * Momentum screener thresholds. Mirrors Phase-2 hygiene (volume, spread)
 * and adds momentum-specific knobs (top-N per direction, |move| floor,
 * total cap).
 */
export interface MomentumScreenerConfig {
  /** Top-N positive movers to take from the universe per scan. */
  topGainersLimit: number;
  /** Top-N negative movers to take from the universe per scan. */
  topLosersLimit: number;
  /** 24h quote (USDT) volume floor. */
  minQuoteVolumeUsd: number;
  /** Maximum spread (%) when bid/ask is available. */
  maxSpreadPercent: number;
  /** Minimum |24h price change %| — defines what counts as "momentum" at all. */
  minAbsMovePercent: number;
  /** Hard cap on the combined gainers+losers candidate list. */
  maxMomentumCandidates: number;
  /** Reject when bid/ask are present but non-positive / inverted. */
  rejectInvalidBidAsk: boolean;
}

/**
 * Sensible defaults — aligned with Phase-2 baselines, with a slightly
 * stronger movement floor (2.0%) since this is a momentum-specific screen.
 */
export const DEFAULT_MOMENTUM_CONFIG: MomentumScreenerConfig = {
  topGainersLimit: 20,
  topLosersLimit: 20,
  minQuoteVolumeUsd: 1_000_000,
  maxSpreadPercent: 0.30,
  minAbsMovePercent: 2.0,
  maxMomentumCandidates: 40,
  rejectInvalidBidAsk: true,
};
