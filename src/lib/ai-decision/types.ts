// AI Karar Asistanı Patch — tip tanımları.
//
// MUTLAK KURALLAR:
//   • ChatGPT API yorumlayıcıdır, uygulayıcı değildir.
//   • Trade engine, signal engine, risk engine, kaldıraç execution veya
//     canlı trading gate kararını HİÇBİR ŞEKİLDE değiştirmez.
//   • Binance API çağrısı yapmaz.
//   • appliedToTradeEngine daima false.
//   • HARD_LIVE_TRADING_ALLOWED, DEFAULT_TRADING_MODE, enable_live_trading,
//     MIN_SIGNAL_CONFIDENCE=70 değiştirilmez.

import type { DecisionSummary } from "@/lib/trade-performance";
import type { TradeAuditSummary } from "@/lib/trade-audit";
import type { LiveReadinessSummary } from "@/lib/live-readiness";

// ── Status / aksiyon enum'ları ────────────────────────────────────────────────

export type AIDecisionStatus =
  | "NO_ACTION"
  | "OBSERVE"
  | "REVIEW_REQUIRED"
  | "CRITICAL_BLOCKER"
  | "DATA_INSUFFICIENT";

export type AIRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type AIActionType =
  | "NO_ACTION"
  | "OBSERVE"
  | "PROMPT"
  | "REVIEW_RISK"
  | "REVIEW_STOP_LOSS"
  | "REVIEW_POSITION_SIZE"
  | "REVIEW_LIMITS"
  | "REVIEW_LEVERAGE"
  | "REVIEW_THRESHOLD"
  | "LIVE_READINESS_BLOCKED"
  | "DATA_INSUFFICIENT";

// ── AI çıktı şeması ───────────────────────────────────────────────────────────

export interface AIDecisionOutput {
  status: AIDecisionStatus;
  riskLevel: AIRiskLevel;
  mainFinding: string;
  systemInterpretation: string;
  recommendation: string;
  actionType: AIActionType;
  /** 0–100 arası güven puanı; clamp edilir. */
  confidence: number;
  /** Kritik aksiyonlarda zorunlu true. */
  requiresUserApproval: boolean;
  /** Default 7. */
  observeDays: number;
  /** READY olamamasının sebepleri ya da blocker etiketleri. */
  blockedBy: string[];
  /** Sadece actionType=PROMPT için anlamlı; aksi halde null. */
  suggestedPrompt: string | null;
  /** Güvenlik notları — finansal garanti yok, AI uygulamaz vs. */
  safetyNotes: string[];
  /** AI çıktısı asla execution'a otomatik bağlanmaz. */
  appliedToTradeEngine: false;
}

// ── AI input context ──────────────────────────────────────────────────────────
//
// Bu context AI'a gönderilecek özet metadata'dır. Secret/API key/raw payload
// asla buraya konulmaz; build-context.ts secret-stripping uygular.

export interface OpenPositionSummary {
  symbol: string;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  unrealizedPnlUsd: number | null;
  pmAction: string | null;
}

export interface ClosedTradeSummary {
  symbol: string;
  direction: "LONG" | "SHORT";
  pnlPercent: number | null;
  riskRewardRatio: number | null;
  exitReason: string | null;
  signalScore: number | null;
}

export interface MarketPulseSummary {
  riskAppetite: number | null;
  fomoLevel: number | null;
  marketRisk: number | null;
  comment: string;
}

export interface RadarSummary {
  strongOpportunity: number;
  nearThreshold: number;
  awaitingDirection: number;
  rejectedByRisk: number;
}

export interface DiagnosticsSummary {
  workerOnline: boolean;
  workerStatus: string;
  websocketStatus: string;
  binanceApiStatus: string;
  tickSkipped: boolean;
  skipReason: string | null;
  tradingMode: "paper" | "live";
  hardLiveTradingAllowed: boolean;
  enableLiveTrading: boolean;
}

export interface RiskExecutionConfigSummary {
  riskPerTradePercent: number;
  dailyMaxLossPercent: number;
  totalBotCapitalUsdt: number;
  defaultMaxOpenPositions: number;
  dynamicMaxOpenPositions: number;
  maxDailyTrades: number;
  averageDownEnabled: false;
  liveExecutionBound: false;
  leverageExecutionBound: false;
  has30xConfigured: boolean;
}

export interface PositionManagementSummary {
  recommendationsCount: number;
  topActions: string[];
}

export interface AIDecisionContext {
  performanceDecision: Pick<
    DecisionSummary,
    "status" | "tradeMode" | "mainFinding" | "recommendation" | "actionType" | "confidence"
  > | null;
  tradeAuditSummary: Pick<
    TradeAuditSummary,
    | "status"
    | "tradeMode"
    | "mainFinding"
    | "recommendation"
    | "actionType"
    | "confidence"
    | "riskFinding"
    | "stopLossFinding"
    | "positionSizingFinding"
    | "thresholdFinding"
    | "missedOpportunityFinding"
    | "leverageFinding"
  > | null;
  liveReadiness: Pick<
    LiveReadinessSummary,
    | "readinessStatus"
    | "readinessScore"
    | "blockingIssuesCount"
    | "warningIssuesCount"
    | "mainBlockingReason"
    | "nextRequiredAction"
  > | null;
  positionManagement: PositionManagementSummary | null;
  riskConfig: RiskExecutionConfigSummary | null;
  marketPulse: MarketPulseSummary | null;
  radar: RadarSummary | null;
  diagnostics: DiagnosticsSummary | null;
  closedTradesRecent: ClosedTradeSummary[];
  openPositions: OpenPositionSummary[];
  /** Bilgilendirme — token şişirilmesin diye scan_details'in tamamı yok. */
  scanRowsCount: number;
  /** AI inputu bu fazda paper modunda akar; "all" senaryosu UI tarafında. */
  mode: "paper" | "live" | "all";
  /** Bilgilendirme metaları. */
  generatedAt: string;
}

// ── Fallback nedenleri ────────────────────────────────────────────────────────

export type AIFallbackReason =
  | "AI_UNCONFIGURED"
  | "AI_TIMEOUT"
  | "AI_PARSE_ERROR"
  | "AI_HTTP_ERROR"
  | "AI_DISABLED";

// ── API yanıt zarfı ───────────────────────────────────────────────────────────

export interface AIDecisionResponse {
  ok: boolean;
  data: AIDecisionOutput;
  fallback: AIFallbackReason | null;
  /** Sadece debug — secret içermez. */
  meta: {
    model: string | null;
    durationMs: number;
    contextSizeChars: number;
    appliedToTradeEngine: false;
    binanceApiCalled: false;
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const DEFAULT_OBSERVE_DAYS = 7;
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
export const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
export const AI_REQUEST_TIMEOUT_MS = 30_000;
