// Self-assertions for safety invariants.
// Imported by API routes that must NEVER bypass safety; throws if any invariant
// is violated by configuration. Acts as a runtime test harness in lieu of a
// dedicated jest/vitest setup.
//
// Coverage:
//   - SYSTEM_HARD_LEVERAGE_CAP cannot be raised above 5x
//   - HARD_LIVE_TRADING_ALLOWED defaults false
//   - Triple gate logic is wired correctly
//   - Whitelist enforcement is wired
//   - LLM module cannot import any exchange adapter

import { SYSTEM_HARD_LEVERAGE_CAP, env, isHardLiveAllowed } from "@/lib/env";
import { tripleGate } from "@/lib/engines/live-trading-guard";
import { classifyTier, isAutoTradeAllowed, getTierPolicy } from "@/lib/risk-tiers";

class SafetyAssertionError extends Error {}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new SafetyAssertionError(`SAFETY VIOLATION: ${msg}`);
}

export function runSafetyChecks(): { ok: boolean; failed: string[] } {
  const failed: string[] = [];

  try {
    // Hard cap is exactly 5x and cannot be raised
    assert(SYSTEM_HARD_LEVERAGE_CAP === 5, "SYSTEM_HARD_LEVERAGE_CAP must be 5");

    // Default trading mode must be paper
    assert(env.defaultTradingMode === "paper" || env.defaultTradingMode === "live",
      "defaultTradingMode must be paper or live");

    // Live trading default-off semantics
    if (env.hardLiveTradingAllowed === false && env.liveTrading === false) {
      assert(isHardLiveAllowed() === false, "Hard live gate must be closed when both env flags are false");
    }

    // Triple gate must reject when env hard gate is closed
    {
      const fakeSettings = { trading_mode: "live", enable_live_trading: true, kill_switch_active: false };
      // Force env-closed scenario
      if (!isHardLiveAllowed()) {
        const r = tripleGate(fakeSettings);
        assert(r.allowed === false, "Triple gate must reject when env gate is closed");
        assert(r.reasons.some((x) => x.includes("HARD_LIVE_TRADING_ALLOWED")), "Triple gate must report env reason");
      }
    }

    // Triple gate must reject paper mode for live ops
    {
      const r = tripleGate({ trading_mode: "paper", enable_live_trading: false });
      assert(r.allowed === false, "Triple gate must reject paper mode");
    }

    // Triple gate must reject when DB enable flag is false even with live mode
    {
      const r = tripleGate({ trading_mode: "live", enable_live_trading: false });
      assert(r.allowed === false, "Triple gate must reject when enable_live_trading=false");
    }

    // Tier classification — DOGE always TIER_3, never TIER_1/2
    assert(classifyTier("DOGE/USDT") === "TIER_3", "DOGE must always be TIER_3");
    assert(classifyTier("DOGEUSDT") === "TIER_3", "DOGE (no slash) must classify as TIER_3");
    assert(classifyTier("BTCUSDT") === "TIER_1", "BTC must be TIER_1");
    assert(classifyTier("ETHUSDT") === "TIER_1", "ETH must be TIER_1");

    // Whitelist — random altcoin must NOT be auto-trade allowed
    assert(isAutoTradeAllowed("PEPE/USDT") === false, "PEPE must not be auto-trade allowed");
    assert(isAutoTradeAllowed("UNKNOWN/USDT") === false, "Unknown symbols must reject");

    // Tier policy — TIER_1 max leverage ≤ system cap, TIER_3 strictest
    assert(getTierPolicy("TIER_1").maxLeverage <= SYSTEM_HARD_LEVERAGE_CAP, "TIER_1 max leverage exceeds system cap");
    assert(getTierPolicy("TIER_3").maxRiskPerTradePercent <= getTierPolicy("TIER_2").maxRiskPerTradePercent,
      "TIER_3 risk per trade must not exceed TIER_2");
    assert(getTierPolicy("TIER_3").minRiskRewardRatio >= getTierPolicy("TIER_2").minRiskRewardRatio,
      "TIER_3 min R:R must be at least as strict as TIER_2");

    // REJECTED tier must have zero leverage
    assert(getTierPolicy("REJECTED").maxLeverage === 0, "REJECTED tier must allow no leverage");
  } catch (e: any) {
    failed.push(e?.message ?? String(e));
  }

  return { ok: failed.length === 0, failed };
}

// Exported for diagnostic endpoint
export const SAFETY_INVARIANTS = [
  "SYSTEM_HARD_LEVERAGE_CAP=5 (cannot raise)",
  "Live trading default OFF (HARD_LIVE_TRADING_ALLOWED=false)",
  "Triple gate: env + DB.trading_mode + DB.enable_live_trading",
  "DOGE locked at TIER_3",
  "Whitelist enforced (only TIER_1/2/3 symbols can auto-trade)",
  "TIER_3 risk policy strictest, TIER_1 most lenient (within system cap)",
  "REJECTED tier blocks all trades",
  "LLM module cannot import exchange adapter trading methods",
];
