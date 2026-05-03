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
  ROLLBACK_ELIGIBLE_TYPES,
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
export {
  AI_ACTION_EVENT_TYPES,
  ROLLBACK_ELIGIBLE_TYPES as ROLLBACK_ELIGIBLE_HISTORY_TYPES,
  HISTORY_STATUS_LABEL,
  HISTORY_CATEGORY_LABEL,
  mapHistoryItem,
  mapHistoryItems,
  sanitizeMetadata,
  type HistoryItem,
  type HistoryCategory,
  type HistoryStatus,
  type BotLogRow,
} from "./history";

export {
  executeRollback,
  type RollbackRequest,
  type RollbackResult,
  type RollbackErrorCode,
  type RollbackSuccessCode,
} from "./rollback";

export {
  buildCodePrompt,
  recommendPromptTarget,
  validatePromptRequest,
  defaultScopeForPlan,
  getCodePromptScopeLabel,
  getCodePromptTargetLabel,
  CODE_PROMPT_SCOPES,
  CODE_PROMPT_TARGETS,
  PROMPT_SAFETY_CHECKLIST,
  PROMPT_DEPLOY_CHECKLIST,
  type CodePromptTarget,
  type CodePromptScope,
  type CodePromptRequest,
  type CodePromptResult,
  type PromptValidation,
  type PromptValidationCode,
} from "./code-prompt";
