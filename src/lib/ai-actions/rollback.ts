// AI Aksiyon Merkezi — Faz 5: SafeRollbackExecutor.
//
// MUTLAK KURALLAR:
//   • Yalnızca ROLLBACK_ELIGIBLE_TYPES geri alınabilir (4 downward tip).
//   • SET_OBSERVATION_MODE, REQUEST_MANUAL_REVIEW ve FORBIDDEN tipler reddedilir.
//   • Mevcut ayar event.newValue ile eşleşmezse ROLLBACK_STATE_MISMATCH.
//   • Aynı event daha önce rollback edilmişse ROLLBACK_NOT_ALLOWED.
//   • Hard caps aşılırsa HARD_CAP_EXCEEDED.
//   • Risk persistence → updateAndPersistRiskSettings (direct DB, independent verify).
//   • Binance endpoint çağrısı YOK. Live trading gate değişikliği YOK.
//   • confirmRollback !== true → CONFIRMATION_REQUIRED.

import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { buildRiskExecutionConfig, getEffectiveRiskSettings } from "@/lib/risk-settings/apply";
import { updateAndPersistRiskSettings } from "@/lib/risk-settings/store";
import { FORBIDDEN_ACTION_TYPES, ROLLBACK_ELIGIBLE_TYPES, type ActionPlanType } from "./types";

export type RollbackErrorCode =
  | "CONFIRMATION_REQUIRED"
  | "ACTION_HISTORY_NOT_FOUND"
  | "ROLLBACK_NOT_ALLOWED"
  | "ROLLBACK_STATE_MISMATCH"
  | "INVALID_ROLLBACK_VALUE"
  | "ROLLBACK_PERSISTENCE_FAILED"
  | "HARD_CAP_EXCEEDED";

export type RollbackSuccessCode = "ROLLBACK_APPLIED";

export interface RollbackRequest {
  historyItemId: string;
  confirmRollback: boolean;
}

interface RollbackBlocked {
  ok: false;
  code: RollbackErrorCode;
  actionType: string | null;
  rollbackToValue: string | null;
  currentValue: string | null;
  message: string;
  blockedReason: string;
}

interface RollbackApplied {
  ok: true;
  code: RollbackSuccessCode;
  actionType: ActionPlanType;
  rollbackToValue: string;
  previousValue: string;
  message: string;
  auditPayload: Record<string, unknown>;
}

export type RollbackResult = RollbackBlocked | RollbackApplied;

// Hard caps — rollback cannot restore values above these absolute limits.
const ROLLBACK_HARD_CAPS: Record<string, number> = {
  UPDATE_RISK_PER_TRADE_DOWN: 10.0,
  UPDATE_MAX_DAILY_LOSS_DOWN: 25.0,
  UPDATE_MAX_OPEN_POSITIONS_DOWN: 20,
  UPDATE_MAX_DAILY_TRADES_DOWN: 100,
};

function blocked(
  code: RollbackErrorCode,
  message: string,
  actionType: string | null = null,
  rollbackToValue: string | null = null,
  currentValue: string | null = null,
): RollbackBlocked {
  return { ok: false, code, actionType, rollbackToValue, currentValue, message, blockedReason: code };
}

function parsePercent(v: string): number | null {
  const m = v.trim().match(/^%?\s*([0-9]+(?:\.[0-9]+)?)\s*%?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseIntVal(v: string): number | null {
  const m = v.trim().match(/^([0-9]+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function safeStr(v: unknown): string | null {
  if (typeof v === "string" && v.trim().length > 0) return v;
  return null;
}

/**
 * Execute a rollback of a previously applied AI action.
 *
 * Order of checks (fail-closed):
 *   1. confirmRollback must be true.
 *   2. Find the target bot_logs event by historyItemId.
 *   3. Event must be ai_action_applied.
 *   4. actionType must be in ROLLBACK_ELIGIBLE_TYPES (and not FORBIDDEN).
 *   5. No prior ai_action_rollback_applied event references this event ID.
 *   6. Current risk value must match event's newValue (state mismatch guard).
 *   7. Parse rollbackToValue (event's oldValue); hard cap check.
 *   8. Apply via updateAndPersistRiskSettings + independent verify.
 */
export async function executeRollback(
  req: RollbackRequest,
  userId: string,
): Promise<RollbackResult> {
  const { historyItemId, confirmRollback } = req;

  if (confirmRollback !== true) {
    return blocked("CONFIRMATION_REQUIRED", "Rollback onayı gerekiyor: confirmRollback=true zorunlu.");
  }

  if (!supabaseConfigured()) {
    return blocked("ACTION_HISTORY_NOT_FOUND", "Supabase yapılandırılmamış.");
  }

  const sb = supabaseAdmin();

  // Fetch the target history event.
  const { data: rows, error: fetchErr } = await sb
    .from("bot_logs")
    .select("id, event_type, metadata, created_at")
    .eq("user_id", userId)
    .eq("id", historyItemId)
    .limit(1);

  if (fetchErr || !rows || rows.length === 0) {
    return blocked("ACTION_HISTORY_NOT_FOUND", "Belirtilen aksiyon geçmiş kaydı bulunamadı.");
  }

  const row = rows[0] as { id: unknown; event_type: string; metadata: unknown };

  if (row.event_type !== "ai_action_applied") {
    return blocked(
      "ROLLBACK_NOT_ALLOWED",
      `Bu event tipi rollback edilemez: ${row.event_type}`,
    );
  }

  // Parse metadata.
  let rawMeta: Record<string, unknown> = {};
  if (row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)) {
    rawMeta = row.metadata as Record<string, unknown>;
  }

  const actionType = safeStr(rawMeta.actionType);
  const oldValue = safeStr(rawMeta.oldValue);
  const newValue = safeStr(rawMeta.newValue);

  if (!actionType || !oldValue || !newValue) {
    return blocked(
      "ROLLBACK_NOT_ALLOWED",
      "Event metadata'sında actionType, oldValue veya newValue eksik.",
      actionType,
    );
  }

  if (!(ROLLBACK_ELIGIBLE_TYPES as readonly string[]).includes(actionType)) {
    return blocked(
      "ROLLBACK_NOT_ALLOWED",
      `Bu aksiyon tipi rollback edilemez: ${actionType}`,
      actionType,
    );
  }

  // Defense-in-depth: forbidden types cannot be rolled back.
  if ((FORBIDDEN_ACTION_TYPES as readonly string[]).includes(actionType)) {
    return blocked("ROLLBACK_NOT_ALLOWED", "Yasak aksiyon tipi rollback edilemez.", actionType);
  }

  // Check if already rolled back (query recent rollback_applied events, filter in JS).
  const { data: priorRollbacks } = await sb
    .from("bot_logs")
    .select("id, metadata")
    .eq("user_id", userId)
    .eq("event_type", "ai_action_rollback_applied")
    .limit(200);

  const alreadyRolledBack = (priorRollbacks ?? []).some((r: Record<string, unknown>) => {
    const meta = r.metadata;
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
    return String((meta as Record<string, unknown>).rollbackOfEventId) === String(historyItemId);
  });

  if (alreadyRolledBack) {
    return blocked(
      "ROLLBACK_NOT_ALLOWED",
      "Bu aksiyon daha önce geri alınmış.",
      actionType,
      oldValue,
    );
  }

  // State mismatch: current risk value must match event's newValue.
  const cfg = buildRiskExecutionConfig(getEffectiveRiskSettings());
  const isPercentType =
    actionType === "UPDATE_RISK_PER_TRADE_DOWN" ||
    actionType === "UPDATE_MAX_DAILY_LOSS_DOWN";

  let currentNumericValue: number;
  if (actionType === "UPDATE_RISK_PER_TRADE_DOWN") {
    currentNumericValue = cfg.riskPerTradePercent;
  } else if (actionType === "UPDATE_MAX_DAILY_LOSS_DOWN") {
    currentNumericValue = cfg.dailyMaxLossPercent;
  } else if (actionType === "UPDATE_MAX_OPEN_POSITIONS_DOWN") {
    currentNumericValue = cfg.dynamicMaxOpenPositions;
  } else {
    currentNumericValue = cfg.maxDailyTrades;
  }

  const eventNewNumeric = isPercentType ? parsePercent(newValue) : parseIntVal(newValue);
  if (eventNewNumeric == null) {
    return blocked(
      "ROLLBACK_NOT_ALLOWED",
      `Event'teki newValue geçersiz format: ${newValue}`,
      actionType,
      oldValue,
    );
  }

  const currentLabel = isPercentType ? `%${currentNumericValue}` : String(currentNumericValue);
  if (Math.abs(currentNumericValue - eventNewNumeric) > 0.001) {
    return blocked(
      "ROLLBACK_STATE_MISMATCH",
      `Mevcut ayar (${currentLabel}) event değeriyle (${newValue}) uyuşmuyor; güvenli geri alma yapılamaz.`,
      actionType,
      oldValue,
      currentLabel,
    );
  }

  // Parse rollback target value.
  const rollbackToNumeric = isPercentType ? parsePercent(oldValue) : parseIntVal(oldValue);
  if (rollbackToNumeric == null) {
    return blocked(
      "INVALID_ROLLBACK_VALUE",
      `Geri alınacak değer geçersiz format: ${oldValue}`,
      actionType,
    );
  }

  // Hard cap check.
  const hardCap = ROLLBACK_HARD_CAPS[actionType];
  if (hardCap !== undefined && rollbackToNumeric > hardCap) {
    return blocked(
      "HARD_CAP_EXCEEDED",
      `Geri alınacak değer (${rollbackToNumeric}) güvenlik üst sınırını (${hardCap}) aşıyor.`,
      actionType,
      oldValue,
    );
  }

  // Apply rollback via direct DB persistence.
  let patch: Parameters<typeof updateAndPersistRiskSettings>[0];
  if (actionType === "UPDATE_RISK_PER_TRADE_DOWN") {
    patch = { capital: { riskPerTradePercent: rollbackToNumeric } };
  } else if (actionType === "UPDATE_MAX_DAILY_LOSS_DOWN") {
    patch = { capital: { maxDailyLossPercent: rollbackToNumeric } };
  } else if (actionType === "UPDATE_MAX_OPEN_POSITIONS_DOWN") {
    patch = { positions: { dynamicMaxOpenPositionsCap: rollbackToNumeric } };
  } else {
    patch = { positions: { maxDailyTrades: rollbackToNumeric } };
  }

  const persistResult = await updateAndPersistRiskSettings(patch);
  if (!persistResult.ok) {
    const errMsg =
      persistResult.stage === "validation"
        ? persistResult.errors.join(" | ").slice(0, 200)
        : persistResult.errorSafe.slice(0, 200);
    return blocked(
      "ROLLBACK_PERSISTENCE_FAILED",
      `Rollback DB'ye yazılamadı: ${errMsg}`,
      actionType,
      oldValue,
    );
  }

  const rollbackToLabel = isPercentType ? `%${rollbackToNumeric}` : String(rollbackToNumeric);

  const auditPayload: Record<string, unknown> = {
    rollbackOfEventId: String(historyItemId),
    actionType,
    rollbackToValue: rollbackToLabel,
    // oldValue/newValue for HistoryItem mapper (shows the transition in UI)
    oldValue: currentLabel,
    newValue: rollbackToLabel,
    currentValue: currentLabel,
    userApproval: true,
    source: "ai_action_center",
    timestamp: new Date().toISOString(),
  };

  return {
    ok: true,
    code: "ROLLBACK_APPLIED",
    actionType: actionType as ActionPlanType,
    rollbackToValue: rollbackToLabel,
    previousValue: currentLabel,
    message: `${actionType} geri alındı: ${currentLabel} → ${rollbackToLabel}`,
    auditPayload,
  };
}
