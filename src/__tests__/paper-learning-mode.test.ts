// Paper Learning Mode — helper + lesson engine regression suite.
//
// Focus:
//  • checkPaperLearningMode is HARD-DISABLED — active=false in every scenario,
//    even when env vars (PAPER_LEARNING_MODE=true, allow-bypass flags) say
//    otherwise. Closed-trade audit (May 2026) showed bypass entries produced
//    net-negative paper P&L; channel is closed in code so a stale VPS env
//    file cannot reopen it.
//  • All allow-bypass flags must read false; minSignalScore must surface as
//    the normal-mode floor (70).
//  • lesson-engine still exercises closed-trade post-mortem logic for
//    historical / future learning trades.
//  • summarizeByBypass produces win/loss aggregates

import { describe, it, expect, vi } from "vitest";
import {
  analyzeOutcome,
  generateLesson,
  summarizeByBypass,
  type ClosedTradeContext,
} from "@/lib/learning/lesson-engine";
import { checkPaperLearningMode } from "@/lib/paper-learning-mode";

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

describe("checkPaperLearningMode — hard-disabled (May 2026)", () => {
  it("inactive when PAPER_LEARNING_MODE=false (env default)", async () => {
    const fresh = await loadHelperWithEnv({ paperLearningMode: false });
    const r = fresh(baseSettings);
    expect(r.active).toBe(false);
    expect(r.inactiveReason).toMatch(/HARDDISABLED/);
  });

  it("STILL inactive even when env vars try to enable it", async () => {
    // Reproduces the prod misconfiguration that caused the audit incident:
    // a stale VPS env file with PAPER_LEARNING_MODE=true. Helper must
    // ignore the env var because the bypass channel is closed in code.
    const fresh = await loadHelperWithEnv({ paperLearningMode: true });
    const r = fresh(baseSettings);
    expect(r.active).toBe(false);
    expect(r.inactiveReason).toMatch(/HARDDISABLED/);
  });

  it("STILL inactive when both PAPER_LEARNING_MODE=true and trading_mode=paper (audit scenario)", async () => {
    const fresh = await loadHelperWithEnv({ paperLearningMode: true });
    const r = fresh({ ...baseSettings, trading_mode: "paper", enable_live_trading: false });
    expect(r.active).toBe(false);
  });

  it("inactive when trading_mode != paper", async () => {
    const fresh = await loadHelperWithEnv({ paperLearningMode: true });
    const r = fresh({ ...baseSettings, trading_mode: "live" });
    expect(r.active).toBe(false);
  });

  it("inactive when HARD_LIVE_TRADING_ALLOWED=true", async () => {
    const fresh = await loadHelperWithEnv({ paperLearningMode: true, hardLiveTradingAllowed: true });
    const r = fresh(baseSettings);
    expect(r.active).toBe(false);
  });

  it("all allow-bypass flags surface as false regardless of env", async () => {
    const fresh = await loadHelperWithEnv({ paperLearningMode: true });
    const r = fresh(baseSettings);
    expect(r.allowRiskBypass).toBe(false);
    expect(r.allowMarketQualityBypass).toBe(false);
    expect(r.allowBtcFilterBypass).toBe(false);
    expect(r.allowRrBypass).toBe(false);
    expect(r.autoSlTp).toBe(false);
  });

  it("minSignalScore is the normal-mode floor (70), never the env override", async () => {
    const fresh = await loadHelperWithEnv({ paperLearningMode: true });
    const r = fresh(baseSettings);
    expect(r.minSignalScore).toBe(70);
  });

  it("maxOpenPositions/maxTradesPerDay return zero (no learning batches allowed)", async () => {
    const fresh = await loadHelperWithEnv({ paperLearningMode: true });
    const r = fresh(baseSettings);
    expect(r.maxOpenPositions).toBe(0);
    expect(r.maxTradesPerDay).toBe(0);
  });

  it("statically — production export is hard-disabled (no env mock)", () => {
    // Reads through the live env file; verifies the helper returns inactive
    // even with whatever the deployed env says.
    const r = checkPaperLearningMode(baseSettings);
    expect(r.active).toBe(false);
    expect(r.inactiveReason).toMatch(/HARDDISABLED/);
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
