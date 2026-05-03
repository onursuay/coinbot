// AI Aksiyon Merkezi — Faz 3: POST /api/ai-actions/apply
//
// Kullanıcı onaylı güvenli aksiyon uygulama endpoint'i.
//
// MUTLAK KURALLAR:
//   • confirmApply !== true → CONFIRMATION_REQUIRED.
//   • Yasak action type → FORBIDDEN_ACTION.
//   • Yalnızca APPLICABLE_ACTION_TYPES uygulanabilir; diğerleri ACTION_NOT_ALLOWED.
//   • UI'dan gelen plan, server-side yeniden üretilen yetkili planla
//     karşılaştırılır; uyuşmazsa PLAN_VALUE_MISMATCH.
//   • Önerilen değer mevcuttan düşük olmalı; aksi NOT_A_DOWNWARD_CHANGE.
//   • Risk persistence direct DB + independent verify; hata
//     PERSISTENCE_VERIFY_FAILED.
//   • Hiçbir Binance API çağrısı, hiçbir live trading toggle.
//
// Audit log eventleri (bot_logs):
//   • ai_action_apply_requested
//   • ai_action_apply_blocked
//   • ai_action_applied
//   • ai_action_apply_failed
//   • ai_action_observation_set

import { z } from "zod";
import { ok, fail, parseBody, isResponse } from "@/lib/api-helpers";
import { getCurrentUserId } from "@/lib/auth";
import { botLog } from "@/lib/logger";
import { executeAction } from "@/lib/ai-actions";
import { buildRiskExecutionConfig, getEffectiveRiskSettings } from "@/lib/risk-settings/apply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  planId: z.string().min(1),
  actionType: z.string().min(1),
  recommendedValue: z.string(),
  confirmApply: z.boolean(),
});

function summarizeRiskCfg(): {
  riskPerTradePercent: number;
  dailyMaxLossPercent: number;
  dynamicMaxOpenPositions: number;
  maxDailyTrades: number;
} {
  const cfg = buildRiskExecutionConfig(getEffectiveRiskSettings());
  return {
    riskPerTradePercent: cfg.riskPerTradePercent,
    dailyMaxLossPercent: cfg.dailyMaxLossPercent,
    dynamicMaxOpenPositions: cfg.dynamicMaxOpenPositions,
    maxDailyTrades: cfg.maxDailyTrades,
  };
}

export async function POST(req: Request) {
  const parsed = await parseBody(req, Body);
  if (isResponse(parsed)) return parsed;

  const userId = getCurrentUserId();
  const before = summarizeRiskCfg();

  await botLog({
    userId,
    level: "info",
    eventType: "ai_action_apply_requested",
    message: `apply requested planId=${parsed.planId} type=${parsed.actionType} value=${parsed.recommendedValue} confirm=${parsed.confirmApply}`,
    metadata: {
      planId: parsed.planId,
      actionType: parsed.actionType,
      recommendedValue: parsed.recommendedValue,
      confirmApply: parsed.confirmApply,
      source: "ai_action_center",
      riskSettingsBefore: before,
      timestamp: new Date().toISOString(),
    },
  });

  const result = await executeAction(parsed, { userId });

  if (!result.ok) {
    const eventType =
      result.status === "failed" ? "ai_action_apply_failed" : "ai_action_apply_blocked";
    await botLog({
      userId,
      level: result.status === "failed" ? "error" : "warn",
      eventType,
      message: `apply ${result.status} planId=${parsed.planId} code=${result.code}: ${result.message.slice(0, 200)}`,
      metadata: {
        planId: parsed.planId,
        actionType: parsed.actionType,
        recommendedValue: parsed.recommendedValue,
        userApproval: parsed.confirmApply,
        source: "ai_action_center",
        code: result.code,
        oldValue: result.oldValue,
        newValue: result.newValue,
        blockedReason: result.blockedReason,
        riskSettingsBefore: before,
        timestamp: new Date().toISOString(),
      },
    });

    const httpStatus =
      result.code === "CONFIRMATION_REQUIRED" ||
      result.code === "ACTION_NOT_ALLOWED" ||
      result.code === "FORBIDDEN_ACTION" ||
      result.code === "PLAN_NOT_FOUND" ||
      result.code === "PLAN_VALUE_MISMATCH" ||
      result.code === "PLAN_BLOCKED" ||
      result.code === "NOT_A_DOWNWARD_CHANGE" ||
      result.code === "INVALID_VALUE"
        ? 400
        : 500;

    return fail(result.message, httpStatus, {
      code: result.code,
      status: result.status,
      actionType: result.actionType,
      oldValue: result.oldValue,
      newValue: result.newValue,
      blockedReason: result.blockedReason,
    });
  }

  // Success path: applied or observed.
  const after = summarizeRiskCfg();
  const successEvent =
    result.status === "observed" ? "ai_action_observation_set" : "ai_action_applied";
  await botLog({
    userId,
    level: "info",
    eventType: successEvent,
    message: `apply ${result.status} planId=${parsed.planId} type=${result.actionType}: ${result.message.slice(0, 200)}`,
    metadata: {
      planId: parsed.planId,
      actionType: result.actionType,
      oldValue: result.oldValue,
      newValue: result.newValue,
      userApproval: true,
      source: "ai_action_center",
      riskSettingsBefore: before,
      riskSettingsAfter: after,
      timestamp: new Date().toISOString(),
    },
  });

  return ok({
    code: result.code,
    status: result.status,
    actionType: result.actionType,
    oldValue: result.oldValue,
    newValue: result.newValue,
    message: result.message,
    riskSettingsAfter: after,
  });
}
