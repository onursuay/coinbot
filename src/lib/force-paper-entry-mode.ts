// Force Paper Entry Mode helper.
// Active ONLY when all five conditions hold simultaneously:
//   1. FORCE_PAPER_ENTRY_MODE=true
//   2. trading_mode === "paper"
//   3. enable_live_trading !== true
//   4. HARD_LIVE_TRADING_ALLOWED !== true
//   5. kill switch is NOT active
//
// When active, risk engine blocking, market quality gates, BTC filter,
// R:R minimum, and whitelist are bypassed for paper position insertion.
//
// Bypassed gates (paper-only, virtual — no real orders):
//   market quality score, ATR/funding/depth quality checks, BTC trend filter,
//   tier reject, risk engine rule violations (margin, spread, etc.), R:R minimum,
//   whitelist / tier membership, signal score threshold.
//
// Fatal gates that still apply regardless of this mode:
//   kill switch active, live trading indicators present, no entry price,
//   same symbol already has an open position (duplicate), position count ≥
//   FORCE_PAPER_MAX_OPEN_POSITIONS, daily trade count ≥
//   FORCE_PAPER_MAX_TRADES_PER_DAY, Supabase INSERT failure.

import { env } from "@/lib/env";

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

export function checkForcePaperEntryMode(settings: {
  trading_mode?: string | null;
  enable_live_trading?: boolean | null;
  kill_switch_active?: boolean | null;
}): ForcePaperCheck {
  const inactive = (reason: string): ForcePaperCheck => ({
    active: false,
    inactiveReason: reason,
    maxOpenPositions: 0,
    maxTradesPerDay: 0,
    minSignalScore: 1,
    allowRiskBypass: false,
    allowMarketQualityBypass: false,
    allowBtcFilterBypass: false,
    allowRrBypass: false,
  });

  if (!env.forcePaperEntryMode) return inactive("FORCE_PAPER_ENTRY_MODE=false");
  if (settings.trading_mode !== "paper") return inactive(`trading_mode=${settings.trading_mode ?? "unknown"} (paper gerekli)`);
  if (settings.enable_live_trading === true) return inactive("enable_live_trading=true");
  if (env.hardLiveTradingAllowed) return inactive("HARD_LIVE_TRADING_ALLOWED=true");
  if (settings.kill_switch_active === true) return inactive("kill_switch_active=true");

  return {
    active: true,
    inactiveReason: null,
    maxOpenPositions: env.forcePaperMaxOpenPositions,
    maxTradesPerDay: env.forcePaperMaxTradesPerDay,
    minSignalScore: env.forcePaperMinSignalScore,
    allowRiskBypass: env.forcePaperAllowRiskBypass,
    allowMarketQualityBypass: env.forcePaperAllowMarketQualityBypass,
    allowBtcFilterBypass: env.forcePaperAllowBtcFilterBypass,
    allowRrBypass: env.forcePaperAllowRrBypass,
  };
}
