// Force Paper Entry Mode — HARD-DISABLED at helper level (May 2026).
//
// Closed-trade audit showed bypass channels (risk gate / market_quality_bypass /
// btc_filter_bypass) were producing net-negative paper trades. Per user mandate,
// the channel is closed in code; env vars (FORCE_PAPER_ENTRY_MODE,
// FORCE_PAPER_ALLOW_*) are intentionally ignored to prevent reopening via env.
//
// `checkForcePaperEntryMode` always returns `active=false` so the orchestrator
// branches that bypass risk / quality / BTC-filter / R:R gates become no-ops.
// Paper trade entries now flow through the normal-mode gate stack.
//
// Live execution gates are unaffected — they were and remain locked off.

export interface ForcePaperCheck {
  active: boolean;
  inactiveReason: string | null;
  maxOpenPositions: number;
  maxTradesPerDay: number;
  minSignalScore: number;
  allowRiskBypass: boolean;
  allowMarketQualityBypass: boolean;
  allowBtcFilterBypass: boolean;
  allowRrBypass: boolean;
}

export function checkForcePaperEntryMode(_settings: {
  trading_mode?: string | null;
  enable_live_trading?: boolean | null;
  kill_switch_active?: boolean | null;
}): ForcePaperCheck {
  return {
    active: false,
    inactiveReason: "HARDDISABLED: force paper entry bypass channel closed in code",
    maxOpenPositions: 0,
    maxTradesPerDay: 0,
    minSignalScore: 70,
    allowRiskBypass: false,
    allowMarketQualityBypass: false,
    allowBtcFilterBypass: false,
    allowRrBypass: false,
  };
}
