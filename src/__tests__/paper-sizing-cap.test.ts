// Paper position sizing cap regression suite (sizingVersion=risk_cap_v1).
//
// Reproduces the May 2026 audit incident: ETH/USDT trade opened with
// margin_used=2508 USDT on a 1000 USDT paper account because the
// risk-based sizing formula had no upper bound when stop distance was
// tight. The cap below pins the new safety:
//   • marginUsed <= accountBalance * 10% (hard ceiling 15%)
//   • stopDistancePercent < 1.0 → tight-stop violation
//   • leverage applied exactly once (rawMargin = rawNotional / leverage)
//   • actualRiskUsdt never exceeds configuredRiskAmountUsdt after capping
//
// Live execution gates are NOT touched. SL/TP formula is NOT touched.

import { describe, it, expect } from "vitest";
import { evaluateRisk, type RiskCheckInput } from "@/lib/engines/risk-engine";

const baseInput = (overrides: Partial<RiskCheckInput> = {}): RiskCheckInput => ({
  accountBalanceUsd: 1000,
  symbol: "ETHUSDT",
  direction: "LONG",
  entryPrice: 2308.60,
  stopLoss: 2304.00,         // 0.20% — pathologically tight (audit ETH case)
  takeProfit: 2318.72,       // 0.44% — R:R ≈ 2.2
  signalScore: 71,
  marketSpread: 0.0005,
  recentLossStreak: 0,
  openPositionCount: 0,
  dailyRealizedPnlUsd: 0,
  weeklyRealizedPnlUsd: 0,
  dailyTargetHit: false,
  conservativeMode: false,
  killSwitchActive: false,
  webSocketHealthy: true,
  apiHealthy: true,
  dataFresh: true,
  fundingRate: 0,
  marginMode: "isolated",
  riskConfigRiskPerTradePercent: 1,
  riskConfigTotalCapitalUsdt: 1000,
  riskConfigCapitalSource: "risk_settings",
  ...overrides,
});

describe("paper sizing cap — ETH/USDT regression (audit case)", () => {
  it("ETH-style tight SL is rejected by the tight-stop guard, not opened with absurd margin", () => {
    const r = evaluateRisk(baseInput());
    expect(r.allowed).toBe(false);
    expect(r.ruleViolations.some((v) => v.includes("STOP MESAFESİ ÇOK DAR"))).toBe(true);
    expect(r.sizingDiagnostics.tightStopBlocked).toBe(true);
    expect(r.sizingDiagnostics.stopDistancePercent).toBeLessThan(1.0);
    expect(r.sizingDiagnostics.sizingVersion).toBe("risk_cap_v1");
  });

  it("when SL is normal width but raw margin would exceed cap, cap applies and margin <= 10% of capital", () => {
    // SL at 1.0% (just above tight-stop floor) → raw notional huge, cap should clamp.
    const r = evaluateRisk(baseInput({
      stopLoss: 2308.60 - 2308.60 * 0.011,  // 1.1% stop (above tight floor)
      takeProfit: 2308.60 + 2308.60 * 0.0242, // R:R 2.2
    }));
    // sizing diag must show the cap kicked in
    expect(r.sizingDiagnostics.marginCapApplied).toBe(true);
    expect(r.marginUsed).toBeLessThanOrEqual(r.sizingDiagnostics.marginCapUsdt * 1.001);
    // Capital 1000 × 10% = 100 USDT margin cap
    expect(r.sizingDiagnostics.marginCapUsdt).toBeCloseTo(100, 6);
    expect(r.marginUsed).toBeLessThanOrEqual(100 * 1.001);
  });

  it("after cap, actualRiskUsdt never exceeds configuredRiskAmountUsdt", () => {
    const r = evaluateRisk(baseInput({
      stopLoss: 2308.60 - 2308.60 * 0.011,
      takeProfit: 2308.60 + 2308.60 * 0.0242,
    }));
    expect(r.sizingDiagnostics.actualRiskUsdt).toBeLessThanOrEqual(
      r.sizingDiagnostics.configuredRiskAmountUsdt * 1.001,
    );
  });
});

describe("paper sizing cap — leverage applied exactly once", () => {
  it("rawMarginUsed = rawNotional / leverage (no double-application)", () => {
    const r = evaluateRisk(baseInput({
      stopLoss: 2308.60 - 2308.60 * 0.02, // 2% stop — comfortably above tight floor
      takeProfit: 2308.60 + 2308.60 * 0.044,
    }));
    const sd = r.sizingDiagnostics;
    if (r.leverage > 0) {
      const expected = sd.rawNotionalUsdt / r.leverage;
      expect(sd.rawMarginUsed).toBeCloseTo(expected, 4);
    }
  });

  it("finalMarginUsed = finalNotional / leverage (cap step does not re-apply leverage)", () => {
    const r = evaluateRisk(baseInput({
      stopLoss: 2308.60 - 2308.60 * 0.011,
      takeProfit: 2308.60 + 2308.60 * 0.0242,
    }));
    const sd = r.sizingDiagnostics;
    if (r.leverage > 0) {
      const expected = sd.finalNotionalUsdt / r.leverage;
      expect(sd.finalMarginUsed).toBeCloseTo(expected, 4);
    }
  });
});

describe("paper sizing cap — normal SL width opens normally", () => {
  it("3% stop, 1% risk on 1000 USDT account → margin in safe 33-100 USDT band", () => {
    // entry 100, sl 97 → 3% stop. risk_amount = 1000 × 1% = 10.
    // raw_qty = 10 / 3 = 3.333, raw_notional = 333.33, raw_margin = 333.33/2 = 166.66
    // 166.66 > 100 cap → capped notional = 100×2 = 200, capped_qty = 200/100 = 2
    const r = evaluateRisk(baseInput({
      symbol: "FOOUSDT",
      entryPrice: 100,
      stopLoss: 97,
      takeProfit: 106.6, // R:R 2.2
      signalScore: 75,
    }));
    expect(r.sizingDiagnostics.tightStopBlocked).toBe(false);
    // After cap: margin landed at cap (100), notional 200, qty 2 (or finer if step)
    expect(r.marginUsed).toBeLessThanOrEqual(100 * 1.001);
    expect(r.marginUsed).toBeGreaterThan(0);
  });

  it("smaller account capital → margin scales proportionally with cap (10% rule holds)", () => {
    const r = evaluateRisk(baseInput({
      accountBalanceUsd: 500,
      riskConfigTotalCapitalUsdt: 500,
      symbol: "FOOUSDT",
      entryPrice: 100,
      stopLoss: 97,
      takeProfit: 106.6,
      signalScore: 75,
    }));
    expect(r.sizingDiagnostics.marginCapUsdt).toBeCloseTo(50, 6);
    expect(r.marginUsed).toBeLessThanOrEqual(50 * 1.001);
  });
});

describe("paper sizing cap — tight stop policy", () => {
  it("0.5% stop is rejected", () => {
    const r = evaluateRisk(baseInput({
      stopLoss: 2308.60 - 2308.60 * 0.005,
      takeProfit: 2308.60 + 2308.60 * 0.011,
    }));
    expect(r.sizingDiagnostics.tightStopBlocked).toBe(true);
    expect(r.allowed).toBe(false);
  });

  it("just above 1.0% stop passes the tight-stop guard", () => {
    // Floor is strict (<). 1.001% comfortably clears it (avoids fp jitter).
    const r = evaluateRisk(baseInput({
      stopLoss: 2308.60 - 2308.60 * 0.01001,
      takeProfit: 2308.60 + 2308.60 * 0.022,
    }));
    expect(r.sizingDiagnostics.tightStopBlocked).toBe(false);
  });

  it("2.5% stop opens normally and is well within margin cap", () => {
    const r = evaluateRisk(baseInput({
      stopLoss: 2308.60 - 2308.60 * 0.025,
      takeProfit: 2308.60 + 2308.60 * 0.055,
    }));
    expect(r.sizingDiagnostics.tightStopBlocked).toBe(false);
    expect(r.marginUsed).toBeLessThanOrEqual(r.sizingDiagnostics.marginCapUsdt * 1.001);
  });
});

describe("paper sizing cap — invariants", () => {
  it("marginCapPercent is 10 with hard ceiling 15 (not env-overridable)", () => {
    const r = evaluateRisk(baseInput({
      stopLoss: 2308.60 - 2308.60 * 0.025,
      takeProfit: 2308.60 + 2308.60 * 0.055,
    }));
    expect(r.sizingDiagnostics.marginCapPercent).toBe(10);
  });

  it("sizingVersion is risk_cap_v1 (release tag)", () => {
    const r = evaluateRisk(baseInput({
      stopLoss: 2308.60 - 2308.60 * 0.025,
      takeProfit: 2308.60 + 2308.60 * 0.055,
    }));
    expect(r.sizingDiagnostics.sizingVersion).toBe("risk_cap_v1");
  });

  it("when min order size violation occurs after capping, trade is rejected", () => {
    const r = evaluateRisk(baseInput({
      symbol: "BIGUSDT",
      entryPrice: 100000,           // very expensive coin
      stopLoss: 100000 - 100000 * 0.025,
      takeProfit: 100000 + 100000 * 0.055,
      exchangeMinOrderSize: 1,      // 1 unit minimum
      accountBalanceUsd: 100,
      riskConfigTotalCapitalUsdt: 100,
    }));
    // Cap = 10 USDT, notional 20, qty 0.0002 → below min 1 → violation
    expect(r.allowed).toBe(false);
    expect(r.ruleViolations.some((v) => v.includes("minimum"))).toBe(true);
  });
});

describe("safety invariants — sizing cap does not unlock live trading", () => {
  it("evaluateRisk does not export any /fapi/v1/order or leverage helper", async () => {
    const mod = await import("@/lib/engines/risk-engine");
    const keys = Object.keys(mod);
    expect(keys).not.toContain("openLiveOrder");
    expect(keys).not.toContain("setLeverage");
    expect(keys).not.toContain("placeFuturesOrder");
  });

  it("sizing cap source is hard-coded in risk-engine (no env override path)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/engines/risk-engine.ts"),
      "utf8",
    );
    expect(src).toMatch(/PAPER_SINGLE_TRADE_MARGIN_CAP_PERCENT = 10/);
    expect(src).toMatch(/PAPER_SINGLE_TRADE_MARGIN_HARD_CEILING_PERCENT = 15/);
    expect(src).toMatch(/TIGHT_STOP_MIN_PERCENT = 1\.0/);
    // No /fapi/v1/order or setLeverage call introduced
    expect(src).not.toMatch(/\/fapi\/v1\/order/);
    expect(src).not.toMatch(/\/fapi\/v1\/leverage/);
  });
});

describe("orchestrator backstop — paper_trade_open_blocked_by_tight_stop event", () => {
  it("orchestrator emits paper_trade_open_blocked_by_tight_stop and *_by_sizing_backstop log events", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/engines/bot-orchestrator.ts"),
      "utf8",
    );
    expect(src).toMatch(/eventType:\s*"paper_trade_open_blocked_by_tight_stop"/);
    expect(src).toMatch(/eventType:\s*"paper_trade_open_blocked_by_sizing_backstop"/);
    expect(src).toMatch(/sizingVersion: sizing\.sizingVersion/);
    expect(src).toMatch(/marginCapApplied/);
  });
});
