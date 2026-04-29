// Phase 2 — Geniş Market Taraması Katmanlı Altyapı (barrel).
//
// Layer ordering (read top-to-bottom):
//   types               — config + DTOs, no behavior
//   universe-store      — TTL-cached USDT perp universe (uses central adapter)
//   lightweight-screener — pure filter+score over already-fetched bulk tickers
//   candidate-pool      — multi-source dedupe + cap (max 50)
//   deep-analysis       — top-N selector for signal-engine handoff (max 30)
//
// This module DOES NOT change worker/signal/risk/UI behavior. It is the
// scaffold that future phases will wire into the scanner pipeline.
// Binance API Guardrails (docs/BINANCE_API_GUARDRAILS.md) preserved.

export * from "./types";
export {
  getMarketUniverse,
  refreshMarketUniverse,
  getMarketUniverseFetchedAt,
  filterToTradableUsdtPerpetuals,
  __resetMarketUniverseCacheForTests,
  type GetUniverseOptions,
} from "./universe-store";
export {
  runLightweightScreen,
  computeMarketQualityPreScore,
  type ScreenInput,
  type BookQuote,
} from "./lightweight-screener";
export {
  buildCandidatePool,
  getDisplayedSource,
  type BuildPoolOptions,
} from "./candidate-pool";
export {
  getDeepAnalysisCandidates,
  type DeepAnalysisOptions,
} from "./deep-analysis";
