// Phase 5 — Birleşik Aday Havuz Entegrasyonu: types.
//
// SCOPE: scaffold only. The orchestrator stitches together the three
// coin-source layers (Geniş/Momentum/Manuel) into a single deduplicated
// pool with a deep-analysis subset. It DOES NOT call signal-engine, risk
// engine, or any trade-opening code path. The existing trading universe
// and worker tick are untouched.

import type {
  CandidatePoolEntry,
  DeepAnalysisCandidate,
  LightweightCandidate,
  MarketSymbolInfo,
} from "@/lib/market-universe/types";
import type { Ticker } from "@/lib/exchanges/types";
import type { ScanModesConfig, SingleCoinSource } from "@/lib/scan-modes/types";
import type { BookQuote } from "@/lib/market-universe/lightweight-screener";
import type { LightweightScreenerConfig } from "@/lib/market-universe/types";
import type { MomentumScreenerConfig } from "@/lib/momentum-screener/types";

export interface BuildUnifiedCandidatesInput {
  /** Current scan-modes state (which sources are active + manual symbols). */
  scanModes: ScanModesConfig;
  /** Tradable USDT-perp universe (Phase 2 cached). */
  universe: readonly MarketSymbolInfo[];
  /** Already-fetched bulk ticker map keyed by canonical symbol. */
  tickers: Record<string, Ticker>;
  /** Optional bid/ask map (e.g. /fapi/v1/ticker/bookTicker). */
  bookTickers?: Record<string, BookQuote>;

  /** Hard caps and screener configs (centralised, no magic numbers). */
  poolMax?: number;       // default DEFAULT_MARKET_UNIVERSE_CONFIG.candidatePoolMax (50)
  deepMax?: number;       // default DEFAULT_MARKET_UNIVERSE_CONFIG.deepAnalysisMax (30)
  screenerConfig?: Partial<LightweightScreenerConfig>;
  momentumConfig?: Partial<MomentumScreenerConfig>;
}

/**
 * Per-source breakdown — counts of unique symbols proposed by each
 * source BEFORE dedupe/merge. Sum can exceed `unifiedCandidateCount`
 * because the same coin may appear in multiple sources.
 */
export interface SourceBreakdown {
  wideMarketCandidateCount: number;
  momentumCandidateCount: number;
  manualListCandidateCount: number;
}

/**
 * Aggregate metrics returned alongside the unified pool. Display-only —
 * no part of the trading decision uses these numbers.
 */
export interface CandidateSummaryMetrics extends SourceBreakdown {
  totalUniverseCount: number;
  /** Coins where the displayed source resolved to MIXED (≥2 sources). */
  mixedCandidateCount: number;
  /** Final unified pool size after dedupe + cap. ≤ poolMax. */
  unifiedCandidateCount: number;
  /** Final deep-analysis subset size. ≤ deepMax. */
  deepAnalysisCandidateCount: number;
  /** Coins proposed but kept out of the pool by the cap. */
  filteredOutCount: number;
  /**
   * Manual-list symbols that are in the universe but lack live ticker
   * data right now. Included in the pool with a degraded snapshot;
   * counted here for visibility.
   */
  missingMarketDataCount: number;
}

/**
 * Final orchestrator output. Pure data — caller decides how to render
 * or ignore it. There is no automatic side effect on the trading path.
 */
export interface UnifiedCandidatePool {
  /** Unified, deduped, source-merged, capped pool (≤ poolMax). */
  pool: CandidatePoolEntry[];
  /** Top-N for downstream signal-engine handoff (≤ deepMax). */
  deepAnalysisCandidates: DeepAnalysisCandidate[];
  /** Diagnostic counters — never gate trades. */
  summary: CandidateSummaryMetrics;
  /**
   * Manual-list symbols stripped because they are NOT in the tradable
   * universe (delisted / wrong-quote / inactive). These are NOT removed
   * from the user's saved list — they're just excluded from this scan.
   */
  filteredOutManualSymbols: string[];
  /**
   * Manual-list symbols that ARE in the universe but had no live ticker
   * data at snapshot time. Included in the pool as degraded entries
   * (preScore=0, marketDataMissing=true) and listed here for visibility.
   */
  missingMarketDataSymbols: string[];
  /** Wallclock when this snapshot was assembled. */
  generatedAt: number;
}

// Re-export the underlying primitive types so callers don't need to
// reach across two layers.
export type {
  LightweightCandidate,
  CandidatePoolEntry,
  DeepAnalysisCandidate,
  SingleCoinSource,
};
