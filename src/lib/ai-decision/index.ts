// AI Decision Assistant — barrel export.
//
// MUTLAK KURALLAR:
//   • AI yorumlayıcıdır, uygulayıcı değildir.
//   • Hiçbir trade engine ayarı, signal threshold, risk ayarı, kaldıraç
//     execution veya canlı trading gate kararı bu modül tarafından
//     değiştirilmez.
//   • Binance API çağrısı yapılmaz.

export type {
  AIDecisionStatus,
  AIRiskLevel,
  AIActionType,
  AIDecisionOutput,
  AIDecisionContext,
  AIDecisionResponse,
  AIFallbackReason,
  ClosedTradeSummary,
  OpenPositionSummary,
  MarketPulseSummary,
  RadarSummary,
  DiagnosticsSummary,
  RiskExecutionConfigSummary,
  PositionManagementSummary,
} from "./types";

export {
  DEFAULT_OBSERVE_DAYS,
  DEFAULT_OPENAI_MODEL,
  AI_REQUEST_TIMEOUT_MS,
  OPENAI_RESPONSES_ENDPOINT,
} from "./types";

export { AI_DECISION_JSON_SCHEMA, normalizeAIDecisionOutput } from "./schema";
export { AI_DECISION_SYSTEM_PROMPT, buildUserPrompt } from "./prompt";
export { buildFallbackOutput } from "./fallback";
export { stripSecrets, buildAIDecisionContext } from "./build-context";
export type { BuildContextInput } from "./build-context";
export { callAIDecision, readOpenAIConfigFromEnv } from "./client";
export type { AIClientConfig } from "./client";
