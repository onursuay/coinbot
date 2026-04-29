// Phase 13 — Trade Performance Decision Engine: tip tanımları.
//
// AMAÇ: Bu motor PAPER ve LIVE için **tek tip** çalışacak şekilde tasarlandı.
// Şu an veri kaynağı `paper_trades` tablosudur; canlıya geçince aynı normalized
// trade modeli (`NormalizedTrade`) `live_trades` üzerinden de beslenecek ve
// motorun yeniden yazımına gerek kalmayacak.
//
// MUTLAK KURALLAR:
//   • Bu modül trade engine, signal engine, risk engine veya canlı trading
//     gate kararını HİÇBİR ŞEKİLDE değiştirmez.
//   • Tüm fonksiyonlar saf (pure) olup external I/O yapmaz.
//   • `appliedToTradeEngine` daima `false`'tır.
//   • `MIN_SIGNAL_CONFIDENCE=70`, `HARD_LIVE_TRADING_ALLOWED=false`,
//     `DEFAULT_TRADING_MODE=paper`, `enable_live_trading=false` korunur;
//     Binance API Guardrails değişmez.

// ── Trade mode / execution type — paper ve live ortak modeli ──────────────

/** Trade mode — bot moduna karşılık gelir. Şu an paper aktif; live ileride. */
export type TradeMode = "paper" | "live";

/** Execution type — emrin nasıl gerçekleştiğini ifade eder. */
export type ExecutionType = "simulated" | "real";

// ── Girdi modelleri ────────────────────────────────────────────────────────

/**
 * Trade Performans Karar Motoru'nun beklediği normalize edilmiş trade modeli.
 *
 * Paper kaynağı: `paper_trades` tablosu (`tradeMode="paper"`, `executionType="simulated"`).
 * Live kaynağı: ileride `live_trades` tablosu (`tradeMode="live"`, `executionType="real"`).
 *
 * Her iki kaynak da aynı analiz pipeline'ından geçer; bu yüzden motor canlıya
 * geçişte yeniden yazılmaz — sadece adaptör değişir.
 */
export interface NormalizedTrade {
  id: string;
  /** "paper" veya "live" — analizler bu alana göre filtrelenebilir. */
  tradeMode: TradeMode;
  /** "simulated" veya "real" — emir tipini ayırır. */
  executionType: ExecutionType;
  symbol: string;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  pnl: number | null;
  pnlPercent: number | null;
  signalScore: number | null;
  riskRewardRatio: number | null;
  exitReason: string | null;
  openedAt: string;
  closedAt: string | null;
  status: "open" | "closed";
}

/** Faz 6/12'den gelen scan detail satırı — analiz için gerekli alanlar. */
export interface ScanRowInput {
  symbol: string;
  signalType: string;
  signalScore?: number | null;
  tradeSignalScore?: number | null;
  setupScore?: number | null;
  marketQualityScore?: number | null;
  longSetupScore?: number | null;
  shortSetupScore?: number | null;
  directionCandidate?: string | null;
  waitReasonCodes?: string[] | null;
  waitReasonSummary?: string | null;
  rejectReason?: string | null;
  riskRejectReason?: string | null;
  btcTrendRejected?: boolean | null;
  opened?: boolean | null;
  scoreReason?: string | null;
  sourceDisplay?: string | null;
}

// ── Score band analizi ─────────────────────────────────────────────────────

export type ScoreBandKey = "B50_59" | "B60_64" | "B65_69" | "B70_74" | "B75_84" | "B85_PLUS";

export interface ScoreBandReport {
  band: ScoreBandKey;
  /** UI'da gösterilen aralık etiketi (ör. "70–74"). */
  label: string;
  signalCount: number;
  openedCount: number;
  notOpenedCount: number;
  reachedTp: number;
  hitSl: number;
  avgPnlPercent: number;
  avgRr: number;
  topBlockingReason: string | null;
  comment: string;
}

// ── Shadow threshold analizi ───────────────────────────────────────────────

export type ShadowThresholdValue = 60 | 65 | 70 | 75;

export interface ShadowThresholdRow {
  threshold: ShadowThresholdValue;
  hypotheticalTradeCount: number;
  estimatedQuality: number;
  estimatedRisk: number;
  recommendation: string;
}

export interface ShadowThresholdReport {
  liveThreshold: 70;
  rows: ShadowThresholdRow[];
  liveThresholdUnchanged: true;
}

// ── Kaçan fırsat analizi ───────────────────────────────────────────────────

export type MissedReason =
  | "BAND_60_69_NEAR_TP"
  | "BTC_FILTER_REJECTED"
  | "RISK_GATE_REJECTED"
  | "DIRECTION_UNCONFIRMED";

export interface MissedReasonBreakdown {
  reason: MissedReason;
  count: number;
}

export interface MissedOpportunityReport {
  missedOpportunityCount: number;
  topMissedSymbols: string[];
  missedReasonBreakdown: MissedReasonBreakdown[];
  possibleAdjustmentArea: string;
  insufficientData: boolean;
}

// ── Trade review ───────────────────────────────────────────────────────────

export type TradeReviewTag =
  | "NORMAL_TRADE"
  | "GOOD_WIN"
  | "ACCEPTABLE_LOSS"
  | "POSSIBLE_EARLY_STOP"
  | "POSSIBLE_BAD_ENTRY"
  | "POSSIBLE_BAD_RR"
  | "POSSIBLE_RISK_TOO_HIGH"
  | "POSSIBLE_EXIT_TOO_EARLY"
  | "DATA_INSUFFICIENT";

export interface TradeReviewResult {
  tradeId: string;
  tradeMode: TradeMode;
  executionType: ExecutionType;
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  pnl: number | null;
  pnlPercent: number | null;
  openedAt: string;
  closedAt: string | null;
  closeReason: string | null;
  entryScore: number | null;
  rrRatio: number | null;
  stopDistancePercent: number | null;
  tradeDurationMinutes: number | null;
  tag: TradeReviewTag;
  comment: string;
}

// ── Stop-loss kalite denetimi ──────────────────────────────────────────────

export type StopLossQualityTag =
  | "NORMAL_STOP"
  | "EARLY_STOP_SUSPECT"
  | "SL_TOO_TIGHT"
  | "RR_WEAK"
  | "DATA_INSUFFICIENT";

export interface StopLossQualityResult {
  tradeId: string;
  tradeMode: TradeMode;
  tag: StopLossQualityTag;
  comment: string;
}

// ── Risk / limit yorumlama ─────────────────────────────────────────────────

export type RiskAdvisoryCode =
  | "RISK_PER_TRADE_FEELS_LOW"
  | "RISK_PER_TRADE_FEELS_HIGH"
  | "DAILY_MAX_LOSS_LOOKS_OK"
  | "DAILY_MAX_LOSS_LOOKS_TIGHT"
  | "OPEN_POSITION_CAP_MAY_MISS_OPPORTUNITY"
  | "DAILY_TRADES_CAP_PREVENTS_OVERTRADE"
  | "DAILY_TRADES_CAP_MAY_MISS_OPPORTUNITY"
  | "INSUFFICIENT_DATA";

export interface RiskAdvisoryItem {
  code: RiskAdvisoryCode;
  comment: string;
}

// ── Decision summary (üst seviye karar) ────────────────────────────────────

export type DecisionStatus =
  | "HEALTHY"
  | "WATCH"
  | "ATTENTION_NEEDED"
  | "DATA_INSUFFICIENT";

export type DecisionActionType =
  | "NO_ACTION"
  | "OBSERVE"
  | "REVIEW_THRESHOLD"
  | "REVIEW_STOP_LOSS"
  | "REVIEW_RISK_SETTINGS"
  | "REVIEW_POSITION_LIMITS"
  | "REVIEW_SIGNAL_QUALITY"
  | "DATA_INSUFFICIENT";

export interface DecisionSummary {
  status: DecisionStatus;
  /** Hangi trade modunda analiz çalıştırıldı — UI bu alanı rozet olarak gösterir. */
  tradeMode: TradeMode;
  mainFinding: string;
  systemInterpretation: string;
  recommendation: string;
  actionType: DecisionActionType;
  confidence: number;
  requiresUserApproval: boolean;
  observeDays: number;
  /** Decision summary execution path'ine HİÇBİR şekilde bağlı değildir. */
  appliedToTradeEngine: false;
}

// ── Adaptör: Supabase paper_trades satırı → NormalizedTrade ────────────────

/** Supabase paper_trades tablosunun analiz için gerekli alanlarının ham tipi. */
export interface PaperTradeRowRaw {
  id: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  entry_price: number;
  exit_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  pnl: number | null;
  pnl_percent: number | null;
  signal_score: number | null;
  risk_reward_ratio: number | null;
  exit_reason: string | null;
  opened_at: string;
  closed_at: string | null;
  status: "open" | "closed";
}

/**
 * Supabase paper_trades satırını NormalizedTrade'e çevirir.
 * tradeMode = "paper", executionType = "simulated".
 *
 * Live'a geçişte ayrı bir adaptör eklendi (liveTradeRowToNormalizedTrade);
 * bu fonksiyonun davranışı veya isim alanı değişmez.
 */
export function paperTradeRowToNormalizedTrade(row: PaperTradeRowRaw): NormalizedTrade {
  return {
    id: row.id,
    tradeMode: "paper",
    executionType: "simulated",
    symbol: row.symbol,
    direction: row.direction,
    entryPrice: row.entry_price,
    exitPrice: row.exit_price,
    stopLoss: row.stop_loss,
    takeProfit: row.take_profit,
    pnl: row.pnl,
    pnlPercent: row.pnl_percent,
    signalScore: row.signal_score,
    riskRewardRatio: row.risk_reward_ratio,
    exitReason: row.exit_reason,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    status: row.status,
  };
}

// ── Adaptör: Supabase live_trades satırı → NormalizedTrade ─────────────────

/**
 * Faz 15 — Supabase live_trades tablosunun analiz için gerekli alanlarının ham tipi.
 *
 * Bu tip canlı emir göndermek için değil, yalnızca DB kaydından okuma yapmak içindir.
 * Trade Performance Engine aynı NormalizedTrade modeli üzerinden paper/live ortak çalışır.
 */
export interface LiveTradeRowRaw {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  status: "open" | "closed" | "cancelled" | "error";
  entry_price: number | null;
  exit_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  pnl: number | null;
  pnl_percent: number | null;
  trade_signal_score: number | null;
  rr_ratio: number | null;
  close_reason: string | null;
  exit_reason: string | null;
  opened_at: string | null;
  closed_at: string | null;
  trade_mode: "live" | "paper";
  execution_type: "real" | "simulated";
}

/**
 * Faz 15 — Supabase live_trades satırını NormalizedTrade'e çevirir.
 * tradeMode = "live", executionType = "real".
 *
 * Eksik/null veri için güvenli fallback uygulanır; NaN veya undefined üretmez.
 * Bu fonksiyon Binance API çağrısı yapmaz; sadece DB satırını dönüştürür.
 * paperTradeRowToNormalizedTrade davranışı ve arayüzü korunur.
 */
export function liveTradeRowToNormalizedTrade(row: LiveTradeRowRaw): NormalizedTrade {
  const safeStatus: "open" | "closed" =
    row.status === "open" ? "open" : "closed";

  return {
    id: row.id,
    tradeMode: "live",
    executionType: "real",
    symbol: row.symbol,
    direction: row.side,
    entryPrice: typeof row.entry_price === "number" && isFinite(row.entry_price)
      ? row.entry_price
      : 0,
    exitPrice: typeof row.exit_price === "number" && isFinite(row.exit_price)
      ? row.exit_price
      : null,
    stopLoss: typeof row.stop_loss === "number" && isFinite(row.stop_loss)
      ? row.stop_loss
      : null,
    takeProfit: typeof row.take_profit === "number" && isFinite(row.take_profit)
      ? row.take_profit
      : null,
    pnl: typeof row.pnl === "number" && isFinite(row.pnl) ? row.pnl : null,
    pnlPercent: typeof row.pnl_percent === "number" && isFinite(row.pnl_percent)
      ? row.pnl_percent
      : null,
    signalScore: typeof row.trade_signal_score === "number" && isFinite(row.trade_signal_score)
      ? row.trade_signal_score
      : null,
    riskRewardRatio: typeof row.rr_ratio === "number" && isFinite(row.rr_ratio)
      ? row.rr_ratio
      : null,
    exitReason: row.close_reason ?? row.exit_reason ?? null,
    openedAt: row.opened_at ?? new Date(0).toISOString(),
    closedAt: row.closed_at ?? null,
    status: safeStatus,
  };
}
