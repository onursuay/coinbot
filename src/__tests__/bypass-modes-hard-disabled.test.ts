// Bypass modes hard-disabled (May 2026).
//
// Closed-trade audit showed every recent paper trade had paper_learning_mode=
// true with bypassed_gates ⊃ {risk, market_quality_bypass, btc_filter_bypass}.
// Per user mandate the three bypass channels are closed in code:
//   • paper-learning-mode.ts
//   • force-paper-entry-mode.ts
//   • aggressive-paper-mode.ts
// Their `check*` helpers must return active=false in every scenario, even
// when the env vars (PAPER_LEARNING_MODE / FORCE_PAPER_ENTRY_MODE /
// AGGRESSIVE_PAPER_TEST_MODE) are set to true. This file pins that contract
// against accidental regression.
//
// Live execution stays untouched — these are paper-only bypass toggles.

import { describe, it, expect, vi } from "vitest";

const baseSettings = {
  trading_mode: "paper" as const,
  enable_live_trading: false,
  kill_switch_active: false,
};

async function loadWithEnv(envOverrides: Record<string, unknown>) {
  vi.resetModules();
  vi.doMock("@/lib/env", () => ({
    env: {
      // Paper Learning
      paperLearningMode: true,
      paperLearningMaxOpenPositions: 20,
      paperLearningMaxTradesPerDay: 100,
      paperLearningMinSignalScore: 1,
      paperLearningAllowRiskBypass: true,
      paperLearningAllowMarketQualityBypass: true,
      paperLearningAllowBtcFilterBypass: true,
      paperLearningAllowRrBypass: true,
      paperLearningAutoSlTp: true,
      // Force Paper Entry
      forcePaperEntryMode: true,
      forcePaperMaxOpenPositions: 20,
      forcePaperMaxTradesPerDay: 50,
      forcePaperMinSignalScore: 1,
      forcePaperAllowRiskBypass: true,
      forcePaperAllowMarketQualityBypass: true,
      forcePaperAllowBtcFilterBypass: true,
      forcePaperAllowRrBypass: true,
      // Aggressive Paper Test
      aggressivePaperTestMode: true,
      aggressiveMinSignalScore: 45,
      aggressiveMinMarketQuality: 25,
      aggressiveMaxTradesPerDay: 20,
      aggressiveMaxOpenPositions: 5,
      aggressiveAllowBtcFilterBypass: true,
      aggressiveAllowMarketQualityBypass: true,
      // Hard live indicators stay safely off
      hardLiveTradingAllowed: false,
      ...envOverrides,
    },
  }));
  const [pl, fp, agg] = await Promise.all([
    import("@/lib/paper-learning-mode"),
    import("@/lib/force-paper-entry-mode"),
    import("@/lib/aggressive-paper-mode"),
  ]);
  return {
    checkPaperLearning: pl.checkPaperLearningMode,
    checkForcePaper: fp.checkForcePaperEntryMode,
    checkAggressive: agg.checkAggressivePaperMode,
  };
}

describe("paper-learning-mode helper — hard-disabled", () => {
  it("returns active=false even when env enables it + safe paper settings", async () => {
    const { checkPaperLearning } = await loadWithEnv({});
    const r = checkPaperLearning(baseSettings);
    expect(r.active).toBe(false);
    expect(r.inactiveReason).toMatch(/HARDDISABLED/);
  });

  it("all allow-bypass flags are false", async () => {
    const { checkPaperLearning } = await loadWithEnv({});
    const r = checkPaperLearning(baseSettings);
    expect(r.allowRiskBypass).toBe(false);
    expect(r.allowMarketQualityBypass).toBe(false);
    expect(r.allowBtcFilterBypass).toBe(false);
    expect(r.allowRrBypass).toBe(false);
    expect(r.autoSlTp).toBe(false);
  });

  it("minSignalScore = 70 (normal floor, no env override)", async () => {
    const { checkPaperLearning } = await loadWithEnv({});
    expect(checkPaperLearning(baseSettings).minSignalScore).toBe(70);
  });
});

describe("force-paper-entry-mode helper — hard-disabled", () => {
  it("returns active=false even with FORCE_PAPER_ENTRY_MODE=true + safe paper", async () => {
    const { checkForcePaper } = await loadWithEnv({});
    const r = checkForcePaper(baseSettings);
    expect(r.active).toBe(false);
    expect(r.inactiveReason).toMatch(/HARDDISABLED/);
  });

  it("all allow-bypass flags are false", async () => {
    const { checkForcePaper } = await loadWithEnv({});
    const r = checkForcePaper(baseSettings);
    expect(r.allowRiskBypass).toBe(false);
    expect(r.allowMarketQualityBypass).toBe(false);
    expect(r.allowBtcFilterBypass).toBe(false);
    expect(r.allowRrBypass).toBe(false);
  });

  it("minSignalScore = 70 (normal floor)", async () => {
    const { checkForcePaper } = await loadWithEnv({});
    expect(checkForcePaper(baseSettings).minSignalScore).toBe(70);
  });
});

describe("aggressive-paper-mode helper — hard-disabled", () => {
  it("returns active=false even with AGGRESSIVE_PAPER_TEST_MODE=true + safe paper", async () => {
    const { checkAggressive } = await loadWithEnv({});
    const r = checkAggressive(baseSettings);
    expect(r.active).toBe(false);
    expect(r.reason).toMatch(/HARDDISABLED/);
  });

  it("btcBypass and qualityBypass are false", async () => {
    const { checkAggressive } = await loadWithEnv({});
    const r = checkAggressive(baseSettings);
    expect(r.btcBypass).toBe(false);
    expect(r.qualityBypass).toBe(false);
  });

  it("minSignalScore = 70 (no aggressive override)", async () => {
    const { checkAggressive } = await loadWithEnv({});
    expect(checkAggressive(baseSettings).minSignalScore).toBe(70);
  });
});

describe("safety invariants — bypass helpers cannot reopen via any flag combo", () => {
  it("paper-learning stays inactive across every env permutation", async () => {
    const cases = [
      { paperLearningMode: true, hardLiveTradingAllowed: false },
      { paperLearningMode: true, hardLiveTradingAllowed: true },
      { paperLearningMode: false, hardLiveTradingAllowed: false },
    ];
    for (const c of cases) {
      const { checkPaperLearning } = await loadWithEnv(c);
      expect(checkPaperLearning(baseSettings).active).toBe(false);
    }
  });

  it("force-paper stays inactive across every env permutation", async () => {
    const cases = [
      { forcePaperEntryMode: true, hardLiveTradingAllowed: false },
      { forcePaperEntryMode: true, hardLiveTradingAllowed: true },
      { forcePaperEntryMode: false, hardLiveTradingAllowed: false },
    ];
    for (const c of cases) {
      const { checkForcePaper } = await loadWithEnv(c);
      expect(checkForcePaper(baseSettings).active).toBe(false);
    }
  });

  it("aggressive stays inactive across every env permutation", async () => {
    const cases = [
      { aggressivePaperTestMode: true, hardLiveTradingAllowed: false },
      { aggressivePaperTestMode: true, hardLiveTradingAllowed: true },
      { aggressivePaperTestMode: false, hardLiveTradingAllowed: false },
    ];
    for (const c of cases) {
      const { checkAggressive } = await loadWithEnv(c);
      expect(checkAggressive(baseSettings).active).toBe(false);
    }
  });
});
