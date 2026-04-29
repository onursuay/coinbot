// Phase 3 — Momentum Taraması (barrel).
//
// Produces gainers+losers candidate rows that flow into the Phase-2
// candidate pool. No new Binance HTTP traffic; pure function over
// already-fetched bulk ticker data. See docs/BINANCE_API_GUARDRAILS.md.

export * from "./types";
export {
  runMomentumScreen,
  computeMomentumScore,
  type MomentumScreenInput,
} from "./momentum-screener";
