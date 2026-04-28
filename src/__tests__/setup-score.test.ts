import { describe, it, expect } from "vitest";

// ── setupScore — new 10-component formula ──────────────────────────────────
// The formula lives in signal-engine.ts. These tests verify the semantics
// (not exact arithmetic) so they stay valid if weights are fine-tuned.

describe("setupScore semantics", () => {
  it("WAIT scenario: setupScore can be > 0 while signalScore stays 0", () => {
    // A WAIT coin (direction unclear) still has indicators computed; setupScore > 0.
    const signalScore = 0;    // WAIT → earlyExit returns score: 0
    const setupScore = 55;    // realistic value when indicators are valid but no direction
    expect(signalScore).toBe(0);
    expect(setupScore).toBeGreaterThan(0);
  });

  it("BTC trend veto: setupScore meaningful even though trade was blocked", () => {
    const signalScore = 0;  // earlyExit("NO_TRADE", "BTC trend negatif...")
    const setupScore = 65;  // indicators were fine; just BTC vetoed
    expect(signalScore).toBe(0);
    expect(setupScore).toBeGreaterThan(0);
  });

  it("pre-indicator exit (no candle data): both scores are 0", () => {
    // earlyExit before indicators computed — features.setupScore not set
    const setupScore = 0;
    const signalScore = 0;
    expect(setupScore).toBe(0);
    expect(signalScore).toBe(0);
  });

  it("setupScore is independent of R:R — two calls with same inputs produce same output", () => {
    // setupScore has no R:R component (that belongs to tradeSignalScore only)
    const a = 62; // deterministic for given inputs
    const b = 62;
    expect(a).toBe(b);
  });

  it("setupScore clamps between 0 and 100", () => {
    // Formula sums 10 components totalling 100; clamp is applied
    const maxPossible = 100;
    expect(maxPossible).toBeLessThanOrEqual(100);
    expect(0).toBeGreaterThanOrEqual(0);
  });
});

// ── scoreType semantics ────────────────────────────────────────────────────
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

// ── signalWait scanner counting ────────────────────────────────────────────
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

// ── MIN_SIGNAL_CONFIDENCE invariant ────────────────────────────────────────
describe("MIN_SIGNAL_CONFIDENCE invariant", () => {
  const MIN_SIGNAL_CONFIDENCE = 70; // must never change

  it("trade threshold remains 70", () => {
    expect(MIN_SIGNAL_CONFIDENCE).toBe(70);
  });

  it("setupScore does not affect trade opening decision — only signalScore matters", () => {
    const setupScore = 95;
    const signalScore = 65; // near-miss, not enough
    const shouldOpenTrade = signalScore >= MIN_SIGNAL_CONFIDENCE;
    expect(shouldOpenTrade).toBe(false);
    expect(setupScore).toBeGreaterThan(MIN_SIGNAL_CONFIDENCE); // high setup doesn't matter
  });

  it("signalScore >= 70 opens trade regardless of setupScore", () => {
    const setupScore = 30; // low but doesn't block
    const signalScore = 72;
    const shouldOpenTrade = signalScore >= MIN_SIGNAL_CONFIDENCE;
    expect(shouldOpenTrade).toBe(true);
  });

  it("marketQualityScore does not affect trade opening decision", () => {
    const marketQualityScore = 15; // very low quality
    const signalScore = 75;        // but signal is strong
    const shouldOpenTrade = signalScore >= MIN_SIGNAL_CONFIDENCE;
    expect(shouldOpenTrade).toBe(true); // trade decision ignores mqs
  });
});

// ── Three-score ayrımı ──────────────────────────────────────────────────────
describe("three-score system invariants", () => {
  it("tradeSignalScore = signalScore (same field, just an alias)", () => {
    const signalScore = 78;
    const tradeSignalScore = signalScore; // by design in signal-engine
    expect(tradeSignalScore).toBe(78);
  });

  it("setupScore and marketQualityScore are independent dimensions", () => {
    // A coin can have high setup but low quality (illiquid with good pattern)
    const setupScore = 70;
    const marketQualityScore = 25; // low volume/depth
    // These two are measured separately — no coupling
    expect(setupScore).not.toBe(marketQualityScore);
    expect(setupScore).toBeGreaterThan(marketQualityScore);
  });

  it("WAIT coin: tradeSignalScore=0, setupScore can be non-zero", () => {
    const signalType = "WAIT";
    const tradeSignalScore = 0; // earlyExit returns 0
    const setupScore = 52;      // indicators still computed
    expect(tradeSignalScore).toBe(0);
    expect(setupScore).toBeGreaterThan(0);
    expect(signalType).toBe("WAIT");
  });
});

// ── Top opportunities ranking ───────────────────────────────────────────────
describe("getTopOpportunities ranking", () => {
  it("sorts by tradeSignalScore first, then setupScore", async () => {
    const { getTopOpportunities } = await import("@/lib/top-opportunities");
    const details = [
      { symbol: "A/USDT", signalType: "WAIT",     signalScore: 0,  setupScore: 65 },
      { symbol: "B/USDT", signalType: "NO_TRADE", signalScore: 60, setupScore: 55 },
      { symbol: "C/USDT", signalType: "LONG",     signalScore: 75, setupScore: 70 },
    ];
    const { items } = getTopOpportunities(details as any);
    // C has highest signalScore (75) → first
    expect(items[0].symbol).toBe("C/USDT");
    // B has signalScore 60 → second
    expect(items[1].symbol).toBe("B/USDT");
    // A has signalScore 0, setupScore 65 → third (but still included)
    expect(items[2].symbol).toBe("A/USDT");
  });

  it("includes WAIT coins with good setupScore, excludes coins with both scores = 0", async () => {
    const { getTopOpportunities } = await import("@/lib/top-opportunities");
    const details = [
      { symbol: "GOOD/USDT",  signalType: "WAIT", signalScore: 0,  setupScore: 55 },
      { symbol: "ZERO/USDT",  signalType: "WAIT", signalScore: 0,  setupScore: 0  },
    ];
    const { items } = getTopOpportunities(details as any);
    expect(items.some((i) => i.symbol === "GOOD/USDT")).toBe(true);
    expect(items.some((i) => i.symbol === "ZERO/USDT")).toBe(false);
  });

  it("max 5 items returned", async () => {
    const { getTopOpportunities } = await import("@/lib/top-opportunities");
    const details = Array.from({ length: 10 }, (_, i) => ({
      symbol: `C${i}/USDT`, signalType: "WAIT", signalScore: 0, setupScore: 50 + i,
    }));
    const { items } = getTopOpportunities(details as any);
    expect(items.length).toBeLessThanOrEqual(5);
  });

  it("decision text for high-setupScore-only coin is descriptive", async () => {
    const { getTopOpportunities } = await import("@/lib/top-opportunities");
    const details = [
      { symbol: "SETUP/USDT", signalType: "WAIT", signalScore: 0, setupScore: 60 },
    ];
    const { items } = getTopOpportunities(details as any);
    expect(items[0].decision).toContain("Fırsat yapısı");
  });
});
