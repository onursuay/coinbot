// Phase 13 — Risk / limit yorumlama altyapısı.
//
// Bu fonksiyon risk ayarlarını ASLA değiştirmez. Yalnızca mevcut trade dağılımı
// (paper veya live) üzerinden kullanıcıya kısa Türkçe öneri/yorum üretir.
// Risk Yönetimi sayfasının `appliedToTradeEngine = false` ilkesi korunur.

import type {
  NormalizedTrade,
  RiskAdvisoryItem,
  RiskAdvisoryCode,
  TradeMode,
} from "./types";

export interface RiskAdvisoryInputs {
  /** Risk Yönetimi sayfasından gelen mevcut ayarlar (varsa). */
  currentSettings?: {
    riskPerTradePercent?: number;
    maxDailyLossPercent?: number;
    maxOpenPositions?: number;
    maxDailyTrades?: number;
  } | null;
  closedTrades: NormalizedTrade[];
  openTradesCount: number;
  /** Bugün açılan toplam işlem sayısı. */
  todaysTradesCount?: number;
  /** Sadece tek bir mod için yorumla — boşsa hepsi. */
  modeFilter?: TradeMode;
}

export function analyzeRiskAdvisory(p: RiskAdvisoryInputs): RiskAdvisoryItem[] {
  const items: RiskAdvisoryItem[] = [];

  const trades = p.modeFilter
    ? p.closedTrades.filter((t) => t.tradeMode === p.modeFilter)
    : p.closedTrades;

  if (trades.length === 0) {
    return [{
      code: "INSUFFICIENT_DATA",
      comment: "Yeterli işlem geçmişi yok — risk ayar yorumu için gözlem devam ediyor.",
    }];
  }

  const settings = p.currentSettings ?? null;
  const wins = trades.filter((t) => Number(t.pnl ?? 0) > 0);
  const losses = trades.filter((t) => Number(t.pnl ?? 0) <= 0);
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;

  // ── İşlem başı risk yorumu ──
  const avgLossPct = losses.length > 0
    ? Math.abs(losses.reduce((s, t) => s + Number(t.pnlPercent ?? 0), 0) / losses.length)
    : 0;

  if (settings?.riskPerTradePercent != null) {
    if (settings.riskPerTradePercent <= 1) {
      items.push({ code: "RISK_PER_TRADE_FEELS_LOW", comment: "İşlem başı risk %1 veya altı — pozisyon büyüklüğü çok küçük olabilir." });
    } else if (settings.riskPerTradePercent >= 4) {
      items.push({ code: "RISK_PER_TRADE_FEELS_HIGH", comment: "İşlem başı risk %4 ve üzeri — drawdown'a duyarlı." });
    }
  } else if (avgLossPct >= 5) {
    items.push({ code: "RISK_PER_TRADE_FEELS_HIGH", comment: `Ortalama zarar yüksek (${avgLossPct.toFixed(1)}%) — işlem başı risk gözden geçirilebilir.` });
  }

  // ── Günlük max zarar yorumu ──
  const dailyTotalPnlPct = trades
    .filter((t) => isToday(t.closedAt))
    .reduce((s, t) => s + Number(t.pnlPercent ?? 0), 0);
  if (settings?.maxDailyLossPercent != null) {
    if (dailyTotalPnlPct < 0 && Math.abs(dailyTotalPnlPct) > settings.maxDailyLossPercent * 0.7) {
      items.push({ code: "DAILY_MAX_LOSS_LOOKS_TIGHT", comment: `Günlük zarar limitinin %70'ine yaklaşıldı (gün içi ${dailyTotalPnlPct.toFixed(2)}%).` });
    } else {
      items.push({ code: "DAILY_MAX_LOSS_LOOKS_OK", comment: "Günlük zarar limiti henüz tetiklenmedi." });
    }
  }

  // ── Açık pozisyon sınırı ──
  if (settings?.maxOpenPositions != null && p.openTradesCount >= settings.maxOpenPositions) {
    items.push({
      code: "OPEN_POSITION_CAP_MAY_MISS_OPPORTUNITY",
      comment: `Maksimum açık pozisyon limitinde (${p.openTradesCount}/${settings.maxOpenPositions}) — ek fırsatlar kaçırılıyor olabilir.`,
    });
  }

  // ── Günlük işlem sınırı ──
  if (settings?.maxDailyTrades != null && p.todaysTradesCount != null) {
    if (p.todaysTradesCount >= settings.maxDailyTrades) {
      items.push({
        code: "DAILY_TRADES_CAP_MAY_MISS_OPPORTUNITY",
        comment: `Günlük işlem sınırına ulaşıldı (${p.todaysTradesCount}/${settings.maxDailyTrades}) — fırsat kaçabilir.`,
      });
    } else if (winRate >= 60 && p.todaysTradesCount <= settings.maxDailyTrades * 0.5) {
      items.push({
        code: "DAILY_TRADES_CAP_PREVENTS_OVERTRADE",
        comment: "Günlük işlem sınırı overtrade'i engelliyor — kazanma oranı sağlıklı görünüyor.",
      });
    }
  }

  if (items.length === 0) {
    items.push({ code: "INSUFFICIENT_DATA", comment: "Risk yorumu için yeterli sinyal yok." });
  }

  return items;
}

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return false;
  const now = new Date();
  return d.getUTCFullYear() === now.getUTCFullYear()
    && d.getUTCMonth() === now.getUTCMonth()
    && d.getUTCDate() === now.getUTCDate();
}

export type { RiskAdvisoryCode };
