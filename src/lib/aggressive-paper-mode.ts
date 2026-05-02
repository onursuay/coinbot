// Aggressive Paper Test Mode — HARD-DISABLED at helper level (May 2026).
//
// Closed-trade audit showed bypass channels were producing net-negative paper
// trades. Per user mandate, this aggressive bypass channel is closed in code;
// env vars (AGGRESSIVE_PAPER_TEST_MODE, AGGRESSIVE_ALLOW_*) are intentionally
// ignored. `checkAggressivePaperMode` always returns `active=false` so the
// orchestrator branches that bypass quality / BTC-filter gates become no-ops.

export interface AggressivePaperCheck {
  active: boolean;
  reason: string | null;
  minSignalScore: number;
  minMarketQuality: number;
  maxTradesPerDay: number;
  maxOpenPositions: number;
  btcBypass: boolean;
  qualityBypass: boolean;
}

export function checkAggressivePaperMode(_settings: {
  trading_mode?: string | null;
  enable_live_trading?: boolean | null;
  kill_switch_active?: boolean | null;
}): AggressivePaperCheck {
  return {
    active: false,
    reason: "HARDDISABLED: aggressive paper test bypass channel closed in code",
    minSignalScore: 70,
    minMarketQuality: 75,
    maxTradesPerDay: 0,
    maxOpenPositions: 0,
    btcBypass: false,
    qualityBypass: false,
  };
}
