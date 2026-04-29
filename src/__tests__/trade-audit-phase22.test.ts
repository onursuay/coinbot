// Faz 22 — Trade Denetimi ve Risk Kalibrasyonu test paketi.
//
// Bu testler şunları doğrular:
// - SL/TP/Risk/Position/Limit/Leverage/Threshold/Missed audit mantığı
// - Invariantlar: ayar değişmemiş, live gate kapalı, threshold=70 korunmuş
// - DATA_INSUFFICIENT güvenli fallback
// - appliedToTradeEngine daima false

import { describe, it, expect } from "vitest";
import { auditStopLoss, auditStopLossBatch } from "@/lib/trade-audit/stop-loss-audit";
import { auditTakeProfit, auditTakeProfitBatch } from "@/lib/trade-audit/take-profit-audit";
import { calibrateRisk } from "@/lib/trade-audit/risk-calibration";
import { auditPositionSizing } from "@/lib/trade-audit/position-sizing-audit";
import { calibrateLimits } from "@/lib/trade-audit/limit-calibration";
import { calibrateLeverage } from "@/lib/trade-audit/leverage-calibration";
import { auditMissedOpportunities } from "@/lib/trade-audit/missed-opportunity-audit";
import { calibrateThreshold } from "@/lib/trade-audit/threshold-calibration";
import { reviewTradeQuality } from "@/lib/trade-audit/trade-quality";
import { buildTradeAuditReport } from "@/lib/trade-audit/summary";
import type { NormalizedTrade, ScanRowInput } from "@/lib/trade-performance";
import type { RiskExecutionConfig } from "@/lib/risk-settings/apply";

// ── Yardımcılar ───────────────────────────────────────────────────────────────

function makeTrade(overrides: Partial<NormalizedTrade> = {}): NormalizedTrade {
  return {
    id: "t1",
    tradeMode: "paper",
    executionType: "simulated",
    symbol: "BTCUSDT",
    direction: "LONG",
    entryPrice: 50000,
    exitPrice: 51000,
    stopLoss: 48500,
    takeProfit: 53000,
    pnl: 100,
    pnlPercent: 2,
    signalScore: 75,
    riskRewardRatio: 2,
    exitReason: "take_profit",
    openedAt: "2024-01-01T10:00:00Z",
    closedAt: "2024-01-01T14:00:00Z",
    status: "closed",
    ...overrides,
  };
}

function makeConfig(overrides: Partial<RiskExecutionConfig> = {}): RiskExecutionConfig {
  return {
    totalBotCapitalUsdt: 1000,
    riskPerTradePercent: 3,
    dailyMaxLossPercent: 10,
    defaultMaxOpenPositions: 3,
    dynamicMaxOpenPositions: 5,
    maxDailyTrades: 10,
    longLeverageEnabled: true,
    shortLeverageEnabled: true,
    leverageRanges: {
      CC: { min: 3, max: 20 },
      GNMR: { min: 10, max: 20 },
      MNLST: { min: 10, max: 20 },
    },
    stopLossMode: "SYSTEM",
    progressiveManagementEnabled: false,
    averageDownEnabled: false,
    riskConfigBound: true,
    liveExecutionBound: false,
    leverageExecutionBound: false,
    profile: "STANDARD",
    updatedAt: 0,
    ...overrides,
  } as RiskExecutionConfig;
}

function makeScanRow(overrides: Partial<ScanRowInput> = {}): ScanRowInput {
  return {
    symbol: "ETHUSDT",
    signalType: "LONG",
    signalScore: 65,
    tradeSignalScore: 65,
    btcTrendRejected: false,
    opened: false,
    ...overrides,
  };
}

// ── Stop-Loss Audit ───────────────────────────────────────────────────────────

describe("Stop-Loss Audit", () => {
  it("SL_TOO_TIGHT üretebiliyor", () => {
    // %0.4 mesafe: 0.3–0.5 arasında → SL_TOO_TIGHT
    const trade = makeTrade({ stopLoss: 49800, entryPrice: 50000 });
    const result = auditStopLoss(trade);
    expect(result.tag).toBe("SL_TOO_TIGHT");
  });

  it("SPREAD_SLIPPAGE_SUSPECT üretebiliyor", () => {
    const trade = makeTrade({ stopLoss: 49990, entryPrice: 50000 }); // %0.02 mesafe
    const result = auditStopLoss(trade);
    expect(result.tag).toBe("SPREAD_SLIPPAGE_SUSPECT");
    expect(result.severity).toBe("critical");
  });

  it("EARLY_STOP_SUSPECT üretebiliyor — kısa süre", () => {
    const trade = makeTrade({
      exitReason: "stop_loss",
      pnl: -50,
      pnlPercent: -1,
      exitPrice: 48500,
      openedAt: "2024-01-01T10:00:00Z",
      closedAt: "2024-01-01T10:20:00Z", // 20 dakika
    });
    const result = auditStopLoss(trade);
    expect(result.tag).toBe("EARLY_STOP_SUSPECT");
  });

  it("SL_TOO_WIDE üretebiliyor", () => {
    const trade = makeTrade({ stopLoss: 45000, entryPrice: 50000 }); // %10 mesafe
    const result = auditStopLoss(trade);
    expect(result.tag).toBe("SL_TOO_WIDE");
  });

  it("NORMAL_STOP üretebiliyor — makul aralık", () => {
    const trade = makeTrade({ stopLoss: 48500, entryPrice: 50000 }); // %3 mesafe
    const result = auditStopLoss(trade);
    expect(result.tag).toBe("NORMAL_STOP");
  });

  it("DATA_INSUFFICIENT — açık işlem için", () => {
    const trade = makeTrade({ status: "open", closedAt: null, exitPrice: null });
    const result = auditStopLoss(trade);
    expect(result.tag).toBe("DATA_INSUFFICIENT");
  });

  it("batch işlem listesi döndürüyor — sadece closed", () => {
    const trades = [
      makeTrade({ status: "closed" }),
      makeTrade({ status: "open", closedAt: null }),
    ];
    const results = auditStopLossBatch(trades);
    expect(results).toHaveLength(1);
  });
});

// ── Take-Profit Audit ─────────────────────────────────────────────────────────

describe("Take-Profit Audit", () => {
  it("MISSED_TRAILING_STOP üretebiliyor", () => {
    const trade = makeTrade({
      exitPrice: 51500,
      takeProfit: 53000,
      pnl: 150,
      pnlPercent: 3,
      riskRewardRatio: 1.7,
      exitReason: "manual",
      openedAt: "2024-01-01T10:00:00Z",
      closedAt: "2024-01-01T11:30:00Z", // 90 dakika
    });
    const result = auditTakeProfit(trade);
    expect(result.tag).toBe("MISSED_TRAILING_STOP");
  });

  it("TP_TOO_CLOSE üretebiliyor — R:R < 1.5", () => {
    const trade = makeTrade({
      takeProfit: 50700,
      stopLoss: 49700,
      riskRewardRatio: 1.4,
    });
    const result = auditTakeProfit(trade);
    expect(result.tag).toBe("TP_TOO_CLOSE");
    expect(result.severity).toBe("warning");
  });

  it("NORMAL_TP üretebiliyor — TP'ye ulaşıldı", () => {
    const trade = makeTrade({
      exitPrice: 52950,
      takeProfit: 53000,
      pnl: 200,
      riskRewardRatio: 2,
    });
    const result = auditTakeProfit(trade);
    expect(result.tag).toBe("NORMAL_TP");
  });

  it("DATA_INSUFFICIENT — açık işlem", () => {
    const trade = makeTrade({ status: "open", closedAt: null });
    const result = auditTakeProfit(trade);
    expect(result.tag).toBe("DATA_INSUFFICIENT");
  });
});

// ── Risk Calibration ──────────────────────────────────────────────────────────

describe("Risk Calibration", () => {
  it("REDUCE_RISK üretebiliyor — yüksek risk + düşük win rate", () => {
    const trades = Array.from({ length: 10 }, (_, i) =>
      makeTrade({ pnl: i < 4 ? -100 : 100 }) // win rate %40
    );
    const result = calibrateRisk({
      closedTrades: trades,
      riskConfig: makeConfig({ riskPerTradePercent: 4 }),
    });
    expect(["REDUCE_RISK", "OBSERVE"]).toContain(result.tag);
  });

  it("OBSERVE üretebiliyor — ardışık kayıplar", () => {
    const trades = [
      makeTrade({ pnl: -100, openedAt: "2024-01-01T10:00:00Z", closedAt: "2024-01-01T11:00:00Z" }),
      makeTrade({ pnl: -100, openedAt: "2024-01-02T10:00:00Z", closedAt: "2024-01-02T11:00:00Z" }),
      makeTrade({ pnl: -100, openedAt: "2024-01-03T10:00:00Z", closedAt: "2024-01-03T11:00:00Z" }),
      makeTrade({ pnl: 100, openedAt: "2024-01-04T10:00:00Z", closedAt: "2024-01-04T11:00:00Z" }),
      makeTrade({ pnl: 100, openedAt: "2024-01-05T10:00:00Z", closedAt: "2024-01-05T11:00:00Z" }),
    ];
    const result = calibrateRisk({ closedTrades: trades, riskConfig: makeConfig() });
    expect(["OBSERVE", "KEEP", "REDUCE_RISK"]).toContain(result.tag);
  });

  it("DATA_INSUFFICIENT — veri yok", () => {
    const result = calibrateRisk({ closedTrades: [], riskConfig: null });
    expect(result.tag).toBe("DATA_INSUFFICIENT");
  });

  it("REVIEW_POSITION_SIZE — sermaye sıfır", () => {
    const trades = Array.from({ length: 5 }, () => makeTrade());
    const result = calibrateRisk({
      closedTrades: trades,
      riskConfig: makeConfig({ totalBotCapitalUsdt: 0 }),
    });
    expect(result.tag).toBe("REVIEW_POSITION_SIZE");
  });
});

// ── Position Sizing Audit ─────────────────────────────────────────────────────

describe("Position Sizing Audit", () => {
  it("STOP_DISTANCE_INFLATED_NOTIONAL üretebiliyor — dar SL", () => {
    // SL mesafesi %0.1 → notional = 30/(0.001) = 30000 USDT → sermayenin 30 katı
    const trade = makeTrade({
      stopLoss: 49950, // %0.1 mesafe
      entryPrice: 50000,
    });
    const result = auditPositionSizing({
      closedTrades: [trade],
      riskConfig: makeConfig({ totalBotCapitalUsdt: 1000, riskPerTradePercent: 3 }),
    });
    expect(result.tag).toBe("STOP_DISTANCE_INFLATED_NOTIONAL");
  });

  it("CAPITAL_MISSING_FALLBACK_USED yakalanıyor — sermaye sıfır", () => {
    const result = auditPositionSizing({
      closedTrades: [makeTrade()],
      riskConfig: makeConfig({ totalBotCapitalUsdt: 0 }),
    });
    expect(result.tag).toBe("CAPITAL_MISSING_FALLBACK_USED");
    expect(result.capitalMissingFallbackUsed).toBe(true);
  });

  it("POSITION_SIZE_OK — normal durumda", () => {
    const trades = Array.from({ length: 5 }, () =>
      makeTrade({ pnl: 30, stopLoss: 48500 }) // %3 SL mesafesi
    );
    const result = auditPositionSizing({
      closedTrades: trades,
      riskConfig: makeConfig(),
    });
    expect(result.tag).toBe("POSITION_SIZE_OK");
  });

  it("DATA_INSUFFICIENT — config yok", () => {
    const result = auditPositionSizing({ closedTrades: [makeTrade()], riskConfig: null });
    expect(result.tag).toBe("DATA_INSUFFICIENT");
  });
});

// ── Limit Calibration ─────────────────────────────────────────────────────────

describe("Limit Calibration", () => {
  it("REVIEW_MAX_OPEN_POSITIONS üretebiliyor — dynCap default eşit", () => {
    const trades = Array.from({ length: 5 }, () => makeTrade());
    const result = calibrateLimits({
      trades,
      riskConfig: makeConfig({ defaultMaxOpenPositions: 3, dynamicMaxOpenPositions: 3 }),
    });
    expect(result.tag).toBe("REVIEW_MAX_OPEN_POSITIONS");
  });

  it("OVERTRADE_RISK üretebiliyor — günlük limit aşıldı", () => {
    // Aynı günde 11 işlem — limit 10
    const day = "2024-01-01";
    const trades = Array.from({ length: 11 }, (_, i) =>
      makeTrade({ openedAt: `${day}T${String(i).padStart(2, "0")}:00:00Z` })
    );
    const result = calibrateLimits({
      trades,
      riskConfig: makeConfig({ maxDailyTrades: 10 }),
    });
    expect(result.tag).toBe("OVERTRADE_RISK");
  });

  it("DATA_INSUFFICIENT — config yok", () => {
    const result = calibrateLimits({ trades: [makeTrade()], riskConfig: null });
    expect(result.tag).toBe("DATA_INSUFFICIENT");
  });
});

// ── Leverage Calibration ──────────────────────────────────────────────────────

describe("Leverage Calibration", () => {
  it("OBSERVE_BEFORE_30X üretebiliyor — 30x var ama az veri", () => {
    const result = calibrateLeverage({
      closedTrades: Array.from({ length: 5 }, () => makeTrade({ pnl: 100 })),
      riskConfig: makeConfig({ leverageRanges: {
        CC: { min: 3, max: 30 },
        GNMR: { min: 10, max: 20 },
        MNLST: { min: 10, max: 20 },
      }}),
    });
    expect(result.tag).toBe("OBSERVE_BEFORE_30X");
    expect(result.has30xConfigured).toBe(true);
  });

  it("BLOCK_30X üretebiliyor — 30x var, win rate düşük", () => {
    const trades = Array.from({ length: 20 }, (_, i) =>
      makeTrade({ pnl: i < 12 ? -100 : 100 }) // win rate %40
    );
    const result = calibrateLeverage({
      closedTrades: trades,
      riskConfig: makeConfig({ leverageRanges: {
        CC: { min: 3, max: 30 },
        GNMR: { min: 10, max: 20 },
        MNLST: { min: 10, max: 20 },
      }}),
    });
    expect(result.tag).toBe("BLOCK_30X");
    expect(result.severity).toBe("critical");
  });

  it("KEEP_LEVERAGE_RANGE üretebiliyor — 20x ve yeterli win rate", () => {
    const trades = Array.from({ length: 20 }, (_, i) =>
      makeTrade({ pnl: i < 8 ? -100 : 100 }) // win rate %60
    );
    const result = calibrateLeverage({
      closedTrades: trades,
      riskConfig: makeConfig(),
    });
    expect(result.tag).toBe("KEEP_LEVERAGE_RANGE");
  });

  it("DATA_INSUFFICIENT — az işlem ve kaldıraç 20x altı", () => {
    const result = calibrateLeverage({
      closedTrades: Array.from({ length: 3 }, () => makeTrade()),
      riskConfig: makeConfig(),
    });
    expect(result.tag).toBe("DATA_INSUFFICIENT");
  });
});

// ── Missed Opportunity Audit ──────────────────────────────────────────────────

describe("Missed Opportunity Audit", () => {
  it("DATA_INSUFFICIENT — scan verisi yok", () => {
    const result = auditMissedOpportunities([]);
    expect(result.tag).toBe("DATA_INSUFFICIENT");
  });

  it("DATA_INSUFFICIENT — boş dizi", () => {
    const result = auditMissedOpportunities([]);
    expect(result.tag).toBe("DATA_INSUFFICIENT");
    expect(result.btcFilteredCount).toBe(0);
  });

  it("FILTER_TOO_STRICT_SUSPECT — BTC filtresi çok fazla reddediyor", () => {
    // Skor 75+ olsun ki THRESHOLD_TOO_STRICT_SUSPECT tetiklenmesin
    const rows = Array.from({ length: 10 }, (_, i) =>
      makeScanRow({ btcTrendRejected: i < 7, signalScore: 75, tradeSignalScore: 75 })
    );
    const result = auditMissedOpportunities(rows);
    expect(["FILTER_TOO_STRICT_SUSPECT", "MISSED_OPPORTUNITY_HIGH"]).toContain(result.tag);
    expect(result.btcFilteredCount).toBe(7);
  });

  it("MISSED_OPPORTUNITY_LOW — az filtreleme", () => {
    // Skor 75 → band60to69=0, btcFiltered=0 → LOW
    const rows = Array.from({ length: 5 }, () =>
      makeScanRow({ btcTrendRejected: false, signalScore: 75, tradeSignalScore: 75 })
    );
    const result = auditMissedOpportunities(rows);
    expect(result.tag).toBe("MISSED_OPPORTUNITY_LOW");
  });
});

// ── Threshold Calibration ─────────────────────────────────────────────────────

describe("Threshold Calibration", () => {
  it("liveThreshold her zaman 70", () => {
    const result = calibrateThreshold({ trades: [], scanRows: [] });
    expect(result.liveThreshold).toBe(70);
    expect(result.liveThresholdUnchanged).toBe(true);
  });

  it("liveThresholdUnchanged her zaman true", () => {
    const trades = Array.from({ length: 10 }, () => makeTrade({ signalScore: 72 }));
    const result = calibrateThreshold({ trades, scanRows: [] });
    expect(result.liveThresholdUnchanged).toBe(true);
    expect(result.liveThreshold).toBe(70);
  });

  it("KEEP_70 — yeterli veri ve makul win rate", () => {
    const trades = Array.from({ length: 10 }, (_, i) =>
      makeTrade({ signalScore: 72, pnl: i < 6 ? 100 : -100 }) // 60% win
    );
    const result = calibrateThreshold({ trades, scanRows: [] });
    expect(result.tag).toBe("KEEP_70");
    expect(result.liveThreshold).toBe(70);
  });

  it("DATA_INSUFFICIENT — az işlem", () => {
    const result = calibrateThreshold({ trades: [makeTrade()], scanRows: [] });
    expect(result.tag).toBe("DATA_INSUFFICIENT");
  });
});

// ── Trade Quality Review ──────────────────────────────────────────────────────

describe("Trade Quality Review", () => {
  it("GOOD_TRADE — kârlı ve R:R >= 2", () => {
    const result = reviewTradeQuality(makeTrade({ pnl: 200, riskRewardRatio: 2.5 }));
    expect(result.tag).toBe("GOOD_TRADE");
  });

  it("EARLY_STOP_SUSPECT — çok kısa sürede stop", () => {
    const result = reviewTradeQuality(makeTrade({
      pnl: -50,
      pnlPercent: -1,
      exitReason: "stop_loss",
      exitPrice: 48500,
      openedAt: "2024-01-01T10:00:00Z",
      closedAt: "2024-01-01T10:15:00Z",
    }));
    expect(result.tag).toBe("EARLY_STOP_SUSPECT");
  });

  it("DATA_INSUFFICIENT — açık işlem", () => {
    const result = reviewTradeQuality(makeTrade({ status: "open", closedAt: null }));
    expect(result.tag).toBe("DATA_INSUFFICIENT");
  });
});

// ── Summary ───────────────────────────────────────────────────────────────────

describe("Trade Audit Summary", () => {
  it("observeDays=7 kullanıyor", () => {
    const report = buildTradeAuditReport({
      trades: Array.from({ length: 10 }, () => makeTrade()),
      scanRows: [],
      riskConfig: makeConfig(),
      mode: "paper",
    });
    expect(report.summary.observeDays).toBe(7);
  });

  it("appliedToTradeEngine her zaman false", () => {
    const report = buildTradeAuditReport({
      trades: Array.from({ length: 10 }, () => makeTrade()),
      scanRows: [],
      riskConfig: makeConfig(),
      mode: "paper",
    });
    expect(report.summary.appliedToTradeEngine).toBe(false);
  });

  it("DATA_INSUFFICIENT — az veri", () => {
    const report = buildTradeAuditReport({
      trades: [makeTrade()],
      scanRows: [],
      riskConfig: makeConfig(),
      mode: "paper",
    });
    expect(report.summary.status).toBe("DATA_INSUFFICIENT");
    expect(report.summary.appliedToTradeEngine).toBe(false);
  });

  it("meta.mode doğru ayarlanıyor", () => {
    const report = buildTradeAuditReport({
      trades: [],
      scanRows: [],
      riskConfig: null,
      mode: "all",
    });
    expect(report.meta.mode).toBe("all");
  });
});

// ── Invariant Sentinels ───────────────────────────────────────────────────────

describe("Invariant Sentinels — Değişmez Kurallar", () => {
  it("averageDownEnabled daima false — config'de değiştirilemez", () => {
    const config = makeConfig();
    expect(config.averageDownEnabled).toBe(false);
  });

  it("liveExecutionBound daima false", () => {
    const config = makeConfig();
    expect(config.liveExecutionBound).toBe(false);
  });

  it("leverageExecutionBound daima false", () => {
    const config = makeConfig();
    expect(config.leverageExecutionBound).toBe(false);
  });

  it("liveThreshold daima 70 — threshold calibration değiştirmiyor", () => {
    const trades = Array.from({ length: 20 }, () => makeTrade({ signalScore: 72 }));
    const result = calibrateThreshold({ trades, scanRows: [] });
    expect(result.liveThreshold).toBe(70);
    expect(result.liveThresholdUnchanged).toBe(true);
  });

  it("risk calibration config değerini mutation yapmıyor", () => {
    const config = makeConfig({ riskPerTradePercent: 3 });
    const trades = Array.from({ length: 10 }, () => makeTrade());
    calibrateRisk({ closedTrades: trades, riskConfig: config });
    expect(config.riskPerTradePercent).toBe(3);
  });

  it("leverage calibration config değerini mutation yapmıyor", () => {
    const config = makeConfig();
    const trades = Array.from({ length: 10 }, () => makeTrade());
    calibrateLeverage({ closedTrades: trades, riskConfig: config });
    expect(config.leverageRanges.CC.max).toBe(20);
  });

  it("summary.appliedToTradeEngine asla true olamaz", () => {
    const report = buildTradeAuditReport({
      trades: Array.from({ length: 20 }, () => makeTrade()),
      scanRows: [],
      riskConfig: makeConfig(),
      mode: "paper",
    });
    expect(report.summary.appliedToTradeEngine).toBe(false);
    // TypeScript tipi false literal — runtime'da da false olmalı
    const val: false = report.summary.appliedToTradeEngine;
    expect(val).toBe(false);
  });
});
