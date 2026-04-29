// AI Decision — JSON schema (OpenAI structured output) ve runtime doğrulayıcı.
// Saf fonksiyonlardan oluşur; trade engine veya canlı gate'i değiştirmez.

import {
  DEFAULT_OBSERVE_DAYS,
  type AIActionType,
  type AIDecisionOutput,
  type AIDecisionStatus,
  type AIRiskLevel,
} from "./types";

const STATUS_VALUES: AIDecisionStatus[] = [
  "NO_ACTION",
  "OBSERVE",
  "REVIEW_REQUIRED",
  "CRITICAL_BLOCKER",
  "DATA_INSUFFICIENT",
];
const RISK_VALUES: AIRiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const ACTION_VALUES: AIActionType[] = [
  "NO_ACTION",
  "OBSERVE",
  "PROMPT",
  "REVIEW_RISK",
  "REVIEW_STOP_LOSS",
  "REVIEW_POSITION_SIZE",
  "REVIEW_LIMITS",
  "REVIEW_LEVERAGE",
  "REVIEW_THRESHOLD",
  "LIVE_READINESS_BLOCKED",
  "DATA_INSUFFICIENT",
];

/** OpenAI Responses API ile uyumlu JSON Schema. */
export const AI_DECISION_JSON_SCHEMA = {
  name: "ai_decision",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "status",
      "riskLevel",
      "mainFinding",
      "systemInterpretation",
      "recommendation",
      "actionType",
      "confidence",
      "requiresUserApproval",
      "observeDays",
      "blockedBy",
      "suggestedPrompt",
      "safetyNotes",
    ],
    properties: {
      status: { type: "string", enum: STATUS_VALUES },
      riskLevel: { type: "string", enum: RISK_VALUES },
      mainFinding: { type: "string" },
      systemInterpretation: { type: "string" },
      recommendation: { type: "string" },
      actionType: { type: "string", enum: ACTION_VALUES },
      confidence: { type: "number", minimum: 0, maximum: 100 },
      requiresUserApproval: { type: "boolean" },
      observeDays: { type: "number", minimum: 0, maximum: 365 },
      blockedBy: { type: "array", items: { type: "string" } },
      suggestedPrompt: { type: ["string", "null"] },
      safetyNotes: { type: "array", items: { type: "string" } },
    },
  },
} as const;

/**
 * Runtime doğrulayıcı + normalizer.
 * AI'ın döndürdüğü ham objeyi temizleyip clamp'lar; geçersiz alanlar varsa
 * güvenli defaults uygular. Hiç bir şey atmaz; output her zaman tutarlı.
 */
export function normalizeAIDecisionOutput(raw: unknown): AIDecisionOutput {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const status: AIDecisionStatus = STATUS_VALUES.includes(obj.status as AIDecisionStatus)
    ? (obj.status as AIDecisionStatus)
    : "DATA_INSUFFICIENT";

  const riskLevel: AIRiskLevel = RISK_VALUES.includes(obj.riskLevel as AIRiskLevel)
    ? (obj.riskLevel as AIRiskLevel)
    : "MEDIUM";

  const actionType: AIActionType = ACTION_VALUES.includes(obj.actionType as AIActionType)
    ? (obj.actionType as AIActionType)
    : "DATA_INSUFFICIENT";

  const mainFinding = typeof obj.mainFinding === "string" ? obj.mainFinding.slice(0, 500) : "";
  const systemInterpretation =
    typeof obj.systemInterpretation === "string" ? obj.systemInterpretation.slice(0, 1000) : "";
  const recommendation = typeof obj.recommendation === "string" ? obj.recommendation.slice(0, 1000) : "";

  // Confidence 0-100 clamp
  let confidence = typeof obj.confidence === "number" && isFinite(obj.confidence) ? obj.confidence : 0;
  if (confidence < 0) confidence = 0;
  if (confidence > 100) confidence = 100;

  // observeDays default 7
  let observeDays =
    typeof obj.observeDays === "number" && isFinite(obj.observeDays)
      ? Math.round(obj.observeDays)
      : DEFAULT_OBSERVE_DAYS;
  if (observeDays < 0) observeDays = 0;
  if (observeDays > 365) observeDays = 365;

  const requiresUserApproval = typeof obj.requiresUserApproval === "boolean"
    ? obj.requiresUserApproval
    : status === "CRITICAL_BLOCKER" || status === "REVIEW_REQUIRED";

  const blockedBy = Array.isArray(obj.blockedBy)
    ? obj.blockedBy
        .filter((x) => typeof x === "string")
        .map((s) => (s as string).slice(0, 200))
        .slice(0, 20)
    : [];

  // suggestedPrompt yalnızca actionType=PROMPT için anlamlı
  let suggestedPrompt: string | null = null;
  if (typeof obj.suggestedPrompt === "string" && obj.suggestedPrompt.trim().length > 0) {
    suggestedPrompt = obj.suggestedPrompt.slice(0, 4000);
  }
  if (actionType !== "PROMPT") {
    suggestedPrompt = null;
  }

  const safetyNotes = Array.isArray(obj.safetyNotes)
    ? obj.safetyNotes
        .filter((x) => typeof x === "string")
        .map((s) => (s as string).slice(0, 300))
        .slice(0, 10)
    : [];

  return {
    status,
    riskLevel,
    mainFinding,
    systemInterpretation,
    recommendation,
    actionType,
    confidence,
    requiresUserApproval,
    observeDays,
    blockedBy,
    suggestedPrompt,
    safetyNotes,
    appliedToTradeEngine: false,
  };
}
