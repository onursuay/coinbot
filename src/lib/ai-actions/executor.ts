// AI Aksiyon Merkezi — Faz 3: SafeActionExecutor.
//
// MUTLAK KURALLAR (server-side enforce):
//   • Yalnızca whitelist'teki "düşürücü" aksiyonlar uygulanır.
//   • Önerilen değer mevcut değerden gerçekten düşük değilse reddedilir.
//   • UI'dan gelen plan, server-side yeniden üretilen yetkili plan ile
//     karşılaştırılır; planId mevcut değilse veya recommendedValue
//     uyuşmuyorsa reddedilir.
//   • FORBIDDEN_ACTION_TYPES açıkça reddedilir.
//   • Live trading değişikliği (env, DB toggles), kaldıraç değişikliği,
//     Binance order çağrısı YOKTUR.
//   • SET_OBSERVATION_MODE risk ayarına dokunmaz, sadece audit log üretir.
//   • Risk persistence → updateAndPersistRiskSettings (direct DB,
//     independent verify SELECT). RPC kullanılmaz.

import { updateAndPersistRiskSettings } from "@/lib/risk-settings/store";
import { buildRiskExecutionConfig, getEffectiveRiskSettings } from "@/lib/risk-settings/apply";
import {
  ALLOWED_ACTION_TYPES,
  FORBIDDEN_ACTION_TYPES,
  type ActionPlan,
  type ActionPlanType,
} from "./types";
import { buildAIActionsResult } from "./snapshot";

/**
 * Bu fazda apply edilebilir tipler. Diğer ALLOWED tipler (manual review,
 * implementation prompt) prompt/inceleme amaçlıdır; apply çağrısı reddedilir.
 */
export const APPLICABLE_ACTION_TYPES: readonly ActionPlanType[] = [
  "UPDATE_RISK_PER_TRADE_DOWN",
  "UPDATE_MAX_DAILY_LOSS_DOWN",
  "UPDATE_MAX_OPEN_POSITIONS_DOWN",
  "UPDATE_MAX_DAILY_TRADES_DOWN",
  "SET_OBSERVATION_MODE",
] as const;

export type ApplyErrorCode =
  | "CONFIRMATION_REQUIRED"
  | "ACTION_NOT_ALLOWED"
  | "FORBIDDEN_ACTION"
  | "PLAN_NOT_FOUND"
  | "PLAN_VALUE_MISMATCH"
  | "PLAN_BLOCKED"
  | "NOT_A_DOWNWARD_CHANGE"
  | "INVALID_VALUE"
  | "PERSISTENCE_VERIFY_FAILED";

export type ApplySuccessCode = "ACTION_APPLIED" | "OBSERVATION_RECORDED";

export interface ExecutorRequest {
  planId: string;
  actionType: string;
  recommendedValue: string;
  confirmApply: boolean;
}

export interface ExecutorContext {
  userId: string;
}

interface ExecutorBlocked {
  ok: false;
  status: "blocked" | "failed";
  code: ApplyErrorCode;
  actionType: string;
  oldValue: string | null;
  newValue: string | null;
  message: string;
  blockedReason: string;
}

interface ExecutorApplied {
  ok: true;
  status: "applied" | "observed";
  code: ApplySuccessCode;
  actionType: ActionPlanType;
  oldValue: string | null;
  newValue: string | null;
  message: string;
}

export type ExecutorResult = ExecutorBlocked | ExecutorApplied;

function blocked(
  status: "blocked" | "failed",
  code: ApplyErrorCode,
  actionType: string,
  message: string,
  oldValue: string | null = null,
  newValue: string | null = null,
): ExecutorBlocked {
  return {
    ok: false,
    status,
    code,
    actionType,
    oldValue,
    newValue,
    message,
    blockedReason: code,
  };
}

function parsePercent(v: string): number | null {
  const m = v.trim().match(/^%?\s*([0-9]+(?:\.[0-9]+)?)\s*%?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseInt32(v: string): number | null {
  const m = v.trim().match(/^([0-9]+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Apply a single ActionPlan request against current system state.
 *
 * Order of checks (fail-closed):
 *   1. confirmApply must be true.
 *   2. actionType must be ALLOWED (not in FORBIDDEN_ACTION_TYPES).
 *   3. actionType must be APPLICABLE in this phase.
 *   4. Find authoritative plan by planId in freshly-generated plans.
 *   5. Authoritative plan must be allowed=true.
 *   6. Authoritative plan recommendedValue must equal request's value.
 *   7. For UPDATE_*_DOWN: parse values, ensure new < current.
 *   8. Apply via direct-DB persistence helpers; verify via independent
 *      SELECT (handled inside updateAndPersistRiskSettings).
 *   9. SET_OBSERVATION_MODE: no DB write, return observed.
 */
export async function executeAction(
  req: ExecutorRequest,
  ctx: ExecutorContext,
): Promise<ExecutorResult> {
  const { planId, actionType, recommendedValue, confirmApply } = req;

  // 1. Explicit user confirmation.
  if (confirmApply !== true) {
    return blocked(
      "blocked",
      "CONFIRMATION_REQUIRED",
      actionType,
      "İkinci onay alınmadı: confirmApply=true gerekir.",
    );
  }

  // 2. Forbidden type guard (defense-in-depth — generator zaten üretmez).
  if ((FORBIDDEN_ACTION_TYPES as readonly string[]).includes(actionType)) {
    return blocked(
      "blocked",
      "FORBIDDEN_ACTION",
      actionType,
      "Bu aksiyon tipi açıkça yasak.",
    );
  }

  // 3. ALLOWED + APPLICABLE in this phase.
  if (!(ALLOWED_ACTION_TYPES as readonly string[]).includes(actionType)) {
    return blocked(
      "blocked",
      "ACTION_NOT_ALLOWED",
      actionType,
      "Aksiyon tipi izinli liste dışı.",
    );
  }
  if (!(APPLICABLE_ACTION_TYPES as readonly string[]).includes(actionType)) {
    return blocked(
      "blocked",
      "ACTION_NOT_ALLOWED",
      actionType,
      "Bu aksiyon tipi sadece inceleme/prompt içindir; uygulanmaz.",
    );
  }

  // 4. Re-generate plans server-side and find authoritative plan.
  const result = await buildAIActionsResult(ctx.userId);
  const auth: ActionPlan | undefined = result.plans.find((p) => p.id === planId);
  if (!auth) {
    return blocked(
      "blocked",
      "PLAN_NOT_FOUND",
      actionType,
      "Bu plan artık aktif değil; güncel öneri listesinde bulunamadı.",
    );
  }
  if (auth.type !== actionType) {
    return blocked(
      "blocked",
      "PLAN_VALUE_MISMATCH",
      actionType,
      `Plan tipi uyuşmuyor: server=${auth.type} request=${actionType}`,
    );
  }
  if (!auth.allowed) {
    return blocked(
      "blocked",
      "PLAN_BLOCKED",
      actionType,
      auth.blockedReason ?? "Plan generator tarafından bloke.",
    );
  }
  // Tam değer eşleşmesi — UI'dan manipüle edilen farklı değer kabul edilmesin.
  // SET_OBSERVATION_MODE gibi değer içermeyen tipler için null ve "" eşit
  // sayılır (plan null taşır, UI body'si "" gönderir).
  const authValue = auth.recommendedValue ?? "";
  const reqValue = recommendedValue ?? "";
  if (authValue !== reqValue) {
    return blocked(
      "blocked",
      "PLAN_VALUE_MISMATCH",
      actionType,
      `Önerilen değer uyuşmuyor: server=${auth.recommendedValue ?? "null"} request=${recommendedValue}`,
      auth.currentValue,
      auth.recommendedValue,
    );
  }

  // 5. SET_OBSERVATION_MODE → audit-only, no DB write.
  if (actionType === "SET_OBSERVATION_MODE") {
    return {
      ok: true,
      status: "observed",
      code: "OBSERVATION_RECORDED",
      actionType: "SET_OBSERVATION_MODE",
      oldValue: null,
      newValue: null,
      message: "Gözlem kararı kaydedildi. Risk ayarı değiştirilmedi.",
    };
  }

  // 6. UPDATE_*_DOWN: parse + downward + persistence.
  const cfg = buildRiskExecutionConfig(getEffectiveRiskSettings());

  if (actionType === "UPDATE_RISK_PER_TRADE_DOWN") {
    return applyPercentDown({
      actionType,
      currentValue: cfg.riskPerTradePercent,
      authCurrentLabel: auth.currentValue,
      authRecommendedLabel: auth.recommendedValue,
      patch: (n) => ({ capital: { riskPerTradePercent: n } }),
    });
  }
  if (actionType === "UPDATE_MAX_DAILY_LOSS_DOWN") {
    return applyPercentDown({
      actionType,
      currentValue: cfg.dailyMaxLossPercent,
      authCurrentLabel: auth.currentValue,
      authRecommendedLabel: auth.recommendedValue,
      patch: (n) => ({ capital: { maxDailyLossPercent: n } }),
    });
  }
  if (actionType === "UPDATE_MAX_OPEN_POSITIONS_DOWN") {
    return applyIntDown({
      actionType,
      currentValue: cfg.dynamicMaxOpenPositions,
      authCurrentLabel: auth.currentValue,
      authRecommendedLabel: auth.recommendedValue,
      patch: (n) => ({ positions: { dynamicMaxOpenPositionsCap: n } }),
    });
  }
  if (actionType === "UPDATE_MAX_DAILY_TRADES_DOWN") {
    return applyIntDown({
      actionType,
      currentValue: cfg.maxDailyTrades,
      authCurrentLabel: auth.currentValue,
      authRecommendedLabel: auth.recommendedValue,
      patch: (n) => ({ positions: { maxDailyTrades: n } }),
    });
  }

  // Fallback — buraya gelmemeli (APPLICABLE_ACTION_TYPES exhaustive).
  return blocked(
    "blocked",
    "ACTION_NOT_ALLOWED",
    actionType,
    "Bilinmeyen apply yolu.",
  );
}

interface PercentDownArgs {
  actionType: ActionPlanType;
  currentValue: number;
  authCurrentLabel: string | null;
  authRecommendedLabel: string | null;
  patch: (newValue: number) => Parameters<typeof updateAndPersistRiskSettings>[0];
}

async function applyPercentDown(args: PercentDownArgs): Promise<ExecutorResult> {
  const { actionType, currentValue, authRecommendedLabel, patch } = args;
  if (!authRecommendedLabel) {
    return blocked(
      "blocked",
      "INVALID_VALUE",
      actionType,
      "Plan'da önerilen değer yok.",
    );
  }
  const newValue = parsePercent(authRecommendedLabel);
  if (newValue == null) {
    return blocked(
      "blocked",
      "INVALID_VALUE",
      actionType,
      `Önerilen değer geçersiz: ${authRecommendedLabel}`,
    );
  }
  if (!(newValue < currentValue)) {
    return blocked(
      "blocked",
      "NOT_A_DOWNWARD_CHANGE",
      actionType,
      `Önerilen değer (%${newValue}) mevcuttan (%${currentValue}) küçük olmalı.`,
      `%${currentValue}`,
      `%${newValue}`,
    );
  }

  const persistResult = await updateAndPersistRiskSettings(patch(newValue));
  if (!persistResult.ok) {
    if (persistResult.stage === "validation") {
      return blocked(
        "failed",
        "INVALID_VALUE",
        actionType,
        `Doğrulama hatası: ${persistResult.errors.join(" | ").slice(0, 200)}`,
        `%${currentValue}`,
        `%${newValue}`,
      );
    }
    return blocked(
      "failed",
      "PERSISTENCE_VERIFY_FAILED",
      actionType,
      `DB kalıcı yazıma alınamadı: ${persistResult.errorSafe.slice(0, 200)}`,
      `%${currentValue}`,
      `%${newValue}`,
    );
  }

  return {
    ok: true,
    status: "applied",
    code: "ACTION_APPLIED",
    actionType,
    oldValue: `%${currentValue}`,
    newValue: `%${newValue}`,
    message: `Risk ayarı %${currentValue} → %${newValue} olarak güncellendi.`,
  };
}

interface IntDownArgs {
  actionType: ActionPlanType;
  currentValue: number;
  authCurrentLabel: string | null;
  authRecommendedLabel: string | null;
  patch: (newValue: number) => Parameters<typeof updateAndPersistRiskSettings>[0];
}

async function applyIntDown(args: IntDownArgs): Promise<ExecutorResult> {
  const { actionType, currentValue, authRecommendedLabel, patch } = args;
  if (!authRecommendedLabel) {
    return blocked(
      "blocked",
      "INVALID_VALUE",
      actionType,
      "Plan'da önerilen değer yok.",
    );
  }
  const newValue = parseInt32(authRecommendedLabel);
  if (newValue == null) {
    return blocked(
      "blocked",
      "INVALID_VALUE",
      actionType,
      `Önerilen değer geçersiz: ${authRecommendedLabel}`,
    );
  }
  if (!(newValue < currentValue)) {
    return blocked(
      "blocked",
      "NOT_A_DOWNWARD_CHANGE",
      actionType,
      `Önerilen değer (${newValue}) mevcuttan (${currentValue}) küçük olmalı.`,
      String(currentValue),
      String(newValue),
    );
  }

  const persistResult = await updateAndPersistRiskSettings(patch(newValue));
  if (!persistResult.ok) {
    if (persistResult.stage === "validation") {
      return blocked(
        "failed",
        "INVALID_VALUE",
        actionType,
        `Doğrulama hatası: ${persistResult.errors.join(" | ").slice(0, 200)}`,
        String(currentValue),
        String(newValue),
      );
    }
    return blocked(
      "failed",
      "PERSISTENCE_VERIFY_FAILED",
      actionType,
      `DB kalıcı yazıma alınamadı: ${persistResult.errorSafe.slice(0, 200)}`,
      String(currentValue),
      String(newValue),
    );
  }

  return {
    ok: true,
    status: "applied",
    code: "ACTION_APPLIED",
    actionType,
    oldValue: String(currentValue),
    newValue: String(newValue),
    message: `Limit ${currentValue} → ${newValue} olarak güncellendi.`,
  };
}
