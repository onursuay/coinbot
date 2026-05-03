// AI Aksiyon Merkezi — Faz 5: POST /api/ai-actions/rollback
//
// Daha önce AI Aksiyon Merkezi tarafından uygulanmış güvenli risk düşürme
// aksiyonlarını önceki değere döndürür.
//
// MUTLAK KURALLAR:
//   • confirmRollback !== true → CONFIRMATION_REQUIRED.
//   • Yalnızca ROLLBACK_ELIGIBLE_TYPES geri alınabilir.
//   • SET_OBSERVATION_MODE, REQUEST_MANUAL_REVIEW, FORBIDDEN tipler → ROLLBACK_NOT_ALLOWED.
//   • Mevcut değer event.newValue ile uyuşmazsa → ROLLBACK_STATE_MISMATCH.
//   • Daha önce rollback edilmişse → ROLLBACK_NOT_ALLOWED.
//   • Hard cap aşılırsa → HARD_CAP_EXCEEDED.
//   • Risk persistence direct DB + independent verify; hata → ROLLBACK_PERSISTENCE_FAILED.
//   • Binance API çağrısı yoktur. Live trading gate değişikliği yoktur.
//
// Audit log eventleri (bot_logs):
//   • ai_action_rollback_requested
//   • ai_action_rollback_blocked
//   • ai_action_rollback_applied
//   • ai_action_rollback_failed

import { z } from "zod";
import { ok, fail, parseBody, isResponse } from "@/lib/api-helpers";
import { getCurrentUserId } from "@/lib/auth";
import { botLog } from "@/lib/logger";
import { executeRollback } from "@/lib/ai-actions/rollback";
import { buildRiskExecutionConfig, getEffectiveRiskSettings } from "@/lib/risk-settings/apply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  historyItemId: z.string().min(1),
  confirmRollback: z.boolean(),
});

function summarizeRiskCfg() {
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
    eventType: "ai_action_rollback_requested",
    message: `rollback requested historyItemId=${parsed.historyItemId} confirm=${parsed.confirmRollback}`,
    metadata: {
      historyItemId: parsed.historyItemId,
      confirmRollback: parsed.confirmRollback,
      source: "ai_action_center",
      riskSettingsBefore: before,
      timestamp: new Date().toISOString(),
    },
  });

  const result = await executeRollback(parsed, userId);

  if (!result.ok) {
    const eventType =
      result.code === "ROLLBACK_PERSISTENCE_FAILED"
        ? "ai_action_rollback_failed"
        : "ai_action_rollback_blocked";

    await botLog({
      userId,
      level: result.code === "ROLLBACK_PERSISTENCE_FAILED" ? "error" : "warn",
      eventType,
      message: `rollback blocked historyItemId=${parsed.historyItemId} code=${result.code}: ${result.message.slice(0, 200)}`,
      metadata: {
        historyItemId: parsed.historyItemId,
        actionType: result.actionType,
        rollbackToValue: result.rollbackToValue,
        currentValue: result.currentValue,
        code: result.code,
        blockedReason: result.blockedReason,
        source: "ai_action_center",
        riskSettingsBefore: before,
        timestamp: new Date().toISOString(),
      },
    });

    const httpStatus =
      result.code === "CONFIRMATION_REQUIRED" ||
      result.code === "ACTION_HISTORY_NOT_FOUND" ||
      result.code === "ROLLBACK_NOT_ALLOWED" ||
      result.code === "ROLLBACK_STATE_MISMATCH" ||
      result.code === "INVALID_ROLLBACK_VALUE" ||
      result.code === "HARD_CAP_EXCEEDED"
        ? 400
        : 500;

    return fail(result.message, httpStatus, {
      code: result.code,
      actionType: result.actionType,
      rollbackToValue: result.rollbackToValue,
      currentValue: result.currentValue,
      blockedReason: result.blockedReason,
    });
  }

  // Success: applied.
  const after = summarizeRiskCfg();

  await botLog({
    userId,
    level: "info",
    eventType: "ai_action_rollback_applied",
    message: `rollback applied historyItemId=${parsed.historyItemId} type=${result.actionType}: ${result.message.slice(0, 200)}`,
    metadata: {
      ...result.auditPayload,
      riskSettingsBefore: before,
      riskSettingsAfter: after,
    },
  });

  return ok({
    code: result.code,
    actionType: result.actionType,
    rollbackToValue: result.rollbackToValue,
    previousValue: result.previousValue,
    message: result.message,
    riskSettingsAfter: after,
  });
}
