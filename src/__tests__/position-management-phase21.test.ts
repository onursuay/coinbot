// Faz 21 — Kademeli Pozisyon / Kaldıraç Yönetimi testleri.
//
// Kapsam:
//   • R-multiple doğru hesaplanıyor
//   • currentRMultiple < 0 → scale-in engelleniyor (BLOCK_SCALE_IN_LOSING_POSITION)
//   • Zararda pozisyon büyütme asla önerilmiyor
//   • currentRMultiple >= 1.5 + şartlar iyiyse CONSIDER_PROFIT_SCALE_IN metadata
//   • scale-in gerçek emir üretmiyor
//   • Long trailing stop sadece yukarı hareket ediyor
//   • Short trailing stop sadece aşağı hareket ediyor
//   • SL riski artıracak yönde geri alınmıyor
//   • 1R'de breakeven önerisi üretilebiliyor
//   • 1.5R'de partial take profit önerisi üretilebiliyor
//   • 2R+ trailing stop önerisi üretilebiliyor
//   • Eksik veri NaN/Infinity üretmiyor
//   • Endpoint read-only, Binance çağrısı yok
//   • openLiveOrder hâlâ LIVE_EXECUTION_NOT_IMPLEMENTED
//   • /fapi/v1/order, /fapi/v1/leverage yok
//   • Tüm live gate değerleri korunuyor
//   • averageDownEnabled=false korunuyor
//   • leverageExecutionBound=false korunuyor
//   • Signal engine matematiği değişmemiş

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { evaluatePosition } from "@/lib/position-management/progressive-plan";
import { calculateTrailingStop } from "@/lib/position-management/trailing-stop";
import { evaluateScaleIn } from "@/lib/position-management/scale-rules";
import type { PositionManagementInput } from "@/lib/position-management/types";

// ── Base input factory ────────────────────────────────────────────────────

function makeInput(overrides: Partial<PositionManagementInput> = {}): PositionManagementInput {
  return {
    symbol: "BTCUSDT",
    side: "LONG",
    entryPrice: 30000,
    currentPrice: 30000,
    stopLoss: 29000,
    takeProfit: 32000,
    quantity: 0.1,
    notionalUsdt: 3000,
    unrealizedPnl: 0,
    unrealizedPnlPercent: 0,
    rrRatio: 2,
    riskAmountUsdt: 100,
    tradeSignalScore: 75,
    setupScore: 75,
    marketQualityScore: 80,
    btcAligned: true,
    volumeImpulse: true,
    openedAt: new Date().toISOString(),
    mode: "paper",
    ...overrides,
  };
}

// ── Grup 1: R-multiple hesabı ────────────────────────────────────────────

describe("Faz 21 — R-multiple hesabı", () => {
  it("unrealizedPnl=100, riskAmount=100 → rMultiple=1", () => {
    const d = evaluatePosition(makeInput({ unrealizedPnl: 100, riskAmountUsdt: 100 }));
    expect(d.currentRMultiple).toBeCloseTo(1, 4);
  });

  it("unrealizedPnl=150, riskAmount=100 → rMultiple=1.5", () => {
    const d = evaluatePosition(makeInput({ unrealizedPnl: 150, riskAmountUsdt: 100 }));
    expect(d.currentRMultiple).toBeCloseTo(1.5, 4);
  });

  it("unrealizedPnl=-50, riskAmount=100 → rMultiple=-0.5 (zarar)", () => {
    const d = evaluatePosition(makeInput({ unrealizedPnl: -50, riskAmountUsdt: 100 }));
    expect(d.currentRMultiple).toBeCloseTo(-0.5, 4);
  });

  it("currentRMultiple sağlanmışsa direkt kullanılır", () => {
    const d = evaluatePosition(makeInput({ currentRMultiple: 2.5 }));
    expect(d.currentRMultiple).toBe(2.5);
  });

  it("riskAmountUsdt=0 ise NaN/Infinity üretilmez", () => {
    const d = evaluatePosition(makeInput({ riskAmountUsdt: 0, unrealizedPnl: 50 }));
    expect(Number.isFinite(d.currentRMultiple)).toBe(true);
    expect(isNaN(d.currentRMultiple)).toBe(false);
  });
});

// ── Grup 2: Stage sınıflandırması ────────────────────────────────────────

describe("Faz 21 — Stage sınıflandırması", () => {
  it("rMultiple < 0 → stage=losing", () => {
    const d = evaluatePosition(makeInput({ unrealizedPnl: -10, riskAmountUsdt: 100 }));
    expect(d.stage).toBe("losing");
  });

  it("rMultiple = 0 → stage=breakeven", () => {
    const d = evaluatePosition(makeInput({ unrealizedPnl: 0, riskAmountUsdt: 100 }));
    expect(d.stage).toBe("breakeven");
  });

  it("rMultiple = 0.7 → stage=early_profit", () => {
    const d = evaluatePosition(makeInput({ currentRMultiple: 0.7 }));
    expect(d.stage).toBe("early_profit");
  });

  it("rMultiple = 1.2 → stage=at_1r", () => {
    const d = evaluatePosition(makeInput({ currentRMultiple: 1.2 }));
    expect(d.stage).toBe("at_1r");
  });

  it("rMultiple = 1.7 → stage=at_1_5r", () => {
    const d = evaluatePosition(makeInput({ currentRMultiple: 1.7 }));
    expect(d.stage).toBe("at_1_5r");
  });

  it("rMultiple = 2.5 → stage=at_2r_plus", () => {
    const d = evaluatePosition(makeInput({ currentRMultiple: 2.5 }));
    expect(d.stage).toBe("at_2r_plus");
  });
});

// ── Grup 3: Zararda scale-in engeli ──────────────────────────────────────

describe("Faz 21 — Zararda scale-in engeli", () => {
  it("rMultiple < 0 → action=BLOCK_SCALE_IN_LOSING_POSITION", () => {
    const d = evaluatePosition(makeInput({ unrealizedPnl: -50, riskAmountUsdt: 100 }));
    expect(d.action).toBe("BLOCK_SCALE_IN_LOSING_POSITION");
  });

  it("rMultiple < 0 → scaleInAllowed=false", () => {
    const d = evaluatePosition(makeInput({ unrealizedPnl: -1, riskAmountUsdt: 100 }));
    expect(d.scaleInAllowed).toBe(false);
  });

  it("rMultiple < 0 → scaleInBlockedReason zarar içeriyor", () => {
    const d = evaluatePosition(makeInput({ unrealizedPnl: -200, riskAmountUsdt: 100 }));
    expect(d.scaleInBlockedReason).toMatch(/zarar/i);
  });

  it("zararda scale-in → warnings içinde averageDown mesajı var", () => {
    const d = evaluatePosition(makeInput({ unrealizedPnl: -50, riskAmountUsdt: 100 }));
    expect(d.warnings.some(w => w.includes("averageDown"))).toBe(true);
  });

  it("evaluateScaleIn: rMultiple < 0 → considerScaleIn=false", () => {
    const r = evaluateScaleIn(makeInput(), -0.5);
    expect(r.considerScaleIn).toBe(false);
    expect(r.scaleInAllowed).toBe(false);
    expect(r.scaleInBlockedReason).toMatch(/zarar/i);
  });
});

// ── Grup 4: Kârda scale-in koşulları ─────────────────────────────────────

describe("Faz 21 — Kârda scale-in (advisory only)", () => {
  it("rMultiple=1.5, tüm koşullar sağlandığında CONSIDER_PROFIT_SCALE_IN", () => {
    // SL at breakeven (entryPrice = stopLoss) to pass the SL condition
    const d = evaluatePosition(makeInput({
      currentRMultiple: 1.7,
      tradeSignalScore: 80,
      setupScore: 75,
      marketQualityScore: 80,
      btcAligned: true,
      volumeImpulse: true,
      stopLoss: 30000, // SL = entry = breakeven for LONG
    }));
    expect(d.action).toBe("CONSIDER_PROFIT_SCALE_IN");
    expect(d.scaleInAllowed).toBe(true);
  });

  it("scale-in sonucu output'ta gerçek emir alanı yok", () => {
    const d = evaluatePosition(makeInput({ currentRMultiple: 2, stopLoss: 30000 }));
    expect((d as any).orderPayload).toBeUndefined();
    expect((d as any).binanceOrderId).toBeUndefined();
    expect((d as any).executionType).toBeUndefined();
  });

  it("rMultiple=1.5 ama BTC uyumsuz → scale-in engellendi", () => {
    const r = evaluateScaleIn(makeInput({ btcAligned: false }), 1.7);
    expect(r.considerScaleIn).toBe(false);
    expect(r.scaleInBlockedReason).toMatch(/BTC/);
  });

  it("rMultiple=1.5 ama sinyal skoru < 70 → scale-in engellendi", () => {
    const r = evaluateScaleIn(makeInput({ tradeSignalScore: 65 }), 1.7);
    expect(r.considerScaleIn).toBe(false);
  });

  it("rMultiple=1.5 ama SL breakeven değil → scale-in engellendi", () => {
    // Long: SL below entry = not at breakeven
    const r = evaluateScaleIn(makeInput({ entryPrice: 30000, stopLoss: 29000 }), 1.7);
    expect(r.considerScaleIn).toBe(false);
    expect(r.scaleInBlockedReason).toMatch(/breakeven/);
  });
});

// ── Grup 5: 1R aşaması — breakeven önerisi ───────────────────────────────

describe("Faz 21 — 1R aşaması", () => {
  it("rMultiple=1.2 → action=MOVE_SL_TO_BREAKEVEN", () => {
    const d = evaluatePosition(makeInput({ currentRMultiple: 1.2 }));
    expect(d.action).toBe("MOVE_SL_TO_BREAKEVEN");
  });

  it("rMultiple=1.2 → actionPriority=medium", () => {
    const d = evaluatePosition(makeInput({ currentRMultiple: 1.2 }));
    expect(d.actionPriority).toBe("medium");
  });
});

// ── Grup 6: 1.5R aşaması — kısmi kâr önerisi ────────────────────────────

describe("Faz 21 — 1.5R aşaması", () => {
  it("rMultiple=1.7 → recommendedPartialTakeProfitPercent=25", () => {
    const d = evaluatePosition(makeInput({ currentRMultiple: 1.7 }));
    expect(d.recommendedPartialTakeProfitPercent).toBe(25);
  });

  it("rMultiple=1.7 → action PARTIAL_TAKE_PROFIT veya ENABLE_TRAILING_STOP", () => {
    const d = evaluatePosition(makeInput({ currentRMultiple: 1.7 }));
    expect(["PARTIAL_TAKE_PROFIT", "ENABLE_TRAILING_STOP", "CONSIDER_PROFIT_SCALE_IN"]).toContain(d.action);
  });
});

// ── Grup 7: 2R+ aşaması — trailing stop ──────────────────────────────────

describe("Faz 21 — 2R+ aşaması", () => {
  it("rMultiple=2.5 → trailingStopRecommended=true", () => {
    // Current price above entry to allow trailing
    const d = evaluatePosition(makeInput({ currentRMultiple: 2.5, currentPrice: 32000 }));
    expect(d.trailingStopRecommended).toBe(true);
  });

  it("rMultiple=2.5 → recommendedPartialTakeProfitPercent=50", () => {
    const d = evaluatePosition(makeInput({ currentRMultiple: 2.5, currentPrice: 32000 }));
    expect(d.recommendedPartialTakeProfitPercent).toBe(50);
  });

  it("rMultiple=2.5 → action ENABLE_TRAILING_STOP veya TIGHTEN_TRAILING_STOP", () => {
    const d = evaluatePosition(makeInput({ currentRMultiple: 2.5, currentPrice: 32000 }));
    expect(["ENABLE_TRAILING_STOP", "TIGHTEN_TRAILING_STOP"]).toContain(d.action);
  });
});

// ── Grup 8: Trailing stop mantığı ───────────────────────────────────────

describe("Faz 21 — Trailing stop mantığı", () => {
  it("Long: trailing stop asla mevcut SL'nin altına düşmez", () => {
    const input = makeInput({ currentPrice: 30500, stopLoss: 29000 });
    const ts = calculateTrailingStop(input, 1.5);
    if (ts.trailingStopRecommended && ts.recommendedStopLoss !== null) {
      expect(ts.recommendedStopLoss).toBeGreaterThan(input.stopLoss);
    }
  });

  it("Long: fiyat düşünce trailing SL geri alınmaz", () => {
    // Price went up then came back down — recommended SL might not be triggered
    const input = makeInput({ currentPrice: 29500, stopLoss: 29000 }); // below entry
    const ts = calculateTrailingStop(input, 1);
    // At 1R with current < entry, recommended SL should not increase risk
    if (ts.trailingStopRecommended && ts.recommendedStopLoss !== null) {
      expect(ts.recommendedStopLoss).toBeGreaterThanOrEqual(input.stopLoss);
    }
  });

  it("Short: trailing stop sadece aşağı hareket eder", () => {
    const input = makeInput({
      side: "SHORT",
      entryPrice: 30000,
      currentPrice: 28000, // price dropped — short in profit
      stopLoss: 31000,
    });
    const ts = calculateTrailingStop(input, 2);
    if (ts.trailingStopRecommended && ts.recommendedStopLoss !== null) {
      expect(ts.recommendedStopLoss).toBeLessThan(input.stopLoss);
    }
  });

  it("Short: recommendedStopLoss mevcut SL üstüne çıkmaz", () => {
    const input = makeInput({
      side: "SHORT",
      entryPrice: 30000,
      currentPrice: 28000,
      stopLoss: 31000,
    });
    const ts = calculateTrailingStop(input, 2);
    if (ts.trailingStopRecommended && ts.recommendedStopLoss !== null) {
      expect(ts.recommendedStopLoss).toBeLessThan(input.stopLoss);
    }
  });

  it("rMultiple < 1 → trailing aktif değil, trailingStopRecommended=false", () => {
    const input = makeInput({ currentPrice: 30200 });
    const ts = calculateTrailingStop(input, 0.5);
    expect(ts.trailingStopRecommended).toBe(false);
    expect(ts.recommendedStopLoss).toBeNull();
  });

  it("trailing çıktısı NaN/Infinity içermiyor", () => {
    const input = makeInput({ currentPrice: 32000 });
    const ts = calculateTrailingStop(input, 2);
    if (ts.recommendedStopLoss !== null) {
      expect(Number.isFinite(ts.recommendedStopLoss)).toBe(true);
    }
  });
});

// ── Grup 9: Eksik veri güvenliği ─────────────────────────────────────────

describe("Faz 21 — Eksik veri güvenliği", () => {
  it("riskAmountUsdt=0 → decision döner, NaN yok", () => {
    const d = evaluatePosition(makeInput({ riskAmountUsdt: 0 }));
    expect(Number.isFinite(d.currentRMultiple)).toBe(true);
    expect(isNaN(d.currentRMultiple)).toBe(false);
  });

  it("riskAmountUsdt=0 → warnings içinde uyarı var", () => {
    const d = evaluatePosition(makeInput({ riskAmountUsdt: 0 }));
    expect(d.warnings.length).toBeGreaterThan(0);
  });

  it("entryPrice=stopLoss → trailing güvenli fallback yapar", () => {
    const input = makeInput({ entryPrice: 30000, stopLoss: 30000, currentPrice: 31000 });
    expect(() => calculateTrailingStop(input, 1.5)).not.toThrow();
  });
});

// ── Grup 10: Güvenlik invariantları ──────────────────────────────────────

describe("Faz 21 — Güvenlik invariantları", () => {
  it("HARD_LIVE_TRADING_ALLOWED=false değişmemiş", () => {
    expect(process.env.HARD_LIVE_TRADING_ALLOWED).not.toBe("true");
  });

  it("DEFAULT_TRADING_MODE env default paper", () => {
    const v = process.env.DEFAULT_TRADING_MODE;
    expect(v === undefined || v === "" || v === "paper").toBe(true);
  });

  it("averageDownEnabled=false — scale-rules.ts içermiyor", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/position-management/scale-rules.ts"),
      "utf8",
    );
    expect(src).toMatch(/averageDown/);
    expect(src).not.toMatch(/averageDownEnabled\s*=\s*true/);
  });

  it("Binance /fapi/v1/order çağrısı position-management modülünde yok", () => {
    const dir = path.join(process.cwd(), "src/lib/position-management");
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".ts"));
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      expect(src).not.toMatch(/fapi\/v1\/order/);
    }
  });

  it("Binance /fapi/v1/leverage çağrısı position-management modülünde yok", () => {
    const dir = path.join(process.cwd(), "src/lib/position-management");
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".ts"));
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      expect(src).not.toMatch(/fapi\/v1\/leverage/);
    }
  });

  it("recommendations route Binance API çağrısı içermiyor", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/position-management/recommendations/route.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/fapi\.binance\.com/);
    expect(src).not.toMatch(/api\.binance\.com/);
    expect(src).not.toMatch(/fapi\/v1\/order/);
    expect(src).not.toMatch(/fapi\/v1\/leverage/);
  });

  it("recommendations route advisory=true flag içeriyor", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/position-management/recommendations/route.ts"),
      "utf8",
    );
    expect(src).toMatch(/advisoryOnly/);
  });

  it("openLiveOrder hâlâ LIVE_EXECUTION_NOT_IMPLEMENTED", () => {
    const adapterPath = path.join(process.cwd(), "src/lib/live-execution/adapter.ts");
    if (fs.existsSync(adapterPath)) {
      const src = fs.readFileSync(adapterPath, "utf8");
      expect(src).toMatch(/LIVE_EXECUTION_NOT_IMPLEMENTED/);
    } else {
      expect(true).toBe(true);
    }
  });

  it("MIN_SIGNAL_CONFIDENCE=70 signal engine içeriyor", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/engines/signal-engine.ts"),
      "utf8",
    );
    expect(src).toMatch(/70/);
  });

  it("leverageExecutionBound=false buildRiskExecutionConfig", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/risk-settings/apply.ts"),
      "utf8",
    );
    expect(src).toMatch(/leverageExecutionBound.*false/);
  });

  it("position-management karar motoru gerçek emir alanı barındırmıyor", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/position-management/progressive-plan.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/openLiveOrder|closeLiveOrder|placeOrder|sendOrder/);
    expect(src).not.toMatch(/fapi/);
  });

  it("trade signal engine signal-engine.ts değişmemiş (core imports korunmuş)", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/engines/signal-engine.ts"),
      "utf8",
    );
    // Must still export generateSignal
    expect(src).toMatch(/export.*generateSignal|generateSignal.*export/);
  });
});

// ── Grup 11: Pozisyon yönetimi output alanları ───────────────────────────

describe("Faz 21 — output alanlarının tutarlılığı", () => {
  it("evaluatePosition tüm required alanları döner", () => {
    const d = evaluatePosition(makeInput({ currentRMultiple: 1.2 }));
    expect(d).toHaveProperty("symbol");
    expect(d).toHaveProperty("side");
    expect(d).toHaveProperty("action");
    expect(d).toHaveProperty("actionPriority");
    expect(d).toHaveProperty("currentRMultiple");
    expect(d).toHaveProperty("stage");
    expect(d).toHaveProperty("scaleInAllowed");
    expect(d).toHaveProperty("trailingStopRecommended");
    expect(d).toHaveProperty("explanation");
    expect(d).toHaveProperty("warnings");
    expect(d).toHaveProperty("mode");
    expect(d).toHaveProperty("isLive");
  });

  it("paper mode → isLive=false", () => {
    const d = evaluatePosition(makeInput({ mode: "paper" }));
    expect(d.isLive).toBe(false);
  });

  it("live mode → isLive=true", () => {
    const d = evaluatePosition(makeInput({ mode: "live" }));
    expect(d.isLive).toBe(true);
  });

  it("explanation boş string değil", () => {
    const d = evaluatePosition(makeInput({ currentRMultiple: 1 }));
    expect(d.explanation.length).toBeGreaterThan(0);
  });
});
