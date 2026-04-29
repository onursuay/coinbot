// Faz 22 — Stop-Loss Audit.
// SL kalitesini, mesafesini ve erken tetiklenme şüphesini analiz eder.
// Stop-loss kuralını DEĞİŞTİRMEZ.

import type { NormalizedTrade } from "@/lib/trade-performance";
import type { StopLossAuditResult, StopLossAuditTag, AuditSeverity } from "./types";

function tradeDurationMin(trade: NormalizedTrade): number | null {
  if (!trade.openedAt || !trade.closedAt) return null;
  return (new Date(trade.closedAt).getTime() - new Date(trade.openedAt).getTime()) / 60000;
}

function wasStoppedOut(trade: NormalizedTrade): boolean {
  if (trade.status !== "closed") return false;
  const reason = trade.exitReason?.toLowerCase() ?? "";
  if (reason.includes("stop")) return true;
  if (
    trade.pnl !== null && trade.pnl < 0 &&
    trade.exitPrice !== null && trade.stopLoss !== null &&
    trade.entryPrice > 0 &&
    Math.abs(trade.exitPrice - trade.stopLoss) / trade.entryPrice < 0.005
  ) return true;
  return false;
}

export function auditStopLoss(trade: NormalizedTrade): StopLossAuditResult {
  const base = {
    tradeId: trade.id,
    symbol: trade.symbol,
    tradeMode: trade.tradeMode,
    stopDistancePercent: null as number | null,
    tradeDurationMinutes: null as number | null,
  };

  if (!trade.stopLoss || !trade.entryPrice || trade.entryPrice <= 0 || trade.status !== "closed") {
    return {
      ...base,
      tag: "DATA_INSUFFICIENT" as StopLossAuditTag,
      mainFinding: "Stop-loss, giriş fiyatı verisi eksik veya işlem açık.",
      evidence: "stopLoss/entryPrice null/sıfır ya da status=open.",
      recommendation: "İşlem kapandıktan sonra SL denetimi yapılabilir.",
      severity: "info" as AuditSeverity,
    };
  }

  const stopDistancePct = Math.abs(trade.entryPrice - trade.stopLoss) / trade.entryPrice * 100;
  const durationMin = tradeDurationMin(trade);
  const stopped = wasStoppedOut(trade);

  const rr = trade.riskRewardRatio;

  // SPREAD_SLIPPAGE_SUSPECT: < %0.3 — spread bile bunu yer
  if (stopDistancePct < 0.3) {
    return {
      ...base,
      stopDistancePercent: stopDistancePct,
      tradeDurationMinutes: durationMin,
      tag: "SPREAD_SLIPPAGE_SUSPECT",
      mainFinding: "SL mesafesi spread/kayma riskine karşı yetersiz derecede dar.",
      evidence: `SL mesafesi %${stopDistancePct.toFixed(3)}. Spread ve kayma bu SL'yi kolayca tetikler.`,
      recommendation: "Minimum %0.5 SL mesafesi; spread düşük saatler tercih edin.",
      severity: "critical",
    };
  }

  // WICK_STOP_SUSPECT: < %0.5 ve stop tetiklendi
  if (stopDistancePct < 0.5 && stopped) {
    return {
      ...base,
      stopDistancePercent: stopDistancePct,
      tradeDurationMinutes: durationMin,
      tag: "WICK_STOP_SUSPECT",
      mainFinding: "Çok dar SL — wick tarafından tetiklenmiş olabilir.",
      evidence: `SL mesafesi %${stopDistancePct.toFixed(3)}. Bu kadar dar bir stop wick ile kolayca tetiklenir.`,
      recommendation: "ATR tabanlı SL veya minimum %0.5 mesafe önerilir.",
      severity: "warning",
    };
  }

  // SL_TOO_TIGHT: %0.5 altı
  if (stopDistancePct < 0.5) {
    return {
      ...base,
      stopDistancePercent: stopDistancePct,
      tradeDurationMinutes: durationMin,
      tag: "SL_TOO_TIGHT",
      mainFinding: "Stop-loss çok sıkı — volatilite tarafından kolayca tetiklenebilir.",
      evidence: `SL mesafesi %${stopDistancePct.toFixed(3)}. Normal piyasa volatilitesi için yetersiz.`,
      recommendation: "ATR tabanlı SL değerlendirin; minimum %0.5 mesafe önerilir.",
      severity: "warning",
    };
  }

  // SL_TOO_WIDE: %8 üzeri
  if (stopDistancePct > 8) {
    return {
      ...base,
      stopDistancePercent: stopDistancePct,
      tradeDurationMinutes: durationMin,
      tag: "SL_TOO_WIDE",
      mainFinding: "Stop-loss çok geniş — R:R oranı ve pozisyon boyutu olumsuz etkilenir.",
      evidence: `SL mesafesi %${stopDistancePct.toFixed(2)}. Geniş SL küçük pozisyon boyutu gerektirir.`,
      recommendation: "SL mesafesi genellikle %2–5 arasında tutulmalı.",
      severity: "warning",
    };
  }

  // EARLY_STOP_SUSPECT: Stop tetiklendi ve çok kısa süre
  if (stopped && durationMin !== null && durationMin < 30) {
    return {
      ...base,
      stopDistancePercent: stopDistancePct,
      tradeDurationMinutes: durationMin,
      tag: "EARLY_STOP_SUSPECT",
      mainFinding: "İşlem açılır açılmaz stop oldu — erken stop şüphesi.",
      evidence: `İşlem ${Math.round(durationMin)} dakikada kapandı. SL mesafesi %${stopDistancePct.toFixed(2)}.`,
      recommendation: "Entry zamanlaması, SL yerleşimi veya spread saatleri gözden geçirilebilir.",
      severity: "warning",
    };
  }

  // R:R SL'ye göre düşük (EARLY_STOP_SUSPECT olarak sınıflandırılıyor)
  if (rr !== null && rr < 1.5 && trade.takeProfit && stopped) {
    return {
      ...base,
      stopDistancePercent: stopDistancePct,
      tradeDurationMinutes: durationMin,
      tag: "EARLY_STOP_SUSPECT",
      mainFinding: "R:R oranı SL mesafesine göre düşük.",
      evidence: `R:R: ${rr.toFixed(2)}. SL mesafesi %${stopDistancePct.toFixed(2)}.`,
      recommendation: "TP hedefi SL mesafesinin en az 2 katı olmalı.",
      severity: "info",
    };
  }

  return {
    ...base,
    stopDistancePercent: stopDistancePct,
    tradeDurationMinutes: durationMin,
    tag: "NORMAL_STOP",
    mainFinding: "Stop-loss seviyesi makul görünüyor.",
    evidence: `SL mesafesi %${stopDistancePct.toFixed(2)}. Normal aralıkta.`,
    recommendation: "Mevcut SL stratejisi devam edebilir.",
    severity: "info",
  };
}

export function auditStopLossBatch(trades: NormalizedTrade[]): StopLossAuditResult[] {
  return trades.filter((t) => t.status === "closed").map(auditStopLoss);
}
