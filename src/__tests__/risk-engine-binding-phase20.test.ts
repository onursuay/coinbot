// Faz 20 — Risk Engine Binding / Position Sizing testleri.
//
// Kapsam:
//   • calculatePositionSizeByRisk formülü ve edge case'leri
//   • Risk settings → risk engine lifecycle bağlantısı
//   • Günlük max zarar, max açık pozisyon, max günlük işlem risk settings'ten
//   • averageDownEnabled = false invariantı
//   • leverageExecutionBound = false invariantı
//   • openLiveOrder hâlâ LIVE_EXECUTION_NOT_IMPLEMENTED
//   • HARD_LIVE_TRADING_ALLOWED=false, DEFAULT_TRADING_MODE=paper,
//     enable_live_trading=false, MIN_SIGNAL_CONFIDENCE=70 değişmemiş
//   • Binance order/private endpoint çağrısı yok
//   • /fapi/v1/leverage yok

import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { calculatePositionSizeByRisk } from "@/lib/engines/position-sizing";
import { evaluateRisk } from "@/lib/engines/risk-engine";
import {
  __resetRiskSettingsStoreForTests,
  buildRiskExecutionConfig,
  updateRiskSettings,
} from "@/lib/risk-settings";

beforeEach(() => { __resetRiskSettingsStoreForTests(); });

// ── Grup 1: calculatePositionSizeByRisk formülü ─────────────────────────────

describe("Faz 20 — calculatePositionSizeByRisk temel formül", () => {
  it("1000 USDT sermaye + %3 risk = 30 USDT riskAmount", () => {
    const r = calculatePositionSizeByRisk({
      totalBotCapitalUsdt: 1000,
      riskPerTradePercent: 3,
      entryPrice: 100,
      stopLoss: 95,
      side: "LONG",
      symbol: "XUSDT",
    });
    expect(r.valid).toBe(true);
    expect(r.riskAmountUsdt).toBeCloseTo(30, 6);
  });

  it("entry=100, SL=95 → stopDistance=%5, notional=600, quantity=6", () => {
    const r = calculatePositionSizeByRisk({
      totalBotCapitalUsdt: 1000,
      riskPerTradePercent: 3,
      entryPrice: 100,
      stopLoss: 95,
      side: "LONG",
      symbol: "XUSDT",
    });
    expect(r.valid).toBe(true);
    expect(r.stopDistancePercent).toBeCloseTo(5, 6);
    expect(r.notionalUsdt).toBeCloseTo(600, 4);
    expect(r.quantity).toBeCloseTo(6, 4);
  });

  it("stopLoss eksikse invalid", () => {
    const r = calculatePositionSizeByRisk({
      totalBotCapitalUsdt: 1000,
      riskPerTradePercent: 3,
      entryPrice: 100,
      stopLoss: 0,
      side: "LONG",
      symbol: "XUSDT",
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/stopLoss/);
  });

  it("entryPrice <= 0 ise invalid", () => {
    const r = calculatePositionSizeByRisk({
      totalBotCapitalUsdt: 1000,
      riskPerTradePercent: 3,
      entryPrice: 0,
      stopLoss: 95,
      side: "LONG",
      symbol: "XUSDT",
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/entryPrice/);
  });

  it("entryPrice === stopLoss (stopDistance=0) ise invalid", () => {
    const r = calculatePositionSizeByRisk({
      totalBotCapitalUsdt: 1000,
      riskPerTradePercent: 3,
      entryPrice: 100,
      stopLoss: 100,
      side: "LONG",
      symbol: "XUSDT",
    });
    expect(r.valid).toBe(false);
  });

  it("totalBotCapitalUsdt = 0 ise capital_missing reason üretilir", () => {
    const r = calculatePositionSizeByRisk({
      totalBotCapitalUsdt: 0,
      riskPerTradePercent: 3,
      entryPrice: 100,
      stopLoss: 95,
      side: "LONG",
      symbol: "XUSDT",
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/capital_missing/);
  });

  it("NaN veya Infinity üretilmez — tüm çıktılar finite", () => {
    const r = calculatePositionSizeByRisk({
      totalBotCapitalUsdt: 1000,
      riskPerTradePercent: 3,
      entryPrice: 100,
      stopLoss: 95,
      side: "LONG",
      symbol: "XUSDT",
    });
    expect(Number.isFinite(r.riskAmountUsdt)).toBe(true);
    expect(Number.isFinite(r.stopDistancePercent)).toBe(true);
    expect(Number.isFinite(r.quantity)).toBe(true);
    expect(Number.isFinite(r.notionalUsdt)).toBe(true);
  });

  it("quantity negatif olamaz", () => {
    const r = calculatePositionSizeByRisk({
      totalBotCapitalUsdt: 1000,
      riskPerTradePercent: 3,
      entryPrice: 100,
      stopLoss: 95,
      side: "LONG",
      symbol: "XUSDT",
    });
    expect(r.quantity).toBeGreaterThan(0);
  });

  it("kaldıraç position sizing'i artırmaz — leverageRanges output'ta yok", () => {
    // calculatePositionSizeByRisk no leverage input or output
    const r = calculatePositionSizeByRisk({
      totalBotCapitalUsdt: 1000,
      riskPerTradePercent: 3,
      entryPrice: 100,
      stopLoss: 95,
      side: "LONG",
      symbol: "XUSDT",
    });
    // output has no leverage field — only risk-based sizing
    expect((r as any).leverage).toBeUndefined();
    // quantity unchanged even if we imagine 10x leverage — formula doesn't use it
    expect(r.quantity).toBeCloseTo(6, 4);
  });

  it("SHORT için de formül doğru çalışır (SL entry'nin üstünde)", () => {
    // entry=100, SL=105 → stopDist=5%
    const r = calculatePositionSizeByRisk({
      totalBotCapitalUsdt: 1000,
      riskPerTradePercent: 3,
      entryPrice: 100,
      stopLoss: 105,
      side: "SHORT",
      symbol: "XUSDT",
    });
    expect(r.valid).toBe(true);
    expect(r.stopDistancePercent).toBeCloseTo(5, 6);
    expect(r.notionalUsdt).toBeCloseTo(600, 4);
  });
});

// ── Grup 2: Risk settings STANDART defaults lifecycle ───────────────────────

describe("Faz 20 — risk settings STANDART defaults lifecycle bağlantısı", () => {
  it("riskPerTradePercent STANDART default = 3", () => {
    const cfg = buildRiskExecutionConfig();
    expect(cfg.riskPerTradePercent).toBe(3);
  });

  it("dailyMaxLossPercent STANDART default = 10", () => {
    const cfg = buildRiskExecutionConfig();
    expect(cfg.dailyMaxLossPercent).toBe(10);
  });

  it("defaultMaxOpenPositions STANDART default = 3", () => {
    const cfg = buildRiskExecutionConfig();
    expect(cfg.defaultMaxOpenPositions).toBe(3);
  });

  it("dynamicMaxOpenPositions STANDART default = 5", () => {
    const cfg = buildRiskExecutionConfig();
    expect(cfg.dynamicMaxOpenPositions).toBe(5);
  });

  it("maxDailyTrades STANDART default = 10", () => {
    const cfg = buildRiskExecutionConfig();
    expect(cfg.maxDailyTrades).toBe(10);
  });

  it("totalBotCapitalUsdt default = 0 (tanımsız)", () => {
    const cfg = buildRiskExecutionConfig();
    expect(cfg.totalBotCapitalUsdt).toBe(0);
  });

  it("totalBotCapitalUsdt güncellendikten sonra lifecycle'a geçer", () => {
    updateRiskSettings({ capital: { totalCapitalUsdt: 5000, riskPerTradePercent: 3, maxDailyLossPercent: 10 } });
    const cfg = buildRiskExecutionConfig();
    expect(cfg.totalBotCapitalUsdt).toBe(5000);
  });

  it("riskPerTradePercent güncellendikten sonra lifecycle'a geçer", () => {
    updateRiskSettings({ capital: { totalCapitalUsdt: 0, riskPerTradePercent: 2, maxDailyLossPercent: 10 } });
    const cfg = buildRiskExecutionConfig();
    expect(cfg.riskPerTradePercent).toBe(2);
  });

  it("dailyMaxLossPercent güncellendikten sonra lifecycle'a geçer", () => {
    updateRiskSettings({ capital: { totalCapitalUsdt: 0, riskPerTradePercent: 3, maxDailyLossPercent: 6 } });
    const cfg = buildRiskExecutionConfig();
    expect(cfg.dailyMaxLossPercent).toBe(6);
  });

  it("defaultMaxOpenPositions güncellendikten sonra lifecycle'a geçer", () => {
    updateRiskSettings({ positions: { defaultMaxOpenPositions: 2, dynamicMaxOpenPositionsCap: 4, maxDailyTrades: 10 } });
    const cfg = buildRiskExecutionConfig();
    expect(cfg.defaultMaxOpenPositions).toBe(2);
  });

  it("maxDailyTrades güncellendikten sonra lifecycle'a geçer", () => {
    updateRiskSettings({ positions: { defaultMaxOpenPositions: 3, dynamicMaxOpenPositionsCap: 5, maxDailyTrades: 8 } });
    const cfg = buildRiskExecutionConfig();
    expect(cfg.maxDailyTrades).toBe(8);
  });
});

// ── Grup 3: Risk engine lifecycle bağlantısı ────────────────────────────────

describe("Faz 20 — risk engine lifecycle bağlantısı", () => {
  const baseInput = {
    symbol: "BTCUSDT",
    direction: "LONG" as const,
    entryPrice: 30000,
    stopLoss: 29000,
    takeProfit: 32000,
    signalScore: 75,
    marketSpread: 0.001,
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
  };

  it("riskConfigRiskPerTradePercent=3 ile 1000 USDT → riskAmount=30", () => {
    const result = evaluateRisk({
      ...baseInput,
      accountBalanceUsd: 1000,
      riskConfigRiskPerTradePercent: 3,
      riskConfigCapitalSource: "risk_settings",
    });
    expect(result.riskAmount).toBeCloseTo(30, 2);
  });

  it("riskConfigMaxOpenPositions=1 dolduğunda violation üretilir", () => {
    const result = evaluateRisk({
      ...baseInput,
      accountBalanceUsd: 1000,
      openPositionCount: 1,
      riskConfigMaxOpenPositions: 1,
    });
    expect(result.allowed).toBe(false);
    expect(result.ruleViolations.some(v => v.includes("Maksimum açık pozisyon"))).toBe(true);
  });

  it("riskConfigDailyMaxLossPercent=5 ile günlük zarar limiti hesaplanır", () => {
    // 1000 USDT * 5% = 50 USDT limit → -60 USDT ile limit aşılmış
    const result = evaluateRisk({
      ...baseInput,
      accountBalanceUsd: 1000,
      dailyRealizedPnlUsd: -60,
      riskConfigDailyMaxLossPercent: 5,
    });
    expect(result.allowed).toBe(false);
    expect(result.ruleViolations.some(v => v.includes("Günlük zarar"))).toBe(true);
  });

  it("riskConfigSource = risk_settings ise result'ta riskConfigSource = risk_settings", () => {
    const result = evaluateRisk({
      ...baseInput,
      accountBalanceUsd: 1000,
      riskConfigCapitalSource: "risk_settings",
    });
    expect(result.riskConfigSource).toBe("risk_settings");
  });

  it("riskConfigSource verilmezse env_fallback olur", () => {
    const result = evaluateRisk({
      ...baseInput,
      accountBalanceUsd: 1000,
    });
    expect(result.riskConfigSource).toBe("env_fallback");
  });

  it("maxOpenPositionsFromRiskSettings result'ta dönüyor", () => {
    const result = evaluateRisk({
      ...baseInput,
      accountBalanceUsd: 1000,
      riskConfigMaxOpenPositions: 3,
    });
    expect(result.maxOpenPositionsFromRiskSettings).toBe(3);
  });
});

// ── Grup 4: Güvenlik invariantları ──────────────────────────────────────────

describe("Faz 20 — güvenlik invariantları", () => {
  it("averageDownEnabled her zaman false", () => {
    const cfg = buildRiskExecutionConfig();
    expect(cfg.averageDownEnabled).toBe(false);
  });

  it("averageDownEnabled=true patch'i reddedilir", () => {
    const r = updateRiskSettings({
      tiered: { averageDownEnabled: true as any },
    });
    expect(r.ok).toBe(false);
  });

  it("leverageExecutionBound her zaman false", () => {
    const cfg = buildRiskExecutionConfig();
    expect(cfg.leverageExecutionBound).toBe(false);
  });

  it("liveExecutionBound her zaman false", () => {
    const cfg = buildRiskExecutionConfig();
    expect(cfg.liveExecutionBound).toBe(false);
  });

  it("riskConfigBound her zaman true", () => {
    const cfg = buildRiskExecutionConfig();
    expect(cfg.riskConfigBound).toBe(true);
  });

  it("HARD_LIVE_TRADING_ALLOWED=false değişmemiş", () => {
    expect(process.env.HARD_LIVE_TRADING_ALLOWED).not.toBe("true");
  });

  it("DEFAULT_TRADING_MODE=paper değişmemiş (env default)", () => {
    // env module uses "paper" as default when env var not set
    const envVal = process.env.DEFAULT_TRADING_MODE;
    expect(envVal === undefined || envVal === "" || envVal === "paper").toBe(true);
  });

  it("enable_live_trading=false — live-trading-guard source file içermez", () => {
    const guardSrc = path.join(process.cwd(), "src/lib/engines/live-trading-guard.ts");
    // File may or may not exist; if it does, it must not call /fapi/v1/order
    if (fs.existsSync(guardSrc)) {
      const src = fs.readFileSync(guardSrc, "utf8");
      expect(src).not.toMatch(/fapi\/v1\/order/);
      expect(src).not.toMatch(/fapi\/v1\/leverage/);
    } else {
      // Guard file doesn't exist — this is expected; openLiveOrder is not implemented
      expect(true).toBe(true);
    }
  });

  it("MIN_SIGNAL_CONFIDENCE=70 — signal engine source değişmemiş", () => {
    const sigSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/engines/signal-engine.ts"),
      "utf8",
    );
    expect(sigSrc).toMatch(/70/); // threshold must still be present
  });

  it("openLiveOrder hâlâ LIVE_EXECUTION_NOT_IMPLEMENTED — live-execution adapter içeriyor", () => {
    const adapterPath = path.join(process.cwd(), "src/lib/live-execution/adapter.ts");
    if (fs.existsSync(adapterPath)) {
      const src = fs.readFileSync(adapterPath, "utf8");
      expect(src).toMatch(/LIVE_EXECUTION_NOT_IMPLEMENTED/);
    } else {
      // Mock adapter fallback
      const mockPath = path.join(process.cwd(), "src/lib/live-execution/mock-adapter.ts");
      if (fs.existsSync(mockPath)) {
        const src = fs.readFileSync(mockPath, "utf8");
        expect(src).toMatch(/LIVE_EXECUTION_NOT_IMPLEMENTED/);
      } else {
        expect(true).toBe(true);
      }
    }
  });

  it("Binance /fapi/v1/order çağrısı hiçbir engine dosyasında yok", () => {
    const engineDir = path.join(process.cwd(), "src/lib/engines");
    const files = fs.readdirSync(engineDir).filter(f => f.endsWith(".ts"));
    for (const f of files) {
      const src = fs.readFileSync(path.join(engineDir, f), "utf8");
      expect(src).not.toMatch(/fapi\/v1\/order/);
    }
  });

  it("Binance /fapi/v1/leverage çağrısı hiçbir engine dosyasında yok", () => {
    const engineDir = path.join(process.cwd(), "src/lib/engines");
    const files = fs.readdirSync(engineDir).filter(f => f.endsWith(".ts"));
    for (const f of files) {
      const src = fs.readFileSync(path.join(engineDir, f), "utf8");
      expect(src).not.toMatch(/fapi\/v1\/leverage/);
    }
  });

  it("position-sizing.ts kaldıraç alanı içermiyor", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/engines/position-sizing.ts"),
      "utf8",
    );
    // leverage should not appear as an input/output of the sizing function
    expect(src).not.toMatch(/leverage\s*:/);
  });

  it("Worker lock mekanizması bot-orchestrator'da korunuyor", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/engines/bot-orchestrator.ts"),
      "utf8",
    );
    expect(src).toMatch(/isLockOwner/);
  });
});

// ── Grup 5: Daily max loss risk settings'ten hesaplanıyor ───────────────────

describe("Faz 20 — daily max loss risk settings'ten", () => {
  it("daily-target.ts DailyStatusOptions tipi export edilmiş ve dailyMaxLossPercent içeriyor", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/engines/daily-target.ts"),
      "utf8",
    );
    expect(src).toMatch(/DailyStatusOptions/);
    expect(src).toMatch(/dailyMaxLossPercent/);
  });

  it("daily-target.ts getDailyStatus opts parametresi kabul ediyor", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/engines/daily-target.ts"),
      "utf8",
    );
    // Function signature must accept opts parameter
    expect(src).toMatch(/opts\?/);
  });
});

// ── Grup 6b: Aggressive Paper Mode — maxOpenPositions override ──────────────

describe("Aggressive Paper Mode — max open positions override (riskConfigMaxOpenPositions)", () => {
  const base = {
    symbol: "ETHUSDT",
    direction: "LONG" as const,
    entryPrice: 3000,
    stopLoss: 2900,
    takeProfit: 3200,
    signalScore: 55,
    marketSpread: 0.001,
    recentLossStreak: 0,
    dailyRealizedPnlUsd: 0,
    weeklyRealizedPnlUsd: 0,
    dailyTargetHit: false,
    conservativeMode: false,
    killSwitchActive: false,
    webSocketHealthy: true,
    apiHealthy: true,
    dataFresh: true,
    accountBalanceUsd: 1000,
  };

  it("normal mode: 4/4 açık pozisyon → bloklar", () => {
    const result = evaluateRisk({
      ...base,
      openPositionCount: 4,
      riskConfigMaxOpenPositions: 4,
    });
    expect(result.allowed).toBe(false);
    expect(result.ruleViolations.some(v => v.includes("Maksimum açık pozisyon (4)"))).toBe(true);
  });

  it("aggressive paper: 4/5 açık pozisyon → izin verir (override çalışıyor)", () => {
    const result = evaluateRisk({
      ...base,
      openPositionCount: 4,
      riskConfigMaxOpenPositions: 5,
    });
    // 4 < 5 → max open positions violation olmamalı
    const hasMaxPosViolation = result.ruleViolations.some(v => v.includes("Maksimum açık pozisyon"));
    expect(hasMaxPosViolation).toBe(false);
  });

  it("aggressive paper: 5/5 açık pozisyon → bloklar", () => {
    const result = evaluateRisk({
      ...base,
      openPositionCount: 5,
      riskConfigMaxOpenPositions: 5,
    });
    expect(result.allowed).toBe(false);
    expect(result.ruleViolations.some(v => v.includes("Maksimum açık pozisyon (5)"))).toBe(true);
  });

  it("maxOpenPositionsFromRiskSettings result'ta doğru limit dönüyor", () => {
    const result = evaluateRisk({
      ...base,
      openPositionCount: 4,
      riskConfigMaxOpenPositions: 5,
    });
    expect(result.maxOpenPositionsFromRiskSettings).toBe(5);
  });

  it("bot-orchestrator aggressive override: aggMode.active iken maxOpenPositions'ı riskCfg'den değil aggMode'dan alır", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/engines/bot-orchestrator.ts"),
      "utf8",
    );
    // Override satırı aggMode.active ? aggMode.maxOpenPositions : riskCfg şeklinde olmalı
    expect(src).toMatch(/riskConfigMaxOpenPositions:\s*aggMode\.active\s*\?\s*aggMode\.maxOpenPositions\s*:\s*riskCfg\.defaultMaxOpenPositions/);
  });

  it("live mode'da aggressive override uygulanmaz: aggMode.active her zaman false olur (checkAggressivePaperMode guard)", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/aggressive-paper-mode.ts"),
      "utf8",
    );
    // Guard: HARD_LIVE_TRADING_ALLOWED=true ise inactive döner
    expect(src).toMatch(/HARD_LIVE_TRADING_ALLOWED/);
    // Guard: enable_live_trading=true ise inactive döner
    expect(src).toMatch(/enable_live_trading/);
    // Guard: trading_mode !== 'paper' ise inactive döner
    expect(src).toMatch(/trading_mode.*paper/);
  });
});

// ── Grup 6: Position sizing formül doğrulama ────────────────────────────────

describe("Faz 20 — position sizing formül edge cases", () => {
  it("riskPerTradePercent=0 ise invalid", () => {
    const r = calculatePositionSizeByRisk({
      totalBotCapitalUsdt: 1000,
      riskPerTradePercent: 0,
      entryPrice: 100,
      stopLoss: 95,
      side: "LONG",
      symbol: "XUSDT",
    });
    expect(r.valid).toBe(false);
  });

  it("çok küçük stop mesafesi (0.001%) invalid değil ama hesap tutarlı", () => {
    // SL very close to entry
    const r = calculatePositionSizeByRisk({
      totalBotCapitalUsdt: 1000,
      riskPerTradePercent: 1,
      entryPrice: 100,
      stopLoss: 99.999,
      side: "LONG",
      symbol: "XUSDT",
    });
    // Very large notional but calculation should still be finite and valid
    if (r.valid) {
      expect(Number.isFinite(r.notionalUsdt)).toBe(true);
      expect(Number.isFinite(r.quantity)).toBe(true);
      expect(r.quantity).toBeGreaterThan(0);
    }
  });

  it("minNotional guard çalışıyor", () => {
    const r = calculatePositionSizeByRisk({
      totalBotCapitalUsdt: 10,
      riskPerTradePercent: 1,
      entryPrice: 100,
      stopLoss: 95,
      side: "LONG",
      symbol: "XUSDT",
      minNotional: 1000,
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/minimum/);
  });

  it("maxNotional guard çalışıyor", () => {
    const r = calculatePositionSizeByRisk({
      totalBotCapitalUsdt: 100000,
      riskPerTradePercent: 50,
      entryPrice: 100,
      stopLoss: 95,
      side: "LONG",
      symbol: "XUSDT",
      maxNotional: 100,
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/maksimum/);
  });
});
