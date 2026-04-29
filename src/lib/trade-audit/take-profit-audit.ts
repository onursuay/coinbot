// Faz 22 — Take-Profit / Exit Audit.
// TP gerçekçiliğini, erken çıkış ve kısmi TP fırsatlarını analiz eder.
// TP/exit kuralını DEĞİŞTİRMEZ.

import type { NormalizedTrade } from "@/lib/trade-performance";
import type { TakeProfitAuditResult, TakeProfitAuditTag, AuditSeverity } from "./types";

function tradeDurationMin(trade: NormalizedTrade): number | null {
  if (!trade.openedAt || !trade.closedAt) return null;
  return (new Date(trade.closedAt).getTime() - new Date(trade.openedAt).getTime()) / 60000;
}

export function auditTakeProfit(trade: NormalizedTrade): TakeProfitAuditResult {
  const base = {
    tradeId: trade.id,
    symbol: trade.symbol,
    tradeMode: trade.tradeMode,
    riskRewardRatio: trade.riskRewardRatio,
    tpDistancePercent: null as number | null,
  };

  if (trade.status !== "closed") {
    return {
      ...base,
      tag: "DATA_INSUFFICIENT" as TakeProfitAuditTag,
      mainFinding: "İşlem henüz açık — TP denetimi yapılamaz.",
      evidence: "status=open.",
      recommendation: "İşlem kapandıktan sonra tekrar değerlendirin.",
      severity: "info" as AuditSeverity,
    };
  }

  if (!trade.entryPrice || trade.entryPrice <= 0 || trade.pnl === null) {
    return {
      ...base,
      tag: "DATA_INSUFFICIENT",
      mainFinding: "Giriş fiyatı veya PnL verisi eksik.",
      evidence: "entryPrice=0 veya pnl=null.",
      recommendation: "Veri tamamlanınca tekrar değerlendirin.",
      severity: "info",
    };
  }

  const rr = trade.riskRewardRatio;
  const tp = trade.takeProfit;
  const sl = trade.stopLoss;
  const entry = trade.entryPrice;
  const exit = trade.exitPrice;
  const pnl = trade.pnl;
  const pnlPct = trade.pnlPercent ?? 0;
  const durationMin = tradeDurationMin(trade);

  const tpDistancePct = tp ? Math.abs(tp - entry) / entry * 100 : null;
  const slDistancePct = sl ? Math.abs(entry - sl) / entry * 100 : null;

  const reachedTp = exit !== null && tp !== null &&
    ((trade.direction === "LONG" && exit >= tp * 0.995) ||
     (trade.direction === "SHORT" && exit <= tp * 1.005));

  const exitedEarly = pnl > 0 && !reachedTp && rr !== null && rr < 1.8;

  // DATA_INSUFFICIENT: TP yok
  if (!tp) {
    return {
      ...base,
      tpDistancePercent: null,
      tag: "DATA_INSUFFICIENT",
      mainFinding: "Take-profit hedefi tanımlı değil.",
      evidence: "takeProfit=null.",
      recommendation: "Her işlem için TP seviyesi tanımlanmalı.",
      severity: "warning",
    };
  }

  // TP_TOO_CLOSE: R:R < 1.5 veya TP mesafesi SL'nin 1.5 katından az
  if (rr !== null && rr < 1.5) {
    return {
      ...base,
      tpDistancePercent: tpDistancePct,
      tag: "TP_TOO_CLOSE",
      mainFinding: "TP hedefi çok yakın — R:R oranı yetersiz.",
      evidence: `R:R: ${rr.toFixed(2)}. TP: %${tpDistancePct?.toFixed(2) ?? "—"}, SL: %${slDistancePct?.toFixed(2) ?? "—"}.`,
      recommendation: "TP en az SL mesafesinin 2 katına ayarlanmalı (R:R ≥ 2).",
      severity: "warning",
    };
  }

  // TP_TOO_FAR: R:R > 8 — gerçekçi olmayan TP
  if (rr !== null && rr > 8) {
    return {
      ...base,
      tpDistancePercent: tpDistancePct,
      tag: "TP_TOO_FAR",
      mainFinding: "TP hedefi çok uzak — gerçekçi olmayan bir hedef.",
      evidence: `R:R: ${rr.toFixed(2)}. TP mesafesi %${tpDistancePct?.toFixed(2) ?? "—"}.`,
      recommendation: "Gerçekçi bir TP belirleyin; aşırı uzak TP kısmi kâr fırsatlarını kaçırır.",
      severity: "info",
    };
  }

  // MISSED_TRAILING_STOP: Kârlı kapandı ama TP'ye ulaşmadı ve süre kısa
  if (pnl > 0 && !reachedTp && durationMin !== null && durationMin < 120 && rr !== null && rr >= 1.5 && rr < 2) {
    return {
      ...base,
      tpDistancePercent: tpDistancePct,
      tag: "MISSED_TRAILING_STOP",
      mainFinding: "İşlem TP'ye ulaşmadan kârlı kapandı — trailing stop eksikliği.",
      evidence: `PnL: %${pnlPct.toFixed(2)}, R:R: ${rr.toFixed(2)}. TP'ye ulaşılmadı, ${Math.round(durationMin)} dk sürdü.`,
      recommendation: "1.5R noktasında trailing stop veya kısmi kâr alma değerlendirin.",
      severity: "warning",
    };
  }

  // MISSED_PARTIAL_TP: Yüksek R:R ile kârlı ama tam TP olmadı
  if (pnl > 0 && !reachedTp && rr !== null && rr >= 2) {
    return {
      ...base,
      tpDistancePercent: tpDistancePct,
      tag: "MISSED_PARTIAL_TP",
      mainFinding: "Yüksek R:R işlem TP'siz kapandı — kısmi kâr alma fırsatı kaçmış olabilir.",
      evidence: `PnL: %${pnlPct.toFixed(2)}, R:R: ${rr.toFixed(2)}. TP seviyesine ulaşılmadı.`,
      recommendation: "2R noktasında kısmi kâr alma ve trailing stop stratejisi değerlendirin.",
      severity: "info",
    };
  }

  // EXIT_TOO_EARLY: Kârlı ama çok erken çıkış
  if (exitedEarly) {
    return {
      ...base,
      tpDistancePercent: tpDistancePct,
      tag: "EXIT_TOO_EARLY",
      mainFinding: "İşlem erken kapatılmış — daha fazla kâr fırsatı kaçmış olabilir.",
      evidence: `PnL: %${pnlPct.toFixed(2)}, R:R: ${rr?.toFixed(2) ?? "—"}. TP'ye ulaşılmadı.`,
      recommendation: "TP hedefine ulaşana kadar pozisyon tutulabilir; trailing stop kullanın.",
      severity: "warning",
    };
  }

  // NORMAL_TP: TP'ye ulaşıldı veya makul çıkış
  return {
    ...base,
    tpDistancePercent: tpDistancePct,
    tag: "NORMAL_TP",
    mainFinding: reachedTp
      ? "TP hedefine başarıyla ulaşıldı."
      : "Çıkış makul görünüyor.",
    evidence: `PnL: %${pnlPct.toFixed(2)}, R:R: ${rr?.toFixed(2) ?? "—"}.`,
    recommendation: "Mevcut TP stratejisi devam edebilir.",
    severity: "info",
  };
}

export function auditTakeProfitBatch(trades: NormalizedTrade[]): TakeProfitAuditResult[] {
  return trades.filter((t) => t.status === "closed").map(auditTakeProfit);
}
