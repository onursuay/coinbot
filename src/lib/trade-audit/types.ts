// Faz 22 — Trade Denetimi ve Risk Kalibrasyonu: tip tanımları.
//
// MUTLAK KURALLAR:
//   • Bu modül trade engine, signal engine, risk engine veya canlı trading
//     gate kararını HİÇBİR ŞEKİLDE değiştirmez.
//   • Tüm fonksiyonlar saf (pure) olup external I/O yapmaz.
//   • appliedToTradeEngine daima false'tır.
//   • MIN_SIGNAL_CONFIDENCE=70, HARD_LIVE_TRADING_ALLOWED=false,
//     DEFAULT_TRADING_MODE=paper, enable_live_trading=false korunur.
//   • Binance API Guardrails değişmez. /fapi/v1/order & /fapi/v1/leverage yok.

import type { NormalizedTrade, ScanRowInput, TradeMode } from "@/lib/trade-performance";
import type { RiskExecutionConfig } from "@/lib/risk-settings/apply";

export type { NormalizedTrade, ScanRowInput, TradeMode, RiskExecutionConfig };

// ── Audit mode ────────────────────────────────────────────────────────────────
export type AuditMode = "paper" | "live" | "all";

// ── Ortak severity ────────────────────────────────────────────────────────────
export type AuditSeverity = "info" | "warning" | "critical";

// ── Audit input ───────────────────────────────────────────────────────────────
export interface TradeAuditInput {
  trades: NormalizedTrade[];
  scanRows: ScanRowInput[];
  riskConfig: RiskExecutionConfig | null;
  mode: AuditMode;
}

// ── Trade Quality Review ──────────────────────────────────────────────────────
export type TradeQualityTag =
  | "GOOD_TRADE"
  | "ACCEPTABLE_LOSS"
  | "BAD_ENTRY"
  | "EARLY_STOP_SUSPECT"
  | "BAD_RR"
  | "BAD_POSITION_SIZE"
  | "RISK_TOO_HIGH"
  | "EXIT_TOO_EARLY"
  | "MISSED_PROFIT_PROTECTION"
  | "DATA_INSUFFICIENT";

export interface TradeQualityResult {
  tradeId: string;
  symbol: string;
  tradeMode: TradeMode;
  tag: TradeQualityTag;
  mainFinding: string;
  evidence: string;
  recommendation: string;
  severity: AuditSeverity;
}

// ── Stop-Loss Audit ───────────────────────────────────────────────────────────
export type StopLossAuditTag =
  | "NORMAL_STOP"
  | "EARLY_STOP_SUSPECT"
  | "SL_TOO_TIGHT"
  | "SL_TOO_WIDE"
  | "WICK_STOP_SUSPECT"
  | "SPREAD_SLIPPAGE_SUSPECT"
  | "DATA_INSUFFICIENT";

export interface StopLossAuditResult {
  tradeId: string;
  symbol: string;
  tradeMode: TradeMode;
  tag: StopLossAuditTag;
  stopDistancePercent: number | null;
  tradeDurationMinutes: number | null;
  mainFinding: string;
  evidence: string;
  recommendation: string;
  severity: AuditSeverity;
}

// ── Take-Profit Audit ─────────────────────────────────────────────────────────
export type TakeProfitAuditTag =
  | "NORMAL_TP"
  | "TP_TOO_CLOSE"
  | "TP_TOO_FAR"
  | "EXIT_TOO_EARLY"
  | "MISSED_TRAILING_STOP"
  | "MISSED_PARTIAL_TP"
  | "DATA_INSUFFICIENT";

export interface TakeProfitAuditResult {
  tradeId: string;
  symbol: string;
  tradeMode: TradeMode;
  tag: TakeProfitAuditTag;
  riskRewardRatio: number | null;
  tpDistancePercent: number | null;
  mainFinding: string;
  evidence: string;
  recommendation: string;
  severity: AuditSeverity;
}

// ── Risk Calibration ──────────────────────────────────────────────────────────
export type RiskCalibrationTag =
  | "KEEP"
  | "OBSERVE"
  | "REDUCE_RISK"
  | "INCREASE_RISK"
  | "REVIEW_DAILY_LOSS"
  | "REVIEW_POSITION_SIZE"
  | "DATA_INSUFFICIENT";

export interface RiskCalibrationResult {
  tag: RiskCalibrationTag;
  riskPerTradePercent: number;
  dailyMaxLossPercent: number;
  totalBotCapitalUsdt: number;
  mainFinding: string;
  evidence: string;
  recommendation: string;
  severity: AuditSeverity;
}

// ── Position Sizing Audit ─────────────────────────────────────────────────────
export type PositionSizingTag =
  | "POSITION_SIZE_OK"
  | "POSITION_SIZE_TOO_LARGE"
  | "POSITION_SIZE_TOO_SMALL"
  | "STOP_DISTANCE_INFLATED_NOTIONAL"
  | "CAPITAL_MISSING_FALLBACK_USED"
  | "DATA_INSUFFICIENT";

export interface PositionSizingAuditResult {
  tag: PositionSizingTag;
  capitalMissingFallbackUsed: boolean;
  affectedTradeCount: number;
  mainFinding: string;
  evidence: string;
  recommendation: string;
  severity: AuditSeverity;
}

// ── Limit Calibration ─────────────────────────────────────────────────────────
export type LimitCalibrationTag =
  | "KEEP_LIMITS"
  | "REVIEW_MAX_OPEN_POSITIONS"
  | "REVIEW_DYNAMIC_CAPACITY"
  | "REVIEW_MAX_DAILY_TRADES"
  | "OVERTRADE_RISK"
  | "DATA_INSUFFICIENT";

export interface LimitCalibrationResult {
  tag: LimitCalibrationTag;
  defaultMaxOpenPositions: number;
  dynamicMaxOpenPositions: number;
  maxDailyTrades: number;
  mainFinding: string;
  evidence: string;
  recommendation: string;
  severity: AuditSeverity;
}

// ── Leverage Calibration ──────────────────────────────────────────────────────
export type LeverageCalibrationTag =
  | "KEEP_LEVERAGE_RANGE"
  | "REDUCE_MAX_LEVERAGE"
  | "OBSERVE_BEFORE_30X"
  | "BLOCK_30X"
  | "DATA_INSUFFICIENT";

export interface LeverageCalibrationResult {
  tag: LeverageCalibrationTag;
  has30xConfigured: boolean;
  ccMax: number | null;
  gnmrMax: number | null;
  mnlstMax: number | null;
  mainFinding: string;
  evidence: string;
  recommendation: string;
  severity: AuditSeverity;
}

// ── Missed Opportunity Audit ──────────────────────────────────────────────────
export type MissedOpportunityAuditTag =
  | "MISSED_OPPORTUNITY_LOW"
  | "MISSED_OPPORTUNITY_MODERATE"
  | "MISSED_OPPORTUNITY_HIGH"
  | "THRESHOLD_TOO_STRICT_SUSPECT"
  | "FILTER_TOO_STRICT_SUSPECT"
  | "DATA_INSUFFICIENT";

export interface MissedOpportunityAuditResult {
  tag: MissedOpportunityAuditTag;
  btcFilteredCount: number;
  riskGateRejectedCount: number;
  band60to69Count: number;
  mainFinding: string;
  evidence: string;
  recommendation: string;
  severity: AuditSeverity;
}

// ── Threshold Calibration ─────────────────────────────────────────────────────
export type ThresholdCalibrationTag =
  | "KEEP_70"
  | "OBSERVE_65_69"
  | "REVIEW_THRESHOLD_LATER"
  | "DO_NOT_LOWER"
  | "DATA_INSUFFICIENT";

export interface ThresholdCalibrationResult {
  tag: ThresholdCalibrationTag;
  /** Canlı eşik her zaman 70'tir; bu modül değiştirmez. */
  liveThreshold: 70;
  /** Invariant — her zaman true. */
  liveThresholdUnchanged: true;
  band70to74WinRate: number | null;
  band65to69Count: number;
  mainFinding: string;
  evidence: string;
  recommendation: string;
  severity: AuditSeverity;
}

// ── Trade Audit Summary ───────────────────────────────────────────────────────
export type AuditActionType =
  | "NO_ACTION"
  | "OBSERVE"
  | "REVIEW_RISK"
  | "REVIEW_STOP_LOSS"
  | "REVIEW_POSITION_SIZE"
  | "REVIEW_LIMITS"
  | "REVIEW_LEVERAGE"
  | "REVIEW_THRESHOLD"
  | "DATA_INSUFFICIENT";

export interface TradeAuditSummary {
  status: "HEALTHY" | "WATCH" | "ATTENTION_NEEDED" | "DATA_INSUFFICIENT";
  tradeMode: TradeMode;
  mainFinding: string;
  riskFinding: string;
  stopLossFinding: string;
  positionSizingFinding: string;
  thresholdFinding: string;
  missedOpportunityFinding: string;
  leverageFinding: string;
  recommendation: string;
  actionType: AuditActionType;
  confidence: number;
  requiresUserApproval: boolean;
  observeDays: number;
  /** Bu özet trade engine'e otomatik uygulanmaz. */
  appliedToTradeEngine: false;
}

// ── Tam audit raporu ──────────────────────────────────────────────────────────
export interface TradeAuditReport {
  summary: TradeAuditSummary;
  tradeQuality: TradeQualityResult[];
  stopLossAudit: StopLossAuditResult[];
  takeProfitAudit: TakeProfitAuditResult[];
  riskCalibration: RiskCalibrationResult;
  positionSizingAudit: PositionSizingAuditResult;
  limitCalibration: LimitCalibrationResult;
  leverageCalibration: LeverageCalibrationResult;
  missedOpportunityAudit: MissedOpportunityAuditResult;
  thresholdCalibration: ThresholdCalibrationResult;
  meta: {
    tradeCount: number;
    closedTradeCount: number;
    openTradeCount: number;
    mode: AuditMode;
    analyzedAt: string;
  };
}
