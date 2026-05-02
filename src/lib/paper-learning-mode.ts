// Paper Learning Mode — canonical learning/data-collection mode for paper.
//
// Active ONLY when all five conditions hold simultaneously:
//   1. PAPER_LEARNING_MODE=true
//   2. trading_mode === "paper"
//   3. enable_live_trading !== true
//   4. HARD_LIVE_TRADING_ALLOWED !== true
//   5. kill switch is NOT active
//
// When active, the orchestrator:
//   • bypasses market quality / DYNAMIC_MIN_QUALITY / BTC trend filter / R:R
//     minimum / depth penalty as POSITION blockers (they become metadata only)
//   • uses paperLearningMinSignalScore (default 1) instead of normal-mode 70
//     as the tradeSignalScore floor (signal-score gate still enforces > 0)
//   • generates fallback SL/TP when missing (LONG: -1.5%/+3%, SHORT: +1.5%/-3%)
//   • records learning metadata (bypassed gates, original reject reason,
//     normalModeWouldReject, riskWarnings, learning hypothesis) in
//     paper_trades.risk_metadata and trade_learning_events
//
// Fatal gates that still apply regardless of this mode:
//   kill switch active, live trading indicators present, no entry price,
//   duplicate position, position/daily limits exceeded, Supabase INSERT failure,
//   missing direction, missing market data, signal score not numeric / zero / negative.

import { env } from "@/lib/env";

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

export function checkPaperLearningMode(settings: {
  trading_mode?: string | null;
  enable_live_trading?: boolean | null;
  kill_switch_active?: boolean | null;
}): PaperLearningCheck {
  const inactive = (reason: string): PaperLearningCheck => ({
    active: false,
    inactiveReason: reason,
    maxOpenPositions: 0,
    maxTradesPerDay: 0,
    minSignalScore: 1,
    allowRiskBypass: false,
    allowMarketQualityBypass: false,
    allowBtcFilterBypass: false,
    allowRrBypass: false,
    autoSlTp: false,
  });

  if (!env.paperLearningMode) return inactive("PAPER_LEARNING_MODE=false");
  if (settings.trading_mode !== "paper") return inactive(`trading_mode=${settings.trading_mode ?? "unknown"} (paper gerekli)`);
  if (settings.enable_live_trading === true) return inactive("enable_live_trading=true");
  if (env.hardLiveTradingAllowed) return inactive("HARD_LIVE_TRADING_ALLOWED=true");
  if (settings.kill_switch_active === true) return inactive("kill_switch_active=true");

  return {
    active: true,
    inactiveReason: null,
    maxOpenPositions: env.paperLearningMaxOpenPositions,
    maxTradesPerDay: env.paperLearningMaxTradesPerDay,
    minSignalScore: env.paperLearningMinSignalScore,
    allowRiskBypass: env.paperLearningAllowRiskBypass,
    allowMarketQualityBypass: env.paperLearningAllowMarketQualityBypass,
    allowBtcFilterBypass: env.paperLearningAllowBtcFilterBypass,
    allowRrBypass: env.paperLearningAllowRrBypass,
    autoSlTp: env.paperLearningAutoSlTp,
  };
}
