// AI Aksiyon Merkezi — barrel export.

export type {
  ActionPlan,
  ActionPlanGeneratorInput,
  ActionPlanRiskLevel,
  ActionPlanSource,
  ActionPlanStatus,
  ActionPlanType,
  ActionPlanResult,
  SourceSnapshot,
  ForbiddenActionType,
} from "./types";

export {
  ALLOWED_ACTION_TYPES,
  FORBIDDEN_ACTION_TYPES,
} from "./types";

export { generateActionPlans } from "./generator";
export { buildActionPrompt } from "./prompt-builder";
export { buildAIActionsResult, PHASE_BANNER } from "./snapshot";
export {
  executeAction,
  APPLICABLE_ACTION_TYPES,
  type ExecutorRequest,
  type ExecutorResult,
  type ApplyErrorCode,
  type ApplySuccessCode,
} from "./executor";
export {
  hashSnapshot,
  evaluateCache,
  getCached,
  setCached,
  clearCachedForTests,
  DECISION_CACHE_TTL_MS,
  CACHE_STATUS_LABEL,
  type DecisionSnapshot,
  type CachedDecisionEntry,
  type CacheStatus,
} from "./decision-cache";
