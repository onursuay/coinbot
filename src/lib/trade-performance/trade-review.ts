// Phase 13 — Trade review + stop-loss kalite denetimi.
//
// Her kapanan trade için (paper veya live) tek bir TradeReviewResult ve
// gerekirse ayrı bir StopLossQualityResult üretilir. Bu fonksiyonlar saf ve
// idempotenttir; trade engine, signal engine, risk engine veya stop-loss
// kuralını DEĞİŞTİRMEZ. Paper/live ayrımı yalnızca `tradeMode` rozetinde
// gözükür; analiz davranışı her ikisinde de aynıdır.

import type {
  NormalizedTrade,
  TradeReviewResult,
  TradeReviewTag,
  StopLossQualityResult,
  StopLossQualityTag,
} from "./types";

function safeNum(n: number | null | undefined): number {
  return typeof n === "number" && Number.isFinite(n) ? n : NaN;
}

function durationMinutes(opened: string, closed: string | null): number | null {
  if (!closed) return null;
  const o = new Date(opened).getTime();
  const c = new Date(closed).getTime();
  if (!Number.isFinite(o) || !Number.isFinite(c) || c < o) return null;
  return Math.round((c - o) / 60_000);
}

function stopDistancePct(direction: "LONG" | "SHORT", entry: number, sl: number): number | null {
  if (!Number.isFinite(entry) || entry <= 0) return null;
  if (!Number.isFinite(sl)) return null;
  const dist = direction === "LONG" ? entry - sl : sl - entry;
  if (dist <= 0) return null;
  return +(dist / entry * 100).toFixed(3);
}

/** Tek bir kapalı işlem için review sonucu üretir. Paper veya live farketmez. */
export function reviewTrade(t: NormalizedTrade): TradeReviewResult {
  const entry = safeNum(t.entryPrice);
  const exit = safeNum(t.exitPrice);
  const sl = safeNum(t.stopLoss);
  const tp = safeNum(t.takeProfit);
  const pnl = safeNum(t.pnl);
  const pnlPct = safeNum(t.pnlPercent);
  const rr = safeNum(t.riskRewardRatio);
  const dur = durationMinutes(t.openedAt, t.closedAt);
  const stopDist = Number.isFinite(entry) && Number.isFinite(sl)
    ? stopDistancePct(t.direction, entry, sl)
    : null;

  const base: Omit<TradeReviewResult, "tag" | "comment"> = {
    tradeId: t.id,
    tradeMode: t.tradeMode,
    executionType: t.executionType,
    symbol: t.symbol,
    side: t.direction,
    entryPrice: Number.isFinite(entry) ? entry : 0,
    exitPrice: Number.isFinite(exit) ? exit : null,
    stopLoss: Number.isFinite(sl) ? sl : null,
    takeProfit: Number.isFinite(tp) ? tp : null,
    pnl: Number.isFinite(pnl) ? pnl : null,
    pnlPercent: Number.isFinite(pnlPct) ? pnlPct : null,
    openedAt: t.openedAt,
    closedAt: t.closedAt,
    closeReason: t.exitReason,
    entryScore: t.signalScore,
    rrRatio: Number.isFinite(rr) ? rr : null,
    stopDistancePercent: stopDist,
    tradeDurationMinutes: dur,
  };

  // Veri yetersiz: kapanmamış işlem veya temel alanlar eksik
  if (t.status !== "closed" || !Number.isFinite(entry) || !Number.isFinite(pnl)) {
    return { ...base, tag: "DATA_INSUFFICIENT", comment: "Veri yetersiz — değerlendirilemiyor." };
  }

  const tag = classifyTrade({
    pnl,
    pnlPct: Number.isFinite(pnlPct) ? pnlPct : 0,
    rr: Number.isFinite(rr) ? rr : 0,
    closeReason: t.exitReason,
    durationMin: dur,
    stopDistPct: stopDist,
  });
  const comment = commentForTag(tag, {
    pnlPct: Number.isFinite(pnlPct) ? pnlPct : 0,
    closeReason: t.exitReason,
    durationMin: dur,
    stopDistPct: stopDist,
    rr: Number.isFinite(rr) ? rr : 0,
  });

  return { ...base, tag, comment };
}

function classifyTrade(p: {
  pnl: number;
  pnlPct: number;
  rr: number;
  closeReason: string | null;
  durationMin: number | null;
  stopDistPct: number | null;
}): TradeReviewTag {
  // Win path
  if (p.pnl > 0) {
    if (p.closeReason === "take_profit" && p.pnlPct >= 5) return "GOOD_WIN";
    if (p.closeReason === "manual" && p.pnlPct < 1.5) return "POSSIBLE_EXIT_TOO_EARLY";
    return "GOOD_WIN";
  }

  // Loss path
  if (p.closeReason === "stop_loss") {
    // Erken stop şüphesi: 5 dakikadan kısa sürede stop oldu
    if (p.durationMin !== null && p.durationMin <= 5) return "POSSIBLE_EARLY_STOP";
    // R:R zayıf: 1.5'in altında
    if (Number.isFinite(p.rr) && p.rr > 0 && p.rr < 1.5) return "POSSIBLE_BAD_RR";
    // Stop mesafesi çok dar: %0.3 altı
    if (p.stopDistPct !== null && p.stopDistPct < 0.3) return "POSSIBLE_BAD_RR";
    // Aşırı yüksek zarar: pnl% < -8 (risk per trade çok yüksek olabilir)
    if (p.pnlPct < -8) return "POSSIBLE_RISK_TOO_HIGH";
    // Normal stop / acceptable
    if (p.pnlPct >= -3) return "ACCEPTABLE_LOSS";
    return "POSSIBLE_BAD_ENTRY";
  }
  // Stop dışı kapanan kayıp
  if (p.pnlPct < -1.5) return "POSSIBLE_BAD_ENTRY";
  return "ACCEPTABLE_LOSS";
}

function commentForTag(
  tag: TradeReviewTag,
  p: { pnlPct: number; closeReason: string | null; durationMin: number | null; stopDistPct: number | null; rr: number },
): string {
  switch (tag) {
    case "NORMAL_TRADE":      return "Normal işlem — beklenen sonuç.";
    case "GOOD_WIN":          return `Güçlü kazanç (PnL ${p.pnlPct.toFixed(2)}%) — beklenen TP'ye ulaştı.`;
    case "ACCEPTABLE_LOSS":   return `Kabul edilebilir zarar (PnL ${p.pnlPct.toFixed(2)}%) — risk sınırlarında.`;
    case "POSSIBLE_EARLY_STOP":
      return p.durationMin !== null
        ? `Çok kısa sürede stop (${p.durationMin}dk) — gürültüde tetiklenmiş olabilir.`
        : "Çok kısa sürede stop — erken stop şüphesi.";
    case "POSSIBLE_BAD_ENTRY":
      return `Beklenenden yüksek zarar (PnL ${p.pnlPct.toFixed(2)}%) — giriş kalitesi gözlem altına alınabilir.`;
    case "POSSIBLE_BAD_RR":
      return p.rr > 0
        ? `R:R zayıf (1:${p.rr.toFixed(2)}) — stop mesafesi gözden geçirilebilir.`
        : "Stop mesafesi çok dar — gürültüde tetiklenmiş olabilir.";
    case "POSSIBLE_RISK_TOO_HIGH":
      return `İşlem başı zarar yüksek (PnL ${p.pnlPct.toFixed(2)}%) — risk yüzdesi gözden geçirilebilir.`;
    case "POSSIBLE_EXIT_TOO_EARLY":
      return p.closeReason === "manual"
        ? "Manuel erken çıkış — TP'ye ulaşmadan kapatılmış olabilir."
        : "Erken çıkış şüphesi.";
    case "DATA_INSUFFICIENT": return "Veri yetersiz — değerlendirilemiyor.";
  }
}

// ── Stop-loss kalite denetimi ──────────────────────────────────────────────

export function reviewStopLossQuality(t: NormalizedTrade): StopLossQualityResult {
  const entry = safeNum(t.entryPrice);
  const sl = safeNum(t.stopLoss);
  const dur = durationMinutes(t.openedAt, t.closedAt);
  const stopDist = Number.isFinite(entry) && Number.isFinite(sl)
    ? stopDistancePct(t.direction, entry, sl)
    : null;
  const rr = safeNum(t.riskRewardRatio);

  if (t.status !== "closed" || !Number.isFinite(entry) || !Number.isFinite(sl)) {
    return { tradeId: t.id, tradeMode: t.tradeMode, tag: "DATA_INSUFFICIENT", comment: "Veri yetersiz." };
  }

  const tag = classifyStopLoss({
    closeReason: t.exitReason,
    durationMin: dur,
    stopDistPct: stopDist,
    rr: Number.isFinite(rr) ? rr : 0,
  });
  const comment = commentForSlTag(tag, stopDist, dur, Number.isFinite(rr) ? rr : 0);
  return { tradeId: t.id, tradeMode: t.tradeMode, tag, comment };
}

function classifyStopLoss(p: {
  closeReason: string | null;
  durationMin: number | null;
  stopDistPct: number | null;
  rr: number;
}): StopLossQualityTag {
  if (p.closeReason !== "stop_loss") return "NORMAL_STOP";
  if (p.durationMin !== null && p.durationMin <= 5) return "EARLY_STOP_SUSPECT";
  if (p.stopDistPct !== null && p.stopDistPct < 0.3) return "SL_TOO_TIGHT";
  if (p.rr > 0 && p.rr < 1.5) return "RR_WEAK";
  return "NORMAL_STOP";
}

function commentForSlTag(tag: StopLossQualityTag, dist: number | null, dur: number | null, rr: number): string {
  switch (tag) {
    case "NORMAL_STOP":         return "Normal stop.";
    case "EARLY_STOP_SUSPECT":
      return dur !== null
        ? `Erken stop şüphesi (${dur}dk) — gürültüde tetiklenmiş olabilir.`
        : "Erken stop şüphesi.";
    case "SL_TOO_TIGHT":
      return dist !== null
        ? `SL volatiliteye göre dar olabilir (mesafe ${dist}%).`
        : "SL volatiliteye göre dar olabilir.";
    case "RR_WEAK":
      return `R:R zayıf (1:${rr.toFixed(2)}).`;
    case "DATA_INSUFFICIENT":   return "Veri yetersiz.";
  }
}
