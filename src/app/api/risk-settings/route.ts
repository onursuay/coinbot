import { z } from "zod";
import { ok, fail, parseBody, isResponse } from "@/lib/api-helpers";
import {
  getRiskSettings,
  updateAndPersistRiskSettings,
  computeWarnings,
  forceReloadFromDb,
  getPersistenceStatus,
  getDebugSnapshot,
  getReadSource,
} from "@/lib/risk-settings";
import { botLog } from "@/lib/logger";
import { getCurrentUserId } from "@/lib/auth";

// Risk Yönetimi config endpoint.
//
// Source of truth: public.bot_settings.risk_settings (JSONB), keyed by
// user_id = '00000000-0000-0000-0000-000000000001'. Direct supabase
// update/select — no RPC, no in-memory shortcut for verify.
//
// Yalnızca config okuma/yazma yapar. Trade engine, signal engine, risk
// engine execution veya canlı trading gate üzerinde HİÇBİR etkisi yok.
// Hiçbir Binance API çağrısı yapmaz.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Always re-read from DB so a warm Vercel lambda never serves stale
  // defaults after another instance persisted new values.
  const reload = await forceReloadFromDb();
  const settings = getRiskSettings();
  const status = getPersistenceStatus();
  const persistenceStatus = status.state === "ok" ? "ok" : "fallback";
  const source = reload.source;
  const userId = getCurrentUserId();

  await botLog({
    userId,
    level: "info",
    eventType: source === "db_bot_settings_risk_settings"
      ? "risk_settings_get_db_loaded"
      : "risk_settings_get_default_fallback",
    message: `Risk GET source=${source} rowExists=${reload.rowFound} dbPresent=${reload.riskSettingsPresent}`,
  });

  const url = new URL(req.url);
  const debug = url.searchParams.get("debug") === "1";

  const base = {
    settings,
    warnings: computeWarnings(settings),
    persistenceStatus,
    persistenceErrorSafe: status.errorSafe,
    lastSavedAt: status.lastSavedAt,
    lastHydratedAt: status.lastHydratedAt,
    source,
  };
  if (!debug) return ok(base);
  const snapshot = await getDebugSnapshot();
  return ok({ ...base, debug: snapshot });
}

const Body = z.object({
  profile: z.enum(["LOW", "STANDARD", "AGGRESSIVE", "CUSTOM"]).optional(),
  capital: z.object({
    totalCapitalUsdt: z.number().min(0).optional(),
    riskPerTradePercent: z.number().min(0).max(100).optional(),
    maxDailyLossPercent: z.number().min(0).max(100).optional(),
  }).optional(),
  positions: z.object({
    defaultMaxOpenPositions: z.number().int().min(1).max(50).optional(),
    dynamicMaxOpenPositionsCap: z.number().int().min(1).max(50).optional(),
    maxDailyTrades: z.number().int().min(1).max(200).optional(),
  }).optional(),
  leverage: z.object({
    CC: z.object({ min: z.number().int().min(1).max(30).optional(), max: z.number().int().min(1).max(30).optional() }).optional(),
    GNMR: z.object({ min: z.number().int().min(1).max(30).optional(), max: z.number().int().min(1).max(30).optional() }).optional(),
    MNLST: z.object({ min: z.number().int().min(1).max(30).optional(), max: z.number().int().min(1).max(30).optional() }).optional(),
  }).optional(),
  direction: z.object({
    longEnabled: z.boolean().optional(),
    shortEnabled: z.boolean().optional(),
  }).optional(),
  stopLoss: z.object({
    mode: z.enum(["SYSTEM", "TIGHT", "STANDARD", "WIDE"]).optional(),
  }).optional(),
  tiered: z.object({
    scaleInProfitEnabled: z.boolean().optional(),
    // averageDownEnabled = true asla kabul edilmez. Sadece literal false
    // izinli — schema seviyesinde kilitlenmiştir.
    averageDownEnabled: z.literal(false).optional(),
  }).optional(),
});

export async function PUT(req: Request) {
  // Re-read from DB so the patch is applied on top of the latest persisted
  // state, not a stale per-instance in-memory copy.
  await forceReloadFromDb();
  const parsed = await parseBody(req, Body);
  if (isResponse(parsed)) return parsed;
  const userId = getCurrentUserId();

  const payloadDigest = JSON.stringify({
    p: parsed.profile,
    cap: parsed.capital?.totalCapitalUsdt,
    risk: parsed.capital?.riskPerTradePercent,
    loss: parsed.capital?.maxDailyLossPercent,
    defPos: parsed.positions?.defaultMaxOpenPositions,
    dynCap: parsed.positions?.dynamicMaxOpenPositionsCap,
    maxTr: parsed.positions?.maxDailyTrades,
    sl: parsed.stopLoss?.mode,
    long: parsed.direction?.longEnabled,
    short: parsed.direction?.shortEnabled,
  });

  await botLog({
    userId, level: "info", eventType: "risk_settings_save_clicked",
    message: `Risk save payload: ${payloadDigest}`,
  });
  await botLog({
    userId, level: "info", eventType: "risk_settings_db_upsert_started",
    message: `Risk DB upsert başladı: payload=${payloadDigest}`,
  });

  const result = await updateAndPersistRiskSettings(parsed);
  if (!result.ok) {
    if (result.stage === "validation") {
      await botLog({
        userId, level: "warn", eventType: "risk_settings_save_failed",
        message: `Risk validation reddi: ${result.errors.join(" | ").slice(0, 200)} | payload=${payloadDigest}`,
      });
      return fail("Geçersiz risk ayarı", 400, { errors: result.errors });
    }
    // Persistence failure must NOT silently report success.
    await botLog({
      userId, level: "error", eventType: "risk_settings_db_verify_failed",
      message: `Risk DB verify başarısız: ${result.errorSafe.slice(0, 200)} | payload=${payloadDigest}`,
    });
    await botLog({
      userId, level: "error", eventType: "risk_settings_save_failed",
      message: `Risk DB yazılamadı: ${result.errorSafe.slice(0, 200)} | payload=${payloadDigest}`,
    });
    return fail("Risk ayarları kalıcı olarak kaydedilemedi", 500, {
      persistenceStatus: "error",
      persistenceErrorSafe: result.errorSafe,
      settings: result.data,
    });
  }

  const savedDigest = JSON.stringify({
    p: result.data.profile,
    cap: result.data.capital.totalCapitalUsdt,
    risk: result.data.capital.riskPerTradePercent,
    loss: result.data.capital.maxDailyLossPercent,
    defPos: result.data.positions.defaultMaxOpenPositions,
    dynCap: result.data.positions.dynamicMaxOpenPositionsCap,
  });

  await botLog({
    userId, level: "info", eventType: "risk_settings_db_upsert_succeeded",
    message: `Risk DB upsert başarılı via=${result.via}`,
  });
  await botLog({
    userId, level: "info", eventType: "risk_settings_db_verify_started",
    message: `Risk DB verify başladı: expected=${savedDigest}`,
  });
  await botLog({
    userId, level: "info", eventType: "risk_settings_db_verify_succeeded",
    message: `Risk DB verify başarılı: ${savedDigest}`,
  });
  await botLog({
    userId, level: "info", eventType: "risk_settings_save_success",
    message: `Risk kaydedildi via=${result.via}: ${savedDigest}`,
  });

  return ok({
    settings: result.data,
    warnings: computeWarnings(result.data),
    persistenceStatus: "saved",
    savedAt: result.savedAt,
    source: getReadSource(),
  });
}
