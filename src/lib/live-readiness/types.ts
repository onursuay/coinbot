// Faz 23 — Live Readiness / Canlıya Geçiş Kontrolü: tip tanımları.
//
// MUTLAK KURALLAR:
//   • Bu modül canlı trading AÇMAZ. Sadece okur, raporlar.
//   • HARD_LIVE_TRADING_ALLOWED, DEFAULT_TRADING_MODE, enable_live_trading
//     hiçbir koşulda bu modül tarafından değiştirilmez.
//   • MIN_SIGNAL_CONFIDENCE=70 korunur.
//   • Tüm fonksiyonlar saf (pure); endpoint sadece Supabase / dahili
//     modülleri okur. /fapi/v1/order ve /fapi/v1/leverage çağrısı YOK.
//   • Sahte READY üretilmez; veri yetersizse NOT_READY döner.

import type { BinanceSecurityChecklist, ChecklistState } from "@/lib/binance-credentials/types";
import type { MarketFeedStatus } from "@/lib/market-feed/types";

// ── Check kategorileri ────────────────────────────────────────────────────────
export type ReadinessCategory =
  | "PAPER_PERFORMANCE"
  | "RISK_CALIBRATION"
  | "TRADE_AUDIT"
  | "BINANCE_CREDENTIALS"
  | "API_SECURITY"
  | "EXECUTION_SAFETY"
  | "WEBSOCKET_RECONCILIATION"
  | "SYSTEM_HEALTH"
  | "USER_APPROVAL";

export type ReadinessCheckStatus = "pass" | "fail" | "warning" | "pending";
export type ReadinessSeverity = "info" | "warning" | "critical";

export interface ReadinessCheck {
  id: string;
  category: ReadinessCategory;
  title: string;
  status: ReadinessCheckStatus;
  severity: ReadinessSeverity;
  message: string;
  evidence: string;
  /** True ise canlıya geçişi engeller. */
  blocking: boolean;
}

// ── Input modelleri ───────────────────────────────────────────────────────────
export interface PaperPerformanceInput {
  closedTradeCount: number;
  winRatePercent: number;
  averagePnlUsd: number;
  maxDrawdownPercent: number;
  profitFactor: number;
  consecutiveLosses: number;
}

export interface RiskCalibrationInput {
  riskPerTradePercent: number;
  dailyMaxLossPercent: number;
  totalBotCapitalUsdt: number;
  defaultMaxOpenPositions: number;
  dynamicMaxOpenPositions: number;
  maxDailyTrades: number;
  averageDownEnabled: false;
  leverageExecutionBound: false;
  has30xConfigured: boolean;
}

export interface TradeAuditInput {
  criticalCount: number;
  warningCount: number;
  status: "HEALTHY" | "WATCH" | "ATTENTION_NEEDED" | "DATA_INSUFFICIENT";
  positionSizingInflated: boolean;
}

export interface BinanceCredentialsInput {
  apiKeyPresent: boolean;
  apiSecretPresent: boolean;
  futuresAccessOk: boolean;
  accountReadOk: boolean;
  permissionError: string | null;
}

export interface ApiSecurityInput {
  checklist: BinanceSecurityChecklist;
  recommendedVpsIp: string;
}

export interface ExecutionSafetyInput {
  hardLiveTradingAllowed: boolean;
  enableLiveTrading: boolean;
  defaultTradingMode: "paper" | "live";
  /** Faz 16: openLiveOrder hâlâ LIVE_EXECUTION_NOT_IMPLEMENTED döner. */
  openLiveOrderImplemented: false;
  liveExecutionBound: false;
  leverageExecutionBound: false;
}

export interface WebsocketReconciliationInput {
  marketFeed: MarketFeedStatus;
  reconciliationLoopSafe: boolean;
  duplicateGuardAvailable: boolean;
  clientOrderIdGuardAvailable: boolean;
}

export interface SystemHealthInput {
  workerOnline: boolean;
  workerStatus: string;
  lastHeartbeatAgeSec: number | null;
  binanceApiStatus: "ok" | "degraded" | "unknown";
  tickSkipped: boolean;
  skipReason: string | null;
  tickError: string | null;
  workerLockHealthy: boolean;
  diagnosticsStale: boolean;
}

export interface UserApprovalInput {
  /** Default pending — kullanıcı onayı henüz alınmamış. */
  userLiveApproval: "pending" | "confirmed";
}

export interface LiveReadinessInput {
  paperPerformance: PaperPerformanceInput;
  riskCalibration: RiskCalibrationInput;
  tradeAudit: TradeAuditInput;
  binanceCredentials: BinanceCredentialsInput;
  apiSecurity: ApiSecurityInput;
  executionSafety: ExecutionSafetyInput;
  websocketReconciliation: WebsocketReconciliationInput;
  systemHealth: SystemHealthInput;
  userApproval: UserApprovalInput;
}

// ── Output ────────────────────────────────────────────────────────────────────
export type ReadinessStatus = "READY" | "NOT_READY" | "OBSERVE";

export type ReadinessNextAction =
  | "COMPLETE_PAPER_TRADES"
  | "FIX_API_SECURITY"
  | "FIX_RISK_CALIBRATION"
  | "FIX_SYSTEM_HEALTH"
  | "FIX_WEBSOCKET"
  | "AWAIT_USER_APPROVAL"
  | "OBSERVE_MORE_DAYS"
  | "MANUAL_FINAL_ACTIVATION"
  | "DATA_INSUFFICIENT";

export interface LiveReadinessSummary {
  readinessStatus: ReadinessStatus;
  /** 0-100 — kategori başarı yüzdesi. */
  readinessScore: number;
  blockingIssuesCount: number;
  warningIssuesCount: number;
  mainBlockingReason: string;
  nextRequiredAction: ReadinessNextAction;
  checks: ReadinessCheck[];
  generatedAt: string;
  /** Bu modül live gate değerlerini DEĞİŞTİRMEZ. */
  liveGateUnchanged: true;
  /** Bu rapor trade engine'e otomatik uygulanmaz. */
  appliedToTradeEngine: false;
}

// ── Sabitler ──────────────────────────────────────────────────────────────────
export const MIN_PAPER_TRADES_FOR_LIVE = 100;
export const MIN_WIN_RATE_PERCENT = 45;
export const MIN_PROFIT_FACTOR = 1.3;
export const MAX_DRAWDOWN_PERCENT = 10;
export const MAX_CONSECUTIVE_LOSSES = 5;
export const HEARTBEAT_STALE_THRESHOLD_SEC = 60;
