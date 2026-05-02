// Paper Learning Mode — helper + lesson engine regression suite.
//
// Focus:
//  • checkPaperLearningMode activates only under safe paper-mode conditions
//  • lesson-engine outcome classification + bypass-warranted analysis
//  • lesson text contains the right tags depending on bypass + outcome combo
//  • summarizeByBypass produces win/loss aggregates

import { describe, it, expect, vi } from "vitest";
import {
  analyzeOutcome,
  generateLesson,
  summarizeByBypass,
  type ClosedTradeContext,
} from "@/lib/learning/lesson-engine";

const baseSettings = {
  trading_mode: "paper" as const,
  enable_live_trading: false,
  kill_switch_active: false,
};

// env is module-scoped; we mock it per scenario via vi.doMock + dynamic import.
async function loadHelperWithEnv(envOverrides: Partial<{ paperLearningMode: boolean; hardLiveTradingAllowed: boolean }>) {
  vi.resetModules();
  vi.doMock("@/lib/env", () => ({
    env: {
      paperLearningMode: envOverrides.paperLearningMode ?? false,
      paperLearningMaxOpenPositions: 20,
      paperLearningMaxTradesPerDay: 100,
      paperLearningMinSignalScore: 1,
      paperLearningAllowRiskBypass: true,
      paperLearningAllowMarketQualityBypass: true,
      paperLearningAllowBtcFilterBypass: true,
      paperLearningAllowRrBypass: true,
      paperLearningAutoSlTp: true,
      hardLiveTradingAllowed: envOverrides.hardLiveTradingAllowed ?? false,
    },
  }));
  const mod = await import("@/lib/paper-learning-mode");
  return mod.checkPaperLearningMode;
}

describe("checkPaperLearningMode — gating", () => {
  it("inactive when PAPER_LEARNING_MODE=false (default)", async () => {
    const fresh = await loadHelperWithEnv({ paperLearningMode: false });
    const r = fresh(baseSettings);
    expect(r.active).toBe(false);
    expect(r.inactiveReason).toContain("PAPER_LEARNING_MODE=false");
  });

  it("inactive when trading_mode != paper", async () => {
    const fresh = await loadHelperWithEnv({ paperLearningMode: true });
    const r = fresh({ ...baseSettings, trading_mode: "live" });
    expect(r.active).toBe(false);
    expect(r.inactiveReason).toContain("trading_mode=live");
  });

  it("inactive when enable_live_trading=true", async () => {
    const fresh = await loadHelperWithEnv({ paperLearningMode: true });
    const r = fresh({ ...baseSettings, enable_live_trading: true });
    expect(r.active).toBe(false);
    expect(r.inactiveReason).toContain("enable_live_trading=true");
  });

  it("inactive when HARD_LIVE_TRADING_ALLOWED=true", async () => {
    const fresh = await loadHelperWithEnv({ paperLearningMode: true, hardLiveTradingAllowed: true });
    const r = fresh(baseSettings);
    expect(r.active).toBe(false);
    expect(r.inactiveReason).toContain("HARD_LIVE_TRADING_ALLOWED");
  });

  it("inactive when kill switch is active", async () => {
    const fresh = await loadHelperWithEnv({ paperLearningMode: true });
    const r = fresh({ ...baseSettings, kill_switch_active: true });
    expect(r.active).toBe(false);
    expect(r.inactiveReason).toContain("kill_switch");
  });

  it("active under safe paper conditions", async () => {
    const fresh = await loadHelperWithEnv({ paperLearningMode: true });
    const r = fresh(baseSettings);
    expect(r.active).toBe(true);
    expect(r.minSignalScore).toBe(1);
    expect(r.maxOpenPositions).toBe(20);
    expect(r.maxTradesPerDay).toBe(100);
    expect(r.autoSlTp).toBe(true);
  });
});

describe("analyzeOutcome", () => {
  const baseCtx: ClosedTradeContext = {
    symbol: "FOO/USDT",
    direction: "LONG",
    pnl: 0,
    pnlPercent: 0,
    exitReason: "stop_loss",
    hoursOpen: 1,
    bypassedRiskGates: [],
  };

  it("pnl>0 → win", () => {
    const r = analyzeOutcome({ ...baseCtx, pnl: 5, pnlPercent: 1 });
    expect(r.outcome).toBe("win");
  });

  it("pnl<0 → loss + riskWarrantedFlag when bypass present", () => {
    const r = analyzeOutcome({
      ...baseCtx,
      pnl: -8,
      pnlPercent: -2,
      bypassedRiskGates: ["btc_filter_bypass"],
    });
    expect(r.outcome).toBe("loss");
    expect(r.riskWarrantedFlag).toBe(true);
    expect(r.notes).toContain("bypass_warranted: 1 gate bypass edildi, işlem zarar etti");
  });

  it("pnl<0 with no bypass → loss but riskWarrantedFlag stays false", () => {
    const r = analyzeOutcome({ ...baseCtx, pnl: -3 });
    expect(r.outcome).toBe("loss");
    expect(r.riskWarrantedFlag).toBe(false);
  });

  it("pnl=0 → breakeven", () => {
    const r = analyzeOutcome({ ...baseCtx, pnl: 0 });
    expect(r.outcome).toBe("breakeven");
  });

  it("pnl=null → breakeven", () => {
    const r = analyzeOutcome({ ...baseCtx, pnl: null });
    expect(r.outcome).toBe("breakeven");
  });
});

describe("generateLesson — Turkish text + tags by outcome × bypass combo", () => {
  const baseCtx: ClosedTradeContext = {
    symbol: "FOO/USDT",
    direction: "LONG",
    pnl: 5,
    pnlPercent: 1.2,
    exitReason: "take_profit",
    hoursOpen: 2,
    bypassedRiskGates: [],
  };

  it("WIN + market_quality_bypass → market_quality + win tags", () => {
    const lesson = generateLesson({
      ...baseCtx,
      bypassedRiskGates: ["market_quality_bypass"],
    });
    expect(lesson.tags).toContain("market_quality");
    expect(lesson.tags).toContain("win");
    expect(lesson.text).toContain("market quality");
  });

  it("LOSS + btc_filter_bypass → btc_filter + loss tags", () => {
    const lesson = generateLesson({
      ...baseCtx,
      pnl: -10,
      pnlPercent: -2.5,
      exitReason: "stop_loss",
      bypassedRiskGates: ["btc_filter_bypass"],
    });
    expect(lesson.tags).toContain("btc_filter");
    expect(lesson.tags).toContain("loss");
    expect(lesson.text).toContain("BTC");
  });

  it("breakeven → 'breakeven' tag", () => {
    const lesson = generateLesson({ ...baseCtx, pnl: 0, pnlPercent: 0 });
    expect(lesson.tags).toContain("breakeven");
  });

  it("generatedFallbackSlTp → fallback_sl_tp tag added", () => {
    const lesson = generateLesson({ ...baseCtx, generatedFallbackSlTp: true });
    expect(lesson.tags).toContain("fallback_sl_tp");
  });

  it("never throws on missing fields", () => {
    expect(() =>
      generateLesson({
        symbol: "X",
        direction: "SHORT",
        pnl: null,
        pnlPercent: null,
        exitReason: null,
        hoursOpen: null,
      } as ClosedTradeContext),
    ).not.toThrow();
  });
});

describe("summarizeByBypass", () => {
  it("aggregates win/loss per bypass key", () => {
    const stats = summarizeByBypass([
      { bypassedRiskGates: ["btc_filter_bypass"], outcome: "win" },
      { bypassedRiskGates: ["btc_filter_bypass"], outcome: "loss" },
      { bypassedRiskGates: ["btc_filter_bypass"], outcome: "loss" },
      { bypassedRiskGates: ["market_quality_bypass"], outcome: "win" },
      { bypassedRiskGates: ["market_quality_bypass"], outcome: "win" },
    ]);
    const btc = stats.find((s) => s.bypass === "btc_filter_bypass");
    const mq = stats.find((s) => s.bypass === "market_quality_bypass");
    expect(btc).toBeTruthy();
    expect(btc!.total).toBe(3);
    expect(btc!.wins).toBe(1);
    expect(btc!.losses).toBe(2);
    expect(btc!.winRate).toBeCloseTo(1 / 3, 5);
    expect(mq!.winRate).toBe(1);
  });

  it("returns empty array for no records", () => {
    expect(summarizeByBypass([])).toEqual([]);
  });

  it("ignores breakeven for winRate denominator", () => {
    const stats = summarizeByBypass([
      { bypassedRiskGates: ["risk:foo"], outcome: "win" },
      { bypassedRiskGates: ["risk:foo"], outcome: "breakeven" },
      { bypassedRiskGates: ["risk:foo"], outcome: "loss" },
    ]);
    const r = stats[0];
    expect(r.total).toBe(3);
    expect(r.winRate).toBe(0.5);  // 1 win / (1 win + 1 loss); breakeven excluded
  });
});

describe("PAPER_LEARNING_MODE invariants", () => {
  it("does not export any live-trading helper", async () => {
    const mod = await import("@/lib/paper-learning-mode");
    const keys = Object.keys(mod);
    expect(keys).not.toContain("openLiveOrder");
    expect(keys).not.toContain("setLeverage");
  });
});
