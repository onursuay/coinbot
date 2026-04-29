// Phase 13 — Trade Performance Decision Engine barrel.
//
// AMAÇ: Paper ve live işlemleri ortak bir NormalizedTrade modeli üzerinden
// analiz eden karar/öneri motoru. Şu an paper veri kaynağıyla beslenir;
// canlıya geçince aynı pipeline live trade kayıtlarıyla çalışır — motor
// yeniden yazılmaz.
//
// MUTLAK KURALLAR:
//   • Bu modül trade engine, signal engine, risk engine veya canlı trading
//     gate kararını HİÇBİR ŞEKİLDE değiştirmez.
//   • Tüm fonksiyonlar saf (pure) olup external I/O yapmaz.
//   • `appliedToTradeEngine` daima `false`'tır.
//   • `MIN_SIGNAL_CONFIDENCE=70`, `HARD_LIVE_TRADING_ALLOWED=false`,
//     `DEFAULT_TRADING_MODE=paper`, `enable_live_trading=false` korunur;
//     Binance API Guardrails değişmez.

export type {
  TradeMode,
  ExecutionType,
  NormalizedTrade,
  PaperTradeRowRaw,
  LiveTradeRowRaw,
  ScanRowInput,
  ScoreBandKey,
  ScoreBandReport,
  ShadowThresholdValue,
  ShadowThresholdRow,
  ShadowThresholdReport,
  MissedReason,
  MissedReasonBreakdown,
  MissedOpportunityReport,
  TradeReviewTag,
  TradeReviewResult,
  StopLossQualityTag,
  StopLossQualityResult,
  RiskAdvisoryCode,
  RiskAdvisoryItem,
  DecisionStatus,
  DecisionActionType,
  DecisionSummary,
} from "./types";

export { paperTradeRowToNormalizedTrade, liveTradeRowToNormalizedTrade } from "./types";

export { analyzeScoreBands } from "./score-bands";
export type { ScoreBandInputs } from "./score-bands";

export { analyzeShadowThresholds } from "./shadow-threshold";

export { analyzeMissedOpportunities, MISSED_REASON_LABELS } from "./missed-opportunities";

export { reviewTrade, reviewStopLossQuality } from "./trade-review";

export { analyzeRiskAdvisory } from "./risk-advisory";
export type { RiskAdvisoryInputs } from "./risk-advisory";

export { buildDecisionSummary } from "./decision-summary";
export type { DecisionSummaryInputs } from "./decision-summary";
