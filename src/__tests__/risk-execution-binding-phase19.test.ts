// Faz 19 — Risk Settings Execution Binding testleri.
//
// Kapsam:
//   • getEffectiveRiskSettings / buildRiskExecutionConfig
//   • STANDART defaults aktarımı (%3, %10, 3, 5, 10)
//   • totalBotCapital, riskPerTrade, dailyMaxLoss, max open, max daily trades aktarımı
//   • Kaldıraç aralıkları config'e taşınıyor — execution YOK
//   • averageDown true reddi (store + buildRiskExecutionConfig + validation)
//   • liveExecutionBound = false, leverageExecutionBound = false sabit
//   • Statik invariantlar: /fapi/v1/order yok, openLiveOrder hâlâ NOT_IMPLEMENTED,
//     env hard gate kapalı, MIN_SIGNAL_CONFIDENCE değişmemiş

import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  __resetRiskSettingsStoreForTests,
  getRiskSettings,
  updateRiskSettings,
  getEffectiveRiskSettings,
  buildRiskExecutionConfig,
  validateRiskExecutionConfig,
  getRiskExecutionStatus,
} from "@/lib/risk-settings";

beforeEach(() => { __resetRiskSettingsStoreForTests(); });

// ── Grup 1: STANDART defaults ────────────────────────────────────────────────

describe("Faz 19 — STANDART defaults aktarımı", () => {
  it("riskPerTradePercent default = 3%", () => {
    const cfg = buildRiskExecutionConfig();
    expect(cfg.riskPerTradePercent).toBe(3);
  });

  it("dailyMaxLossPercent default = 10%", () => {
    const cfg = buildRiskExecutionConfig();
    expect(cfg.dailyMaxLossPercent).toBe(10);
  });

  it("defaultMaxOpenPositions default = 3", () => {
    const cfg = buildRiskExecutionConfig();
    expect(cfg.defaultMaxOpenPositions).toBe(3);
  });

  it("dynamicMaxOpenPositions default = 5", () => {
    const cfg = buildRiskExecutionConfig();
    expect(cfg.dynamicMaxOpenPositions).toBe(5);
  });

  it("maxDailyTrades default = 10", () => {
    const cfg = buildRiskExecutionConfig();
    expect(cfg.maxDailyTrades).toBe(10);
  });

  it("profile default = STANDARD", () => {
    const cfg = buildRiskExecutionConfig();
    expect(cfg.profile).toBe("STANDARD");
  });
});

// ── Grup 2: User config flows through to execution config ────────────────────

describe("Faz 19 — User config aktarımı", () => {
  it("totalBotCapitalUsdt config'e taşınıyor", () => {
    const r = updateRiskSettings({ capital: { totalCapitalUsdt: 1500 } });
    expect(r.ok).toBe(true);
    const cfg = buildRiskExecutionConfig();
    expect(cfg.totalBotCapitalUsdt).toBe(1500);
  });

  it("riskPerTradePercent config'e taşınıyor", () => {
    updateRiskSettings({ capital: { riskPerTradePercent: 4 } });
    expect(buildRiskExecutionConfig().riskPerTradePercent).toBe(4);
  });

  it("maxDailyLossPercent config'e taşınıyor", () => {
    updateRiskSettings({ capital: { maxDailyLossPercent: 8 } });
    expect(buildRiskExecutionConfig().dailyMaxLossPercent).toBe(8);
  });

  it("defaultMaxOpenPositions config'e taşınıyor", () => {
    updateRiskSettings({ positions: { defaultMaxOpenPositions: 4, dynamicMaxOpenPositionsCap: 6 } });
    expect(buildRiskExecutionConfig().defaultMaxOpenPositions).toBe(4);
  });

  it("dynamicMaxOpenPositions config'e taşınıyor", () => {
    updateRiskSettings({ positions: { dynamicMaxOpenPositionsCap: 7, defaultMaxOpenPositions: 3 } });
    expect(buildRiskExecutionConfig().dynamicMaxOpenPositions).toBe(7);
  });

  it("maxDailyTrades config'e taşınıyor", () => {
    updateRiskSettings({ positions: { maxDailyTrades: 25 } });
    expect(buildRiskExecutionConfig().maxDailyTrades).toBe(25);
  });

  it("leverage range CC config'e taşınıyor (execution YOK)", () => {
    updateRiskSettings({ leverage: { CC: { min: 5, max: 15 } } });
    const cfg = buildRiskExecutionConfig();
    expect(cfg.leverageRanges.CC.min).toBe(5);
    expect(cfg.leverageRanges.CC.max).toBe(15);
    expect(cfg.leverageExecutionBound).toBe(false);
  });

  it("longLeverageEnabled / shortLeverageEnabled config'e taşınıyor", () => {
    updateRiskSettings({ direction: { longEnabled: true, shortEnabled: false } });
    const cfg = buildRiskExecutionConfig();
    expect(cfg.longLeverageEnabled).toBe(true);
    expect(cfg.shortLeverageEnabled).toBe(false);
  });
});

// ── Grup 3: averageDown lock ──────────────────────────────────────────────────

describe("Faz 19 — averageDown kilidi", () => {
  it("update path averageDown true reddediyor (runtime guard)", () => {
    const r = updateRiskSettings({ tiered: { averageDownEnabled: true as any } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join(" ")).toMatch(/zarar/i);
    }
  });

  it("execution config averageDownEnabled = false", () => {
    expect(buildRiskExecutionConfig().averageDownEnabled).toBe(false);
  });

  it("getRiskExecutionStatus.averageDownLocked = true", () => {
    expect(getRiskExecutionStatus().averageDownLocked).toBe(true);
  });
});

// ── Grup 4: Binding flags sabitleri ───────────────────────────────────────────

describe("Faz 19 — Binding flags", () => {
  it("riskConfigBound = true", () => {
    expect(buildRiskExecutionConfig().riskConfigBound).toBe(true);
  });

  it("liveExecutionBound = false (Faz 19'da sabit)", () => {
    expect(buildRiskExecutionConfig().liveExecutionBound).toBe(false);
  });

  it("leverageExecutionBound = false", () => {
    expect(buildRiskExecutionConfig().leverageExecutionBound).toBe(false);
  });

  it("getRiskExecutionStatus dürüst raporluyor", () => {
    const s = getRiskExecutionStatus();
    expect(s.riskConfigBound).toBe(true);
    expect(s.liveExecutionBound).toBe(false);
    expect(s.leverageExecutionBound).toBe(false);
    expect(s.envHardLiveAllowed).toBe(false);  // test env always false
    expect(s.envDefaultTradingMode).toBe("paper");
  });
});

// ── Grup 5: validation ────────────────────────────────────────────────────────

describe("Faz 19 — validateRiskExecutionConfig", () => {
  it("default config geçerli", () => {
    const cfg = buildRiskExecutionConfig();
    const v = validateRiskExecutionConfig(cfg);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it("liveExecutionBound true geçersiz", () => {
    const cfg = { ...buildRiskExecutionConfig(), liveExecutionBound: true as any };
    const v = validateRiskExecutionConfig(cfg);
    expect(v.ok).toBe(false);
  });

  it("dynamicMax < defaultMax geçersiz", () => {
    const cfg = { ...buildRiskExecutionConfig(), defaultMaxOpenPositions: 5, dynamicMaxOpenPositions: 2 };
    const v = validateRiskExecutionConfig(cfg);
    expect(v.ok).toBe(false);
  });
});

// ── Grup 6: getEffectiveRiskSettings = getRiskSettings ────────────────────────

describe("Faz 19 — getEffectiveRiskSettings", () => {
  it("snapshot store ile aynı değerleri dönüyor", () => {
    const a = getEffectiveRiskSettings();
    const b = getRiskSettings();
    expect(a.profile).toBe(b.profile);
    expect(a.capital.riskPerTradePercent).toBe(b.capital.riskPerTradePercent);
  });
});

// ── Grup 7: Statik invariantlar ───────────────────────────────────────────────

describe("Faz 19 — Güvenlik invariantları", () => {
  const applyPath = path.resolve(__dirname, "../lib/risk-settings/apply.ts");
  const storePath = path.resolve(__dirname, "../lib/risk-settings/store.ts");
  const adapterPath = path.resolve(__dirname, "../lib/live-execution/adapter.ts");
  const envTsPath = path.resolve(__dirname, "../lib/env.ts");

  let applyTs: string;
  let storeTs: string;
  let adapter: string;
  let envTs: string;

  beforeAll(() => {
    applyTs = fs.readFileSync(applyPath, "utf8");
    storeTs = fs.readFileSync(storePath, "utf8");
    adapter = fs.readFileSync(adapterPath, "utf8");
    envTs = fs.readFileSync(envTsPath, "utf8");
  });

  it("apply.ts no /fapi/v1/order", () => {
    expect(applyTs).not.toMatch(/\/fapi\/v1\/order/);
  });

  it("apply.ts no fetch() call (no exchange contact)", () => {
    expect(applyTs).not.toMatch(/\bfetch\s*\(/);
  });

  it("store.ts no /fapi/v1/order", () => {
    expect(storeTs).not.toMatch(/\/fapi\/v1\/order/);
  });

  it("apply.ts liveExecutionBound literal false", () => {
    expect(applyTs).toMatch(/liveExecutionBound:\s*false/);
  });

  it("apply.ts leverageExecutionBound literal false", () => {
    expect(applyTs).toMatch(/leverageExecutionBound:\s*false/);
  });

  it("env hardLiveTradingAllowed defaults to false", () => {
    expect(envTs).toMatch(/hardLiveTradingAllowed.*HARD_LIVE_TRADING_ALLOWED.*false/);
  });

  it("env defaultTradingMode defaults to paper", () => {
    expect(envTs).toMatch(/defaultTradingMode.*DEFAULT_TRADING_MODE.*"paper"/);
  });

  it("openLiveOrder hâlâ LIVE_EXECUTION_NOT_IMPLEMENTED, fetch yok", () => {
    expect(adapter).toMatch(/LIVE_EXECUTION_NOT_IMPLEMENTED/);
    expect(adapter).not.toMatch(/\bfetch\s*\(/);
  });
});
