// Phase 2 — deep-analysis candidate selector.
//
// Pure function. Given a candidate pool, returns the top-N entries to be
// fed to the existing signal-engine in a future phase. Phase 2 does NOT
// invoke the signal-engine itself — this is the boundary handoff only.
//
// Ranking (descending priority):
//   1. marketQualityPreScore   — overall quality
//   2. quoteVolume             — liquidity tiebreaker
//   3. abs(priceChangePercent) — movement tiebreaker
//   4. spread health           — tighter spread first (null > looser)
//   5. symbol asc              — deterministic final tiebreak

import type { CandidatePoolEntry, DeepAnalysisCandidate } from "./types";
import { DEFAULT_MARKET_UNIVERSE_CONFIG } from "./types";

export interface DeepAnalysisOptions {
  /** Hard cap. Default: DEFAULT_MARKET_UNIVERSE_CONFIG.deepAnalysisMax (30). */
  max?: number;
}

export function getDeepAnalysisCandidates(
  pool: readonly CandidatePoolEntry[],
  opts: DeepAnalysisOptions = {},
): DeepAnalysisCandidate[] {
  const max = opts.max ?? DEFAULT_MARKET_UNIVERSE_CONFIG.deepAnalysisMax;
  if (max <= 0 || pool.length === 0) return [];

  const sorted = [...pool].sort(compare);
  return sorted.slice(0, max).map((e, i) => ({ ...e, rank: i + 1 }));
}

function compare(a: CandidatePoolEntry, b: CandidatePoolEntry): number {
  const ds = b.candidate.marketQualityPreScore - a.candidate.marketQualityPreScore;
  if (ds !== 0) return ds;

  const dv = b.candidate.quoteVolume - a.candidate.quoteVolume;
  if (dv !== 0) return dv;

  const dm = Math.abs(b.candidate.priceChangePercent) - Math.abs(a.candidate.priceChangePercent);
  if (dm !== 0) return dm;

  // Spread: null is better than wider — null treated as 0.
  const sa = a.candidate.spreadPercent ?? 0;
  const sb = b.candidate.spreadPercent ?? 0;
  if (sa !== sb) return sa - sb;

  return a.symbol.localeCompare(b.symbol);
}
