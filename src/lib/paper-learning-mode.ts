// Paper Learning Mode — HARD-DISABLED at helper level (May 2026).
//
// Background: closed-trade audit showed every recent paper trade had
// `paper_learning_mode=true` with `bypassed_gates ⊃ {risk, market_quality_bypass,
// btc_filter_bypass}` — i.e. the bypass channel was opening low-quality trades
// (setup_score<70, market_quality<70) that produced a net negative paper P&L.
// Per user mandate the bypass channel is closed in code; env vars
// (PAPER_LEARNING_MODE, PAPER_LEARNING_ALLOW_*) are intentionally ignored so a
// stale VPS env file cannot reopen the channel without a code change.
//
// `checkPaperLearningMode` therefore always returns `active=false` with all
// allow-bypass flags set to false. The orchestrator's existing branches that
// guard on `paperLearning.active` / `forceMode.active` become no-ops, which:
//   • removes `paper_learning_mode=true` from new trades' risk_metadata
//   • leaves `bypassed_gates` / `bypassed_risk_gates` empty
//   • restores the normal-mode min signal score floor (70) and the normal
//     market-quality / BTC-trend / risk-engine gates
//
// Live execution gates are unaffected — they were and remain locked off:
// HARD_LIVE_TRADING_ALLOWED=false, DEFAULT_TRADING_MODE=paper,
// enable_live_trading=false, openLiveOrder LIVE_EXECUTION_NOT_IMPLEMENTED.

export interface PaperLearningCheck {
  active: boolean;
  inactiveReason: string | null;
  maxOpenPositions: number;
  maxTradesPerDay: number;
  minSignalScore: number;
  allowRiskBypass: boolean;
  allowMarketQualityBypass: boolean;
  allowBtcFilterBypass: boolean;
  allowRrBypass: boolean;
  autoSlTp: boolean;
}

export function checkPaperLearningMode(_settings: {
  trading_mode?: string | null;
  enable_live_trading?: boolean | null;
  kill_switch_active?: boolean | null;
}): PaperLearningCheck {
  // Hard-disabled. Reason string is stable so log/test consumers can pin it.
  return {
    active: false,
    inactiveReason: "HARDDISABLED: paper learning bypass channel closed in code",
    maxOpenPositions: 0,
    maxTradesPerDay: 0,
    minSignalScore: 70,
    allowRiskBypass: false,
    allowMarketQualityBypass: false,
    allowBtcFilterBypass: false,
    allowRrBypass: false,
    autoSlTp: false,
  };
}
