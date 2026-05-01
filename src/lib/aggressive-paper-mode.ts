// Aggressive Paper Test Mode helper.
// Active ONLY when all five conditions hold simultaneously:
//   1. AGGRESSIVE_PAPER_TEST_MODE=true
//   2. trading_mode === "paper"
//   3. enable_live_trading !== true
//   4. HARD_LIVE_TRADING_ALLOWED !== true
//   5. kill switch is NOT active
//
// Hard gates that cannot be bypassed regardless of this mode:
//   SL/TP required, R:R ≥ 2, valid entry price, max open positions,
//   daily aggressive trade limit, kill switch, Supabase insert success,
//   spread/volume fatal checks, insufficient candle data.

import { env } from "@/lib/env";

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

export function checkAggressivePaperMode(settings: {
  trading_mode?: string | null;
  enable_live_trading?: boolean | null;
  kill_switch_active?: boolean | null;
}): AggressivePaperCheck {
  const inactive = (reason: string): AggressivePaperCheck => ({
    active: false,
    reason,
    minSignalScore: 70,
    minMarketQuality: 75,
    maxTradesPerDay: 0,
    maxOpenPositions: 0,
    btcBypass: false,
    qualityBypass: false,
  });

  if (!env.aggressivePaperTestMode) return inactive("AGGRESSIVE_PAPER_TEST_MODE=false");
  if (settings.trading_mode !== "paper") return inactive(`trading_mode=${settings.trading_mode ?? "unknown"} (paper gerekli)`);
  if (settings.enable_live_trading === true) return inactive("enable_live_trading=true");
  if (env.hardLiveTradingAllowed) return inactive("HARD_LIVE_TRADING_ALLOWED=true");
  if (settings.kill_switch_active === true) return inactive("kill_switch_active=true");

  return {
    active: true,
    reason: null,
    minSignalScore: env.aggressiveMinSignalScore,
    minMarketQuality: env.aggressiveMinMarketQuality,
    maxTradesPerDay: env.aggressiveMaxTradesPerDay,
    maxOpenPositions: env.aggressiveMaxOpenPositions,
    btcBypass: env.aggressiveAllowBtcFilterBypass,
    qualityBypass: env.aggressiveAllowMarketQualityBypass,
  };
}
