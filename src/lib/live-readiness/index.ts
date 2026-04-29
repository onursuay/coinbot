// Faz 23 — Live Readiness modülü barrel export.
// Bu modül canlı trading AÇMAZ; live gate değerlerini DEĞİŞTİRMEZ.

export type {
  LiveReadinessInput,
  LiveReadinessSummary,
  ReadinessCheck,
  ReadinessCheckStatus,
  ReadinessSeverity,
  ReadinessCategory,
  ReadinessStatus,
  ReadinessNextAction,
  PaperPerformanceInput,
  RiskCalibrationInput,
  TradeAuditInput,
  BinanceCredentialsInput,
  ApiSecurityInput,
  ExecutionSafetyInput,
  WebsocketReconciliationInput,
  SystemHealthInput,
  UserApprovalInput,
} from "./types";

export {
  MIN_PAPER_TRADES_FOR_LIVE,
  MIN_WIN_RATE_PERCENT,
  MIN_PROFIT_FACTOR,
  MAX_DRAWDOWN_PERCENT,
  MAX_CONSECUTIVE_LOSSES,
  HEARTBEAT_STALE_THRESHOLD_SEC,
} from "./types";

export {
  checkPaperPerformance,
  checkRiskCalibration,
  checkTradeAudit,
  checkBinanceCredentials,
  checkApiSecurity,
  checkExecutionSafety,
  checkWebsocketReconciliation,
  checkSystemHealth,
  checkUserApproval,
} from "./checks";

export { buildLiveReadinessSummary } from "./summary";
