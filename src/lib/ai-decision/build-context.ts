// AI Decision — input context oluşturucu.
//
// Bu modül CoinBot iç verilerinden AI'a gönderilecek özet/karar metadata'sını
// üretir. Token şişirilmesini engellemek için ham scan_details, raw payload,
// API key/secret ya da Supabase service-role gibi gizli veriler ASLA context'e
// konmaz. Test ile doğrulanır.

import type {
  AIDecisionContext,
  ClosedTradeSummary,
  OpenPositionSummary,
} from "./types";
import type { DecisionSummary } from "@/lib/trade-performance";
import type { TradeAuditSummary } from "@/lib/trade-audit";
import type { LiveReadinessSummary } from "@/lib/live-readiness";

// ── Secret sanitizer ──────────────────────────────────────────────────────────
//
// Açık API key, secret, JWT, Bearer token, vb. gibi şüpheli pattern'leri
// agresif şekilde temizler. Hem string'ler hem de obje değerleri taranır.

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI / generic sk- secret
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, // JWT
  /Bearer\s+[A-Za-z0-9._-]{20,}/gi,
  /[A-Fa-f0-9]{32,}/g, // long hex
  /[A-Za-z0-9+/]{40,}={0,2}/g, // base64-ish
];

const SECRET_KEY_RE =
  /(api[_-]?key|api[_-]?secret|secret|passphrase|service[_-]?role|password|token|private[_-]?key|signature)/i;

export function stripSecrets<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    let out: string = value;
    for (const re of SECRET_PATTERNS) out = out.replace(re, "[REDACTED]");
    return out as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => stripSecrets(v)) as unknown as T;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(k)) {
        out[k] = "[REDACTED]";
        continue;
      }
      out[k] = stripSecrets(v);
    }
    return out as T;
  }
  return value;
}

// ── Builder yardımcıları ──────────────────────────────────────────────────────

export interface BuildContextInput {
  performanceDecision?: DecisionSummary | null;
  tradeAuditSummary?: TradeAuditSummary | null;
  liveReadiness?: LiveReadinessSummary | null;
  positionManagementCount?: number;
  positionManagementTopActions?: string[];
  riskConfig?: {
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
  } | null;
  marketPulse?: {
    riskAppetite: number | null;
    fomoLevel: number | null;
    marketRisk: number | null;
    comment: string;
  } | null;
  radar?: {
    strongOpportunity: number;
    nearThreshold: number;
    awaitingDirection: number;
    rejectedByRisk: number;
  } | null;
  diagnostics?: {
    workerOnline: boolean;
    workerStatus: string;
    websocketStatus: string;
    binanceApiStatus: string;
    tickSkipped: boolean;
    skipReason: string | null;
    tradingMode: "paper" | "live";
    hardLiveTradingAllowed: boolean;
    enableLiveTrading: boolean;
  } | null;
  closedTradesRecent?: ClosedTradeSummary[];
  openPositions?: OpenPositionSummary[];
  scanRowsCount?: number;
  mode?: "paper" | "live" | "all";
}

export function buildAIDecisionContext(input: BuildContextInput): AIDecisionContext {
  const performanceDecision = input.performanceDecision
    ? {
        status: input.performanceDecision.status,
        tradeMode: input.performanceDecision.tradeMode,
        mainFinding: input.performanceDecision.mainFinding,
        recommendation: input.performanceDecision.recommendation,
        actionType: input.performanceDecision.actionType,
        confidence: input.performanceDecision.confidence,
      }
    : null;

  const tradeAuditSummary = input.tradeAuditSummary
    ? {
        status: input.tradeAuditSummary.status,
        tradeMode: input.tradeAuditSummary.tradeMode,
        mainFinding: input.tradeAuditSummary.mainFinding,
        recommendation: input.tradeAuditSummary.recommendation,
        actionType: input.tradeAuditSummary.actionType,
        confidence: input.tradeAuditSummary.confidence,
        riskFinding: input.tradeAuditSummary.riskFinding,
        stopLossFinding: input.tradeAuditSummary.stopLossFinding,
        positionSizingFinding: input.tradeAuditSummary.positionSizingFinding,
        thresholdFinding: input.tradeAuditSummary.thresholdFinding,
        missedOpportunityFinding: input.tradeAuditSummary.missedOpportunityFinding,
        leverageFinding: input.tradeAuditSummary.leverageFinding,
      }
    : null;

  const liveReadiness = input.liveReadiness
    ? {
        readinessStatus: input.liveReadiness.readinessStatus,
        readinessScore: input.liveReadiness.readinessScore,
        blockingIssuesCount: input.liveReadiness.blockingIssuesCount,
        warningIssuesCount: input.liveReadiness.warningIssuesCount,
        mainBlockingReason: input.liveReadiness.mainBlockingReason,
        nextRequiredAction: input.liveReadiness.nextRequiredAction,
      }
    : null;

  const ctx: AIDecisionContext = {
    performanceDecision,
    tradeAuditSummary,
    liveReadiness,
    positionManagement: input.positionManagementCount !== undefined
      ? {
          recommendationsCount: input.positionManagementCount,
          topActions: (input.positionManagementTopActions ?? []).slice(0, 5),
        }
      : null,
    riskConfig: input.riskConfig ?? null,
    marketPulse: input.marketPulse ?? null,
    radar: input.radar ?? null,
    diagnostics: input.diagnostics ?? null,
    closedTradesRecent: (input.closedTradesRecent ?? []).slice(0, 20),
    openPositions: (input.openPositions ?? []).slice(0, 10),
    scanRowsCount: input.scanRowsCount ?? 0,
    mode: input.mode ?? "paper",
    generatedAt: new Date().toISOString(),
  };

  // Son güvenlik adımı: secret patternleri tara ve temizle.
  return stripSecrets(ctx);
}
