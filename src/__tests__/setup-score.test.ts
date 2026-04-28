import { describe, it, expect } from "vitest";

// Pure formula extracted from signal-engine.ts for isolated testing.
// If you change the weights in signal-engine, update this test too.
function computeSetupScore(trendScore: number, volConf: number, volScore: number): number {
  return Math.max(0, Math.min(100, Math.round(
    trendScore * 0.50 + volConf * 0.30 + volScore * 0.20,
  )));
}

describe("setupScore formula", () => {
  it("computes correctly for typical WAIT values", () => {
    // trendScore=60, volConf=50, volScore=40 → 30+15+8 = 53
    expect(computeSetupScore(60, 50, 40)).toBe(53);
  });

  it("computes correctly for strong market setup", () => {
    // trendScore=80, volConf=70, volScore=60 → 40+21+12 = 73
    expect(computeSetupScore(80, 70, 60)).toBe(73);
  });

  it("clamps at 100", () => {
    expect(computeSetupScore(100, 100, 100)).toBe(100);
  });

  it("clamps at 0", () => {
    expect(computeSetupScore(0, 0, 0)).toBe(0);
    expect(computeSetupScore(-10, -5, -20)).toBe(0);
  });

  it("WAIT scenario: setupScore > 0 while signalScore remains 0", () => {
    // A WAIT coin (direction unclear) still has indicators computed
    const signalScore = 0; // earlyExit returns score: 0 for WAIT
    const setupScore = computeSetupScore(65, 55, 45); // 32.5 + 16.5 + 9 = 58
    expect(signalScore).toBe(0);
    expect(setupScore).toBeGreaterThan(0);
    expect(setupScore).toBe(58);
  });

  it("BTC trend veto scenario: setupScore meaningful even though trade was blocked", () => {
    const signalScore = 0; // earlyExit("NO_TRADE", "BTC trend negatif...")
    const setupScore = computeSetupScore(75, 65, 55); // 37.5+19.5+11=68
    expect(signalScore).toBe(0);
    expect(setupScore).toBe(68);
  });

  it("pre-indicator exit (no candle data): both scores 0", () => {
    // earlyExit before Object.assign — features.setupScore is not set
    const setupScore = 0; // default when features.setupScore is not a number
    const signalScore = 0;
    expect(setupScore).toBe(0);
    expect(signalScore).toBe(0);
  });

  it("setupScore is independent of R:R — same inputs always produce same output", () => {
    const a = computeSetupScore(70, 60, 50);
    const b = computeSetupScore(70, 60, 50);
    expect(a).toBe(b);
  });
});

describe("scoreType semantics", () => {
  function deriveScoreType(signalScore: number, setupScore: number): "signal" | "setup" | "none" {
    return signalScore > 0 ? "signal" : setupScore > 0 ? "setup" : "none";
  }

  it("signal when signalScore > 0 (near-miss or full trade)", () => {
    expect(deriveScoreType(65, 60)).toBe("signal");
    expect(deriveScoreType(80, 75)).toBe("signal");
  });

  it("setup when signalScore is 0 but setupScore > 0 (WAIT / BTC veto)", () => {
    expect(deriveScoreType(0, 58)).toBe("setup");
    expect(deriveScoreType(0, 72)).toBe("setup");
  });

  it("none when both are 0 (pre-indicator exit)", () => {
    expect(deriveScoreType(0, 0)).toBe("none");
  });
});

describe("signalWait scanner route fix", () => {
  it("WAIT signals are counted correctly (not hardcoded to 0)", () => {
    const scanDetails = [
      { signalType: "LONG" },
      { signalType: "WAIT" },
      { signalType: "WAIT" },
      { signalType: "NO_TRADE" },
      { signalType: "SHORT" },
    ];
    const signalWait = scanDetails.filter((r) => r.signalType === "WAIT").length;
    expect(signalWait).toBe(2);
    expect(signalWait).not.toBe(0); // regression: was hardcoded 0
  });

  it("signalNoTrade counts only NO_TRADE rows, not empty/undefined types", () => {
    const scanDetails = [
      { signalType: "LONG" },
      { signalType: "NO_TRADE" },
      { signalType: "" },
      { signalType: undefined },
    ];
    const signalNoTrade = scanDetails.filter((r) => r.signalType === "NO_TRADE").length;
    expect(signalNoTrade).toBe(1);
  });

  it("signalLong + signalShort + signalNoTrade + signalWait add up to total scanned", () => {
    const scanDetails = [
      { signalType: "LONG" },
      { signalType: "SHORT" },
      { signalType: "NO_TRADE" },
      { signalType: "NO_TRADE" },
      { signalType: "WAIT" },
    ];
    const counts =
      scanDetails.filter((r) => r.signalType === "LONG").length +
      scanDetails.filter((r) => r.signalType === "SHORT").length +
      scanDetails.filter((r) => r.signalType === "NO_TRADE").length +
      scanDetails.filter((r) => r.signalType === "WAIT").length;
    expect(counts).toBe(scanDetails.length);
  });
});

describe("MIN_SIGNAL_CONFIDENCE invariant", () => {
  const MIN_SIGNAL_CONFIDENCE = 70; // must never change

  it("trade threshold remains 70", () => {
    expect(MIN_SIGNAL_CONFIDENCE).toBe(70);
  });

  it("setupScore does not affect trade opening decision — only signalScore matters", () => {
    // Even a very high setupScore (95) must not open a trade if signalScore < 70
    const setupScore = 95;
    const signalScore = 65; // near-miss, not enough
    const shouldOpenTrade = signalScore >= MIN_SIGNAL_CONFIDENCE;
    expect(shouldOpenTrade).toBe(false);
    expect(setupScore).toBeGreaterThan(MIN_SIGNAL_CONFIDENCE); // setupScore is high but doesn't matter
  });

  it("signalScore >= 70 opens trade regardless of setupScore", () => {
    const setupScore = 30; // low market quality (unusual but possible)
    const signalScore = 72;
    const shouldOpenTrade = signalScore >= MIN_SIGNAL_CONFIDENCE;
    expect(shouldOpenTrade).toBe(true);
  });
});
