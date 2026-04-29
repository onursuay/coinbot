// Faz 22 — Trade Quality Review.
// Her kapanan işlem için kalite etiketi ve açıklama üretir.
// Trade kararını, SL/TP kuralını veya eşiği DEĞİŞTİRMEZ.

import type { NormalizedTrade } from "@/lib/trade-performance";
import type { TradeQualityResult, TradeQualityTag, AuditSeverity } from "./types";

function tradeDurationMin(trade: NormalizedTrade): number | null {
  if (!trade.openedAt || !trade.closedAt) return null;
  return (new Date(trade.closedAt).getTime() - new Date(trade.openedAt).getTime()) / 60000;
}

export function reviewTradeQuality(trade: NormalizedTrade): TradeQualityResult {
  const base = { tradeId: trade.id, symbol: trade.symbol, tradeMode: trade.tradeMode };

  if (trade.status !== "closed") {
    return {
      ...base,
      tag: "DATA_INSUFFICIENT",
      mainFinding: "İşlem henüz açık.",
      evidence: "status=open; kapanmadan analiz yapılamaz.",
      recommendation: "İşlem kapandıktan sonra tekrar değerlendirin.",
      severity: "info",
    };
  }

  if (trade.entryPrice <= 0 || trade.pnl === null) {
    return {
      ...base,
      tag: "DATA_INSUFFICIENT",
      mainFinding: "Giriş fiyatı veya PnL verisi eksik.",
      evidence: "entryPrice=0 veya pnl=null.",
      recommendation: "Daha fazla veri birikince tekrar analiz edilecek.",
      severity: "info",
    };
  }

  const pnl = trade.pnl;
  const pnlPct = trade.pnlPercent ?? 0;
  const rr = trade.riskRewardRatio;
  const sl = trade.stopLoss;
  const tp = trade.takeProfit;
  const entry = trade.entryPrice;
  const exit = trade.exitPrice;
  const score = trade.signalScore;
  const durationMin = tradeDurationMin(trade);

  const isStopped = trade.exitReason?.toLowerCase().includes("stop") ||
    (exit !== null && sl !== null && Math.abs(exit - sl) / entry < 0.005 && pnl < 0);

  const stopDistancePct = sl ? Math.abs(entry - sl) / entry * 100 : null;
  const tpDistancePct = tp ? Math.abs(tp - entry) / entry * 100 : null;

  // GOOD_TRADE: Kârlı kapanmış ve R:R makul
  if (pnl > 0 && rr !== null && rr >= 2) {
    return {
      ...base,
      tag: "GOOD_TRADE",
      mainFinding: "İyi işlem — kârlı kapandı ve R:R güçlü.",
      evidence: `PnL: %${pnlPct.toFixed(2)}, R:R: ${rr.toFixed(2)}.`,
      recommendation: "Bu tür kurulumları izlemeye devam edin.",
      severity: "info",
    };
  }

  // EXIT_TOO_EARLY: Kârlı ama R:R çok düşük — erken çıkış
  if (pnl > 0 && rr !== null && rr < 1.5) {
    return {
      ...base,
      tag: "EXIT_TOO_EARLY",
      mainFinding: "İşlem erken kapanmış — daha fazla kâr fırsatı kaçmış olabilir.",
      evidence: `PnL: %${pnlPct.toFixed(2)}, R:R: ${rr.toFixed(2)}. Düşük R:R erken çıkışa işaret ediyor.`,
      recommendation: "Trailing stop veya kısmi kâr alma stratejisi değerlendirin.",
      severity: "warning",
    };
  }

  // MISSED_PROFIT_PROTECTION: Kârlı açıldı ama stop ile kapandı
  if (pnl < 0 && isStopped && exit !== null && tp !== null) {
    const direction = trade.direction;
    const hitProfit = direction === "LONG" ? exit > entry : exit < entry;
    if (hitProfit) {
      return {
        ...base,
        tag: "MISSED_PROFIT_PROTECTION",
        mainFinding: "İşlem kârlı tarafta ilerleyip stop ile zarar yazdı.",
        evidence: `Çıkış fiyatı (${exit}) giriş (${entry}) ile kâr yönünde ama stop tetiklendi.`,
        recommendation: "Breakeven stop veya trailing stop kullanılabilir.",
        severity: "warning",
      };
    }
  }

  // EARLY_STOP_SUSPECT: Çok kısa sürede stop
  if (pnl < 0 && isStopped && durationMin !== null && durationMin < 30) {
    return {
      ...base,
      tag: "EARLY_STOP_SUSPECT",
      mainFinding: "İşlem çok kısa sürede stop oldu.",
      evidence: `Süre: ${Math.round(durationMin)} dk. SL mesafesi: ${stopDistancePct ? `%${stopDistancePct.toFixed(2)}` : "—"}.`,
      recommendation: "Entry zamanlaması veya SL mesafesi gözden geçirilebilir.",
      severity: "warning",
    };
  }

  // BAD_RR: Kayıp işlem ve R:R çok düşük
  if (pnl < 0 && rr !== null && rr < 1.5) {
    return {
      ...base,
      tag: "BAD_RR",
      mainFinding: "Kayıp işlem ve düşük R:R — risk-ödül dengesi bozuk.",
      evidence: `PnL: %${pnlPct.toFixed(2)}, R:R: ${rr.toFixed(2)}. TP/SL: ${tpDistancePct ? `%${tpDistancePct.toFixed(2)}` : "—"}/${stopDistancePct ? `%${stopDistancePct.toFixed(2)}` : "—"}.`,
      recommendation: "TP en az SL mesafesinin 2 katı olmalı.",
      severity: "warning",
    };
  }

  // BAD_ENTRY: Düşük sinyal skoru ile açılmış kayıp işlem
  if (pnl < 0 && score !== null && score < 72) {
    return {
      ...base,
      tag: "BAD_ENTRY",
      mainFinding: "Eşiğe yakın skorla açılmış kayıp işlem.",
      evidence: `Sinyal skoru: ${score}. Eşik seviyesine yakın sinyaller daha az güvenilir olabilir.`,
      recommendation: "70-72 arasındaki sinyallerin geçmiş başarısını gözlemleyin.",
      severity: "warning",
    };
  }

  // ACCEPTABLE_LOSS: Normal kayıp, makul SL
  if (pnl < 0 && (!stopDistancePct || (stopDistancePct >= 0.5 && stopDistancePct <= 8))) {
    return {
      ...base,
      tag: "ACCEPTABLE_LOSS",
      mainFinding: "Kabul edilebilir kayıp — SL makul aralıkta çalıştı.",
      evidence: `PnL: %${pnlPct.toFixed(2)}. SL mesafesi: ${stopDistancePct ? `%${stopDistancePct.toFixed(2)}` : "—"}.`,
      recommendation: "Normal piyasa koşullarında beklenen sonuç. Gözleme devam.",
      severity: "info",
    };
  }

  // DATA_INSUFFICIENT: Gerekli alanlar eksik
  return {
    ...base,
    tag: "DATA_INSUFFICIENT",
    mainFinding: "Tam analiz için yeterli veri yok.",
    evidence: `rr=${rr}, sl=${sl}, tp=${tp}, score=${score}.`,
    recommendation: "Daha fazla işlem verisi bekleniyor.",
    severity: "info",
  };
}

export function reviewTradeQualityBatch(trades: NormalizedTrade[]): TradeQualityResult[] {
  return trades.map(reviewTradeQuality);
}
