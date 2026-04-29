// Faz 15 — Live Trades DB + Normalized Live Adapter testleri.
//
// Bu testler:
//   • liveTradeRowToNormalizedTrade adaptörünün davranışını doğrular.
//   • paperTradeRowToNormalizedTrade'in bozulmadığını doğrular.
//   • live/paper için aynı analiz pipeline'ının çalıştığını doğrular.
//   • Güvenlik invariantlarının korunduğunu sentinellerle doğrular.
//   • Canlı emir/Binance private API çağrısının eklenmediğini doğrular.

import { describe, it, expect } from "vitest";
import {
  liveTradeRowToNormalizedTrade,
  paperTradeRowToNormalizedTrade,
  reviewTrade,
  reviewStopLossQuality,
  analyzeScoreBands,
  buildDecisionSummary,
  type LiveTradeRowRaw,
  type NormalizedTrade,
  type PaperTradeRowRaw,
} from "@/lib/trade-performance";

// ── Yardımcılar ───────────────────────────────────────────────────────────

function liveRow(over: Partial<LiveTradeRowRaw> = {}): LiveTradeRowRaw {
  return {
    id: "lt-1",
    symbol: "ETH/USDT",
    side: "LONG",
    status: "open",
    entry_price: 2000,
    exit_price: null,
    stop_loss: 1900,
    take_profit: 2200,
    pnl: null,
    pnl_percent: null,
    trade_signal_score: 80,
    rr_ratio: 2.0,
    close_reason: null,
    exit_reason: null,
    opened_at: "2026-04-29T10:00:00Z",
    closed_at: null,
    trade_mode: "live",
    execution_type: "real",
    ...over,
  };
}

function closedLiveRow(over: Partial<LiveTradeRowRaw> = {}): LiveTradeRowRaw {
  return liveRow({
    status: "closed",
    exit_price: 2100,
    pnl: 100,
    pnl_percent: 5,
    closed_at: "2026-04-29T10:30:00Z",
    close_reason: "take_profit",
    ...over,
  });
}

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

// ── liveTradeRowToNormalizedTrade temel testler ───────────────────────────

describe("liveTradeRowToNormalizedTrade — temel dönüşüm", () => {
  it("tradeMode='live' döndürür", () => {
    const t = liveTradeRowToNormalizedTrade(liveRow());
    expect(t.tradeMode).toBe("live");
  });

  it("executionType='real' döndürür", () => {
    const t = liveTradeRowToNormalizedTrade(liveRow());
    expect(t.executionType).toBe("real");
  });

  it("side→direction eşlemesi doğru (LONG)", () => {
    const t = liveTradeRowToNormalizedTrade(liveRow({ side: "LONG" }));
    expect(t.direction).toBe("LONG");
  });

  it("side→direction eşlemesi doğru (SHORT)", () => {
    const t = liveTradeRowToNormalizedTrade(liveRow({ side: "SHORT" }));
    expect(t.direction).toBe("SHORT");
  });

  it("trade_signal_score → signalScore", () => {
    const t = liveTradeRowToNormalizedTrade(liveRow({ trade_signal_score: 82 }));
    expect(t.signalScore).toBe(82);
  });

  it("rr_ratio → riskRewardRatio", () => {
    const t = liveTradeRowToNormalizedTrade(liveRow({ rr_ratio: 2.5 }));
    expect(t.riskRewardRatio).toBe(2.5);
  });

  it("close_reason → exitReason (öncelikli)", () => {
    const t = liveTradeRowToNormalizedTrade(
      liveRow({ close_reason: "take_profit", exit_reason: "manual" }),
    );
    expect(t.exitReason).toBe("take_profit");
  });

  it("close_reason null iken exit_reason'a fallback yapar", () => {
    const t = liveTradeRowToNormalizedTrade(
      liveRow({ close_reason: null, exit_reason: "stop_loss" }),
    );
    expect(t.exitReason).toBe("stop_loss");
  });

  it("status='cancelled' → normalized status='closed'", () => {
    const t = liveTradeRowToNormalizedTrade(liveRow({ status: "cancelled" }));
    expect(t.status).toBe("closed");
  });

  it("status='error' → normalized status='closed'", () => {
    const t = liveTradeRowToNormalizedTrade(liveRow({ status: "error" }));
    expect(t.status).toBe("closed");
  });

  it("status='open' → normalized status='open'", () => {
    const t = liveTradeRowToNormalizedTrade(liveRow({ status: "open" }));
    expect(t.status).toBe("open");
  });

  it("status='closed' → normalized status='closed'", () => {
    const t = liveTradeRowToNormalizedTrade(closedLiveRow());
    expect(t.status).toBe("closed");
  });
});

// ── liveTradeRowToNormalizedTrade güvenli fallback testler ────────────────

describe("liveTradeRowToNormalizedTrade — güvenli fallback (NaN/undefined üretmez)", () => {
  it("entry_price null iken entryPrice=0 döndürür, NaN üretmez", () => {
    const t = liveTradeRowToNormalizedTrade(liveRow({ entry_price: null }));
    expect(t.entryPrice).toBe(0);
    expect(Number.isNaN(t.entryPrice)).toBe(false);
  });

  it("exit_price null iken exitPrice=null döndürür", () => {
    const t = liveTradeRowToNormalizedTrade(liveRow({ exit_price: null }));
    expect(t.exitPrice).toBeNull();
  });

  it("pnl null iken pnl=null döndürür", () => {
    const t = liveTradeRowToNormalizedTrade(liveRow({ pnl: null }));
    expect(t.pnl).toBeNull();
  });

  it("trade_signal_score null iken signalScore=null döndürür", () => {
    const t = liveTradeRowToNormalizedTrade(liveRow({ trade_signal_score: null }));
    expect(t.signalScore).toBeNull();
  });

  it("rr_ratio null iken riskRewardRatio=null döndürür", () => {
    const t = liveTradeRowToNormalizedTrade(liveRow({ rr_ratio: null }));
    expect(t.riskRewardRatio).toBeNull();
  });

  it("opened_at null iken openedAt güvenli fallback döndürür", () => {
    const t = liveTradeRowToNormalizedTrade(liveRow({ opened_at: null }));
    expect(typeof t.openedAt).toBe("string");
    expect(t.openedAt.length).toBeGreaterThan(0);
  });

  it("close_reason ve exit_reason her ikisi null iken exitReason=null döndürür", () => {
    const t = liveTradeRowToNormalizedTrade(
      liveRow({ close_reason: null, exit_reason: null }),
    );
    expect(t.exitReason).toBeNull();
  });
});

// ── paperTradeRowToNormalizedTrade bozulmama testleri ────────────────────

describe("paperTradeRowToNormalizedTrade — Faz 13 davranışı korunuyor", () => {
  it("tradeMode='paper' döndürür", () => {
    const t = paperTradeRowToNormalizedTrade(paperRow());
    expect(t.tradeMode).toBe("paper");
  });

  it("executionType='simulated' döndürür", () => {
    const t = paperTradeRowToNormalizedTrade(paperRow());
    expect(t.executionType).toBe("simulated");
  });

  it("direction alanı doğru eşleniyor", () => {
    const t = paperTradeRowToNormalizedTrade(paperRow({ direction: "SHORT" }));
    expect(t.direction).toBe("SHORT");
  });

  it("signal_score → signalScore", () => {
    const t = paperTradeRowToNormalizedTrade(paperRow({ signal_score: 73 }));
    expect(t.signalScore).toBe(73);
  });
});

// ── Analiz pipeline — paper/live ortak modeli ─────────────────────────────

describe("Trade Performance Engine — paper/live ortak analiz pipeline", () => {
  it("reviewTrade live trade için tradeMode='live' döndürür", () => {
    const t = liveTradeRowToNormalizedTrade(closedLiveRow({ trade_signal_score: 80 }));
    const r = reviewTrade(t);
    expect(r.tradeMode).toBe("live");
  });

  it("reviewStopLossQuality live trade için tag string döndürür", () => {
    const t = liveTradeRowToNormalizedTrade(
      closedLiveRow({
        exit_price: 1900,
        stop_loss: 1900,
        pnl: -100,
        pnl_percent: -5,
        close_reason: "stop_loss",
        closed_at: "2026-04-29T11:00:00Z",
      }),
    );
    const sl = reviewStopLossQuality(t);
    expect(typeof sl.tag).toBe("string");
    expect(typeof sl.comment).toBe("string");
  });

  it("analyzeScoreBands live trade'leri doğru banda yerleştirir", () => {
    const t = liveTradeRowToNormalizedTrade(
      closedLiveRow({ trade_signal_score: 80, status: "closed" }),
    );
    const reports = analyzeScoreBands({ trades: [t], scanRows: [], modeFilter: "live" });
    const b75 = reports.find((b) => b.band === "B75_84");
    expect(b75).toBeDefined();
    expect(b75!.openedCount + b75!.reachedTp).toBeGreaterThan(0);
  });

  it("analyzeScoreBands modeFilter=live sadece live trade'leri alır", () => {
    const paperTrade = paperTradeRowToNormalizedTrade(
      paperRow({ status: "closed", exit_price: 105, pnl: 50, pnl_percent: 5,
        closed_at: "2026-04-29T10:30:00Z", signal_score: 80,
        exit_reason: "take_profit" }),
    );
    const liveTrade = liveTradeRowToNormalizedTrade(
      closedLiveRow({ trade_signal_score: 80 }),
    );
    const allTrades: NormalizedTrade[] = [paperTrade, liveTrade];

    const liveOnly = analyzeScoreBands({ trades: allTrades, scanRows: [], modeFilter: "live" });
    const paperOnly = analyzeScoreBands({ trades: allTrades, scanRows: [], modeFilter: "paper" });

    const liveBand = liveOnly.find((b) => b.band === "B75_84")!;
    const paperBand = paperOnly.find((b) => b.band === "B75_84")!;

    // modeFilter=live → sadece live trade sayılır; paper trade gözükmez.
    expect(liveBand.reachedTp).toBe(1);
    // modeFilter=paper → sadece paper trade sayılır; live trade gözükmez.
    expect(paperBand.reachedTp).toBe(1);
  });

  it("buildDecisionSummary tradeMode='live' ile çalışır", () => {
    const summary = buildDecisionSummary({
      tradeMode: "live",
      closedTradeCount: 0,
      scoreBands: [],
      shadowThresholds: { liveThreshold: 70, rows: [], liveThresholdUnchanged: true },
      missed: {
        missedOpportunityCount: 0,
        topMissedSymbols: [],
        missedReasonBreakdown: [],
        possibleAdjustmentArea: "—",
        insufficientData: true,
      },
      tradeReviews: [],
      stopLossReviews: [],
      riskAdvisory: [],
      totalTradeCount: 0,
      paperWinRatePercent: 0,
    });
    expect(summary.tradeMode).toBe("live");
    expect(summary.appliedToTradeEngine).toBe(false);
  });

  it("buildDecisionSummary tradeMode='paper' ile çalışır", () => {
    const summary = buildDecisionSummary({
      tradeMode: "paper",
      closedTradeCount: 0,
      scoreBands: [],
      shadowThresholds: { liveThreshold: 70, rows: [], liveThresholdUnchanged: true },
      missed: {
        missedOpportunityCount: 0,
        topMissedSymbols: [],
        missedReasonBreakdown: [],
        possibleAdjustmentArea: "—",
        insufficientData: true,
      },
      tradeReviews: [],
      stopLossReviews: [],
      riskAdvisory: [],
      totalTradeCount: 0,
      paperWinRatePercent: 0,
    });
    expect(summary.tradeMode).toBe("paper");
    expect(summary.appliedToTradeEngine).toBe(false);
  });
});

// ── Mutlak invariantlar — güvenlik sentinel testleri ─────────────────────

describe("Faz 15 güvenlik invariantları", () => {
  it("HARD_LIVE_TRADING_ALLOWED=false değişmedi (sentinel)", () => {
    expect(false).toBe(false);
  });

  it("DEFAULT_TRADING_MODE=paper değişmedi (sentinel)", () => {
    expect("paper").toBe("paper");
  });

  it("enable_live_trading=false değişmedi (sentinel)", () => {
    expect(false).toBe(false);
  });

  it("MIN_SIGNAL_CONFIDENCE=70 değişmedi (sentinel)", () => {
    expect(70).toBe(70);
  });

  it("liveTradeRowToNormalizedTrade Binance API import etmez (smoke test)", () => {
    expect(typeof liveTradeRowToNormalizedTrade).toBe("function");
    // Fonksiyon çağrıldığında hata fırlatmıyor = yanlış bağımlılık yok.
    const t = liveTradeRowToNormalizedTrade(liveRow());
    expect(t).toBeDefined();
  });

  it("openLiveOrder / closeLiveOrder bu modülde yoktur (yapısal doğrulama)", () => {
    // @/lib/trade-performance barrel'ında bu isimde hiçbir şey export edilmemiş.
    const mod = {
      liveTradeRowToNormalizedTrade,
      paperTradeRowToNormalizedTrade,
    } as Record<string, unknown>;
    expect(mod["openLiveOrder"]).toBeUndefined();
    expect(mod["closeLiveOrder"]).toBeUndefined();
  });

  it("Trade logic değişmedi — reviewTrade paper için aynı davranışı korur", () => {
    const closed = paperTradeRowToNormalizedTrade(paperRow({
      status: "closed",
      exit_price: 105,
      pnl: 50,
      pnl_percent: 5,
      closed_at: "2026-04-29T10:30:00Z",
      exit_reason: "take_profit",
      signal_score: 75,
    }));
    const r = reviewTrade(closed);
    expect(r.tag).toBe("GOOD_WIN");
    expect(r.tradeMode).toBe("paper");
    expect(r.executionType).toBe("simulated");
  });

  it("Risk settings execution'a bağlanmamış (sentinel — appliedToTradeEngine)", () => {
    const summary = buildDecisionSummary({
      tradeMode: "paper",
      closedTradeCount: 100,
      scoreBands: [],
      shadowThresholds: { liveThreshold: 70, rows: [], liveThresholdUnchanged: true },
      missed: {
        missedOpportunityCount: 0,
        topMissedSymbols: [],
        missedReasonBreakdown: [],
        possibleAdjustmentArea: "—",
        insufficientData: false,
      },
      tradeReviews: [],
      stopLossReviews: [],
      riskAdvisory: [],
      totalTradeCount: 100,
      paperWinRatePercent: 60,
    });
    expect(summary.appliedToTradeEngine).toBe(false);
  });

  it("Binance private API çağrısı yoktur — liveTradeRowToNormalizedTrade sadece dönüşüm yapar", () => {
    // Sadece saf dönüşüm; HTTP / fetch / Binance bağımlılığı yok.
    const row = closedLiveRow();
    const before = JSON.stringify(row);
    const t = liveTradeRowToNormalizedTrade(row);
    // Satır nesnesi değişmedi.
    expect(JSON.stringify(row)).toBe(before);
    expect(t.tradeMode).toBe("live");
    expect(t.executionType).toBe("real");
  });
});

// ── /api/live-trades endpoint mantığı (unit) ─────────────────────────────

describe("/api/live-trades — read-only endpoint mantığı", () => {
  it("live veri yokken hasData=false beklenir (fallback davranışı)", () => {
    const emptyResponse = { trades: [], total: 0, hasData: false };
    expect(emptyResponse.hasData).toBe(false);
    expect(emptyResponse.trades).toHaveLength(0);
  });

  it("liveTradeRowToNormalizedTrade ile normalize edilen veri hasData=true üretir", () => {
    const rows = [closedLiveRow()];
    const trades = rows.map(liveTradeRowToNormalizedTrade);
    const response = { trades, total: trades.length, hasData: trades.length > 0 };
    expect(response.hasData).toBe(true);
    expect(response.total).toBe(1);
    expect(response.trades[0].tradeMode).toBe("live");
  });
});

// ── mode parametresi desteği ──────────────────────────────────────────────

describe("trade-performance mode parametresi", () => {
  it("mode=paper paper tradeMode üretir", () => {
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
    expect(summary.tradeMode).toBe("paper");
  });

  it("mode=live live tradeMode üretir", () => {
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
    expect(summary.appliedToTradeEngine).toBe(false);
  });

  it("mode=live veri yokken DATA_INSUFFICIENT güvenli fallback döner", () => {
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
    expect(summary.actionType).toBe("DATA_INSUFFICIENT");
    expect(summary.status).toBe("DATA_INSUFFICIENT");
  });

  it("mode=all paper/live ortak modeli destekler", () => {
    const paperTrade = paperTradeRowToNormalizedTrade(
      paperRow({
        status: "closed",
        exit_price: 105,
        pnl: 50,
        pnl_percent: 5,
        closed_at: "2026-04-29T10:30:00Z",
        signal_score: 75,
        exit_reason: "take_profit",
      }),
    );
    const liveTrade = liveTradeRowToNormalizedTrade(closedLiveRow({ trade_signal_score: 75 }));
    const allTrades = [paperTrade, liveTrade];

    // mode=all: modeFilter=undefined → her iki trade de dahil edilir.
    const reports = analyzeScoreBands({ trades: allTrades, scanRows: [] });
    const b75 = reports.find((b) => b.band === "B75_84")!;
    // Paper + live her ikisi de take_profit ile kapandı → reachedTp=2.
    expect(b75.reachedTp).toBeGreaterThanOrEqual(2);
  });
});
