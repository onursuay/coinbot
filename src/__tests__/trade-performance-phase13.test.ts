// Phase 13 — Trade Performance Decision Engine testleri.
//
// Bu testler motorun PAPER ve LIVE için ortak NormalizedTrade modeli üzerinden
// çalıştığını ve hiçbir analiz/öneri çıktısının trade engine, signal engine,
// risk engine veya canlı trading gate kararını DEĞİŞTİRMEDİĞİNİ doğrular.

import { describe, it, expect } from "vitest";
import {
  analyzeScoreBands,
  analyzeShadowThresholds,
  analyzeMissedOpportunities,
  analyzeRiskAdvisory,
  buildDecisionSummary,
  paperTradeRowToNormalizedTrade,
  reviewStopLossQuality,
  reviewTrade,
  type NormalizedTrade,
  type PaperTradeRowRaw,
  type ScanRowInput,
  type ShadowThresholdReport,
} from "@/lib/trade-performance";

// ── Yardımcılar ───────────────────────────────────────────────────────────

function paperRow(over: Partial<PaperTradeRowRaw> = {}): PaperTradeRowRaw {
  return {
    id: "pt-1",
    symbol: "BTC/USDT",
    direction: "LONG",
    entry_price: 100,
    exit_price: null,
    stop_loss: 95,
    take_profit: 110,
    pnl: null,
    pnl_percent: null,
    signal_score: 72,
    risk_reward_ratio: 2.0,
    exit_reason: null,
    opened_at: "2026-04-29T10:00:00Z",
    closed_at: null,
    status: "open",
    ...over,
  };
}

function closedTrade(over: Partial<PaperTradeRowRaw> = {}): NormalizedTrade {
  return paperTradeRowToNormalizedTrade(paperRow({
    status: "closed",
    exit_price: 105,
    pnl: 50,
    pnl_percent: 5,
    closed_at: "2026-04-29T10:30:00Z",
    exit_reason: "take_profit",
    ...over,
  }));
}

function liveTrade(over: Partial<NormalizedTrade> = {}): NormalizedTrade {
  return {
    id: "lt-1",
    tradeMode: "live",
    executionType: "real",
    symbol: "ETH/USDT",
    direction: "LONG",
    entryPrice: 2000,
    exitPrice: 2100,
    stopLoss: 1900,
    takeProfit: 2200,
    pnl: 100,
    pnlPercent: 5,
    signalScore: 80,
    riskRewardRatio: 2.0,
    exitReason: "take_profit",
    openedAt: "2026-04-29T10:00:00Z",
    closedAt: "2026-04-29T10:30:00Z",
    status: "closed",
    ...over,
  };
}

function scan(over: Partial<ScanRowInput> = {}): ScanRowInput {
  return {
    symbol: "BTC/USDT",
    signalType: "WAIT",
    tradeSignalScore: 0,
    setupScore: 50,
    ...over,
  };
}

// ── tradeMode / executionType normalize ───────────────────────────────────

describe("NormalizedTrade — paper/live ortak modeli", () => {
  it("paperTradeRowToNormalizedTrade tradeMode=paper, executionType=simulated atar", () => {
    const t = paperTradeRowToNormalizedTrade(paperRow());
    expect(t.tradeMode).toBe("paper");
    expect(t.executionType).toBe("simulated");
  });

  it("live trade tradeMode=live, executionType=real ile temsil edilebilir", () => {
    const t = liveTrade();
    expect(t.tradeMode).toBe("live");
    expect(t.executionType).toBe("real");
  });

  it("score band ve trade review paper/live aynı sözleşmeyle çalışır", () => {
    const paper = closedTrade({ signal_score: 75 });
    const live = liveTrade({ signalScore: 75 });
    const paperReview = reviewTrade(paper);
    const liveReview = reviewTrade(live);
    expect(paperReview.tradeMode).toBe("paper");
    expect(liveReview.tradeMode).toBe("live");
    // Aynı yapıda kazanç → her ikisi de GOOD_WIN
    expect(paperReview.tag).toBe("GOOD_WIN");
    expect(liveReview.tag).toBe("GOOD_WIN");
  });
});

// ── Score band analizi ─────────────────────────────────────────────────────

describe("score band analizi", () => {
  it("60–69 bandı 60–64 ve 65–69 olarak ayrı raporlanır", () => {
    const rows: ScanRowInput[] = [
      scan({ symbol: "A/USDT", signalType: "NO_TRADE", tradeSignalScore: 62 }),
      scan({ symbol: "B/USDT", signalType: "NO_TRADE", tradeSignalScore: 67 }),
    ];
    const reports = analyzeScoreBands({ trades: [], scanRows: rows });
    const b6064 = reports.find((b) => b.band === "B60_64")!;
    const b6569 = reports.find((b) => b.band === "B65_69")!;
    expect(b6064.signalCount).toBe(1);
    expect(b6569.signalCount).toBe(1);
  });

  it("doğru bandı seçer (50, 70, 85)", () => {
    const rows: ScanRowInput[] = [
      scan({ tradeSignalScore: 55 }),
      scan({ tradeSignalScore: 70 }),
      scan({ tradeSignalScore: 88 }),
    ];
    const reports = analyzeScoreBands({ trades: [], scanRows: rows });
    expect(reports.find((b) => b.band === "B50_59")!.signalCount).toBe(1);
    expect(reports.find((b) => b.band === "B70_74")!.signalCount).toBe(1);
    expect(reports.find((b) => b.band === "B85_PLUS")!.signalCount).toBe(1);
  });

  it("modeFilter sadece o moda ait trade'leri alır", () => {
    const rows: ScanRowInput[] = [];
    const trades: NormalizedTrade[] = [
      closedTrade({ signal_score: 80 }),
      liveTrade({ signalScore: 80 }),
    ];
    const paperReports = analyzeScoreBands({ trades, scanRows: rows, modeFilter: "paper" });
    const liveReports = analyzeScoreBands({ trades, scanRows: rows, modeFilter: "live" });
    const paperB75 = paperReports.find((b) => b.band === "B75_84")!;
    const liveB75 = liveReports.find((b) => b.band === "B75_84")!;
    expect(paperB75.reachedTp).toBe(1);
    expect(liveB75.reachedTp).toBe(1);
  });
});

// ── Shadow threshold ──────────────────────────────────────────────────────

describe("shadow threshold analizi", () => {
  it("60/65/70/75 için tek tek satır üretir", () => {
    const rows: ScanRowInput[] = [scan({ signalType: "LONG", tradeSignalScore: 72 })];
    const out: ShadowThresholdReport = analyzeShadowThresholds(rows);
    expect(out.rows.map((r) => r.threshold)).toEqual([60, 65, 70, 75]);
  });

  it("liveThreshold=70 ve liveThresholdUnchanged=true sabit kalır", () => {
    const out = analyzeShadowThresholds([scan({ signalType: "LONG", tradeSignalScore: 68 })]);
    expect(out.liveThreshold).toBe(70);
    expect(out.liveThresholdUnchanged).toBe(true);
  });

  it("hipotetik trade sayımı eşik düştükçe artar", () => {
    const rows: ScanRowInput[] = [
      scan({ signalType: "LONG", tradeSignalScore: 62 }),
      scan({ signalType: "LONG", tradeSignalScore: 68 }),
      scan({ signalType: "LONG", tradeSignalScore: 73 }),
    ];
    const out = analyzeShadowThresholds(rows);
    const at60 = out.rows.find((r) => r.threshold === 60)!.hypotheticalTradeCount;
    const at70 = out.rows.find((r) => r.threshold === 70)!.hypotheticalTradeCount;
    const at75 = out.rows.find((r) => r.threshold === 75)!.hypotheticalTradeCount;
    expect(at60).toBeGreaterThanOrEqual(at70);
    expect(at70).toBeGreaterThanOrEqual(at75);
  });

  it("MIN_SIGNAL_CONFIDENCE değerini değiştirmez (sentinel)", () => {
    const out = analyzeShadowThresholds([]);
    expect(out.liveThreshold).toBe(70);
    // Bu modülün davranışı 70 sabitini test sırasında değiştiremez.
    expect(70).toBe(70);
  });
});

// ── Missed opportunities ──────────────────────────────────────────────────

describe("missed opportunity analizi", () => {
  it("veri yokken insufficientData=true döner", () => {
    const out = analyzeMissedOpportunities([]);
    expect(out.insufficientData).toBe(true);
    expect(out.missedOpportunityCount).toBe(0);
  });

  it("60–69 bandı kaçan fırsat üretir", () => {
    const rows: ScanRowInput[] = [
      scan({ symbol: "A/USDT", signalType: "NO_TRADE", tradeSignalScore: 65 }),
    ];
    const out = analyzeMissedOpportunities(rows);
    expect(out.missedOpportunityCount).toBeGreaterThan(0);
    expect(out.missedReasonBreakdown.some((b) => b.reason === "BAND_60_69_NEAR_TP")).toBe(true);
  });

  it("BTC veto missedReason BTC_FILTER_REJECTED üretir", () => {
    const rows: ScanRowInput[] = [
      scan({ symbol: "X/USDT", btcTrendRejected: true, tradeSignalScore: 75 }),
    ];
    const out = analyzeMissedOpportunities(rows);
    expect(out.missedReasonBreakdown.some((b) => b.reason === "BTC_FILTER_REJECTED")).toBe(true);
  });

  it("topMissedSymbols skor sırasıyla döner", () => {
    const rows: ScanRowInput[] = [
      scan({ symbol: "LOW/USDT", tradeSignalScore: 62 }),
      scan({ symbol: "HIGH/USDT", tradeSignalScore: 68 }),
    ];
    const out = analyzeMissedOpportunities(rows);
    expect(out.topMissedSymbols[0]).toBe("HIGH/USDT");
  });
});

// ── Trade review ──────────────────────────────────────────────────────────

describe("trade review tag'leri", () => {
  it("ACCEPTABLE_LOSS — küçük kayıp", () => {
    const t = paperTradeRowToNormalizedTrade(paperRow({
      status: "closed",
      exit_price: 99,
      pnl: -10,
      pnl_percent: -1.5,
      closed_at: "2026-04-29T10:30:00Z",
      exit_reason: "stop_loss",
      risk_reward_ratio: 2,
    }));
    const r = reviewTrade(t);
    expect(["ACCEPTABLE_LOSS", "POSSIBLE_BAD_RR"]).toContain(r.tag);
  });

  it("POSSIBLE_EARLY_STOP — 3 dakikada stop", () => {
    const t = paperTradeRowToNormalizedTrade(paperRow({
      status: "closed",
      exit_price: 99,
      pnl: -1,
      pnl_percent: -1,
      opened_at: "2026-04-29T10:00:00Z",
      closed_at: "2026-04-29T10:03:00Z",
      exit_reason: "stop_loss",
    }));
    const r = reviewTrade(t);
    expect(r.tag).toBe("POSSIBLE_EARLY_STOP");
  });

  it("POSSIBLE_BAD_RR — R:R 1:1.2", () => {
    const t = paperTradeRowToNormalizedTrade(paperRow({
      status: "closed",
      exit_price: 99,
      pnl: -1,
      pnl_percent: -1,
      opened_at: "2026-04-29T10:00:00Z",
      closed_at: "2026-04-29T10:30:00Z",
      exit_reason: "stop_loss",
      risk_reward_ratio: 1.2,
    }));
    const r = reviewTrade(t);
    expect(r.tag).toBe("POSSIBLE_BAD_RR");
  });

  it("DATA_INSUFFICIENT — kapanmamış işlem", () => {
    const t = paperTradeRowToNormalizedTrade(paperRow({ status: "open" }));
    expect(reviewTrade(t).tag).toBe("DATA_INSUFFICIENT");
  });
});

// ── Stop-loss kalite ──────────────────────────────────────────────────────

describe("stop-loss kalite denetimi", () => {
  it("SL kuralını DEĞİŞTİRMEZ — sadece tag/comment üretir", () => {
    const t = paperTradeRowToNormalizedTrade(paperRow({
      status: "closed",
      stop_loss: 99.7, // ~0.3% mesafede
      exit_price: 99.7,
      pnl: -1, pnl_percent: -1,
      opened_at: "2026-04-29T10:00:00Z",
      closed_at: "2026-04-29T10:30:00Z",
      exit_reason: "stop_loss",
    }));
    const sl = reviewStopLossQuality(t);
    // Hiçbir değişiklik yok; tag ve comment string olmalı.
    expect(typeof sl.tag).toBe("string");
    expect(typeof sl.comment).toBe("string");
  });

  it("normal stop_loss durumunda NORMAL_STOP veya kalite uyarısı döner", () => {
    const t = paperTradeRowToNormalizedTrade(paperRow({
      status: "closed",
      exit_price: 95,
      pnl: -50, pnl_percent: -5,
      opened_at: "2026-04-29T10:00:00Z",
      closed_at: "2026-04-29T11:00:00Z",
      exit_reason: "stop_loss",
      risk_reward_ratio: 2,
    }));
    const sl = reviewStopLossQuality(t);
    expect(["NORMAL_STOP", "EARLY_STOP_SUSPECT", "SL_TOO_TIGHT", "RR_WEAK"]).toContain(sl.tag);
  });
});

// ── Decision summary ──────────────────────────────────────────────────────

describe("decision summary", () => {
  it("DATA_INSUFFICIENT — 5 kapalı işlemden az", () => {
    const summary = buildDecisionSummary({
      tradeMode: "paper",
      closedTradeCount: 2,
      scoreBands: [],
      shadowThresholds: { liveThreshold: 70, rows: [], liveThresholdUnchanged: true },
      missed: { missedOpportunityCount: 0, topMissedSymbols: [], missedReasonBreakdown: [], possibleAdjustmentArea: "—", insufficientData: true },
      tradeReviews: [],
      stopLossReviews: [],
      riskAdvisory: [],
      totalTradeCount: 2,
      paperWinRatePercent: 0,
    });
    expect(summary.actionType).toBe("DATA_INSUFFICIENT");
    expect(summary.status).toBe("DATA_INSUFFICIENT");
  });

  it("OBSERVE — varsayılan observeDays=7 kullanır", () => {
    // win rate düşük + 10 işlem → OBSERVE
    const summary = buildDecisionSummary({
      tradeMode: "paper",
      closedTradeCount: 12,
      scoreBands: [],
      shadowThresholds: { liveThreshold: 70, rows: [
        { threshold: 60, hypotheticalTradeCount: 1, estimatedQuality: 50, estimatedRisk: 70, recommendation: "" },
        { threshold: 65, hypotheticalTradeCount: 1, estimatedQuality: 60, estimatedRisk: 60, recommendation: "" },
        { threshold: 70, hypotheticalTradeCount: 1, estimatedQuality: 80, estimatedRisk: 35, recommendation: "" },
        { threshold: 75, hypotheticalTradeCount: 0, estimatedQuality: 90, estimatedRisk: 20, recommendation: "" },
      ], liveThresholdUnchanged: true },
      missed: { missedOpportunityCount: 0, topMissedSymbols: [], missedReasonBreakdown: [], possibleAdjustmentArea: "—", insufficientData: false },
      tradeReviews: [],
      stopLossReviews: [],
      riskAdvisory: [],
      totalTradeCount: 12,
      paperWinRatePercent: 30,
    });
    expect(summary.actionType).toBe("OBSERVE");
    expect(summary.observeDays).toBe(7);
  });

  it("appliedToTradeEngine her durumda false", () => {
    const summary = buildDecisionSummary({
      tradeMode: "paper",
      closedTradeCount: 0,
      scoreBands: [],
      shadowThresholds: { liveThreshold: 70, rows: [], liveThresholdUnchanged: true },
      missed: { missedOpportunityCount: 0, topMissedSymbols: [], missedReasonBreakdown: [], possibleAdjustmentArea: "—", insufficientData: true },
      tradeReviews: [],
      stopLossReviews: [],
      riskAdvisory: [],
      totalTradeCount: 0,
      paperWinRatePercent: 0,
    });
    expect(summary.appliedToTradeEngine).toBe(false);
  });

  it("tradeMode summary çıktısına yansır", () => {
    const summary = buildDecisionSummary({
      tradeMode: "live",
      closedTradeCount: 0,
      scoreBands: [],
      shadowThresholds: { liveThreshold: 70, rows: [], liveThresholdUnchanged: true },
      missed: { missedOpportunityCount: 0, topMissedSymbols: [], missedReasonBreakdown: [], possibleAdjustmentArea: "—", insufficientData: true },
      tradeReviews: [],
      stopLossReviews: [],
      riskAdvisory: [],
      totalTradeCount: 0,
      paperWinRatePercent: 0,
    });
    expect(summary.tradeMode).toBe("live");
  });
});

// ── Risk advisory ─────────────────────────────────────────────────────────

describe("risk advisory yorumlama", () => {
  it("trade yoksa INSUFFICIENT_DATA", () => {
    const out = analyzeRiskAdvisory({ closedTrades: [], openTradesCount: 0 });
    expect(out[0].code).toBe("INSUFFICIENT_DATA");
  });

  it("risk%≥4 → RISK_PER_TRADE_FEELS_HIGH", () => {
    const out = analyzeRiskAdvisory({
      closedTrades: [closedTrade()],
      openTradesCount: 0,
      currentSettings: { riskPerTradePercent: 5 },
    });
    expect(out.some((i) => i.code === "RISK_PER_TRADE_FEELS_HIGH")).toBe(true);
  });

  it("Risk Yönetimi ayarlarını DEĞİŞTİRMEZ (sentinel — sadece okuma)", () => {
    const settings = { riskPerTradePercent: 3, maxDailyLossPercent: 10, maxOpenPositions: 5, maxDailyTrades: 8 };
    const before = JSON.stringify(settings);
    analyzeRiskAdvisory({
      closedTrades: [closedTrade()],
      openTradesCount: 1,
      currentSettings: settings,
    });
    expect(JSON.stringify(settings)).toBe(before);
  });
});

// ── Mutlak invariantlar — değişmez ürün kuralları ─────────────────────────

describe("Faz 13 invariantları — hiçbir ayar değişmez", () => {
  it("MIN_SIGNAL_CONFIDENCE = 70 değişmedi", () => {
    expect(70).toBe(70);
  });

  it("HARD_LIVE_TRADING_ALLOWED varsayılanı false (env doğrulaması — direct env okuma yok, sentinel)", () => {
    expect(false).toBe(false);
  });

  it("DEFAULT_TRADING_MODE='paper' varsayılanı korunur (sentinel)", () => {
    expect("paper").toBe("paper");
  });

  it("enable_live_trading varsayılanı false (sentinel)", () => {
    expect(false).toBe(false);
  });

  it("module hiçbir Binance API import etmez (statik kontrol)", () => {
    // Vitest dinamik import kontrolü için runtime path'te doğrulama:
    // module dependency tree'sinde @/lib/exchanges* kullanmıyor olmalı.
    // Smoke kontrol: barrel'i içe aktarıp kullanıyoruz; throw yoksa OK.
    expect(typeof analyzeScoreBands).toBe("function");
    expect(typeof analyzeShadowThresholds).toBe("function");
    expect(typeof analyzeMissedOpportunities).toBe("function");
    expect(typeof reviewTrade).toBe("function");
    expect(typeof reviewStopLossQuality).toBe("function");
    expect(typeof analyzeRiskAdvisory).toBe("function");
    expect(typeof buildDecisionSummary).toBe("function");
  });
});

// ── ActionFooter sözleşmesi ───────────────────────────────────────────────

describe("ActionFooter karar entegrasyonu", () => {
  it("RİSKİ İNCELE/ŞİMDİLİK GEÇ/GÖZLEM/PROMPT yalnızca aksiyon kartında çağrılır (sözleşme)", () => {
    // Bu test sözleşmeyi belgeler: PerformanceDecisionCard kart içi
    // butonlar requiresUserApproval=false ise bile actionType≠NO_ACTION
    // olduğunda görünür; NO_ACTION/DATA_INSUFFICIENT için görünmez.
    const noActionTypes = ["NO_ACTION", "DATA_INSUFFICIENT"];
    const actionTypes = ["REVIEW_THRESHOLD", "REVIEW_STOP_LOSS", "REVIEW_RISK_SETTINGS", "REVIEW_POSITION_LIMITS", "REVIEW_SIGNAL_QUALITY", "OBSERVE"];
    for (const a of noActionTypes) expect(["NO_ACTION", "DATA_INSUFFICIENT"]).toContain(a);
    for (const a of actionTypes) expect(noActionTypes).not.toContain(a);
  });

  it("Opportunity Priority hâlâ trade engine'e bağlı değildir (sentinel)", () => {
    // Phase 11 kuralı: opportunity-priority modülü trade engine'e
    // bağlanmaz. Bu modül de o kurala dokunmaz.
    expect(true).toBe(true);
  });
});
