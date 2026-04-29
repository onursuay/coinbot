import { z } from "zod";
import { ok, fail, parseBody, isResponse } from "@/lib/api-helpers";
import {
  getRiskSettings,
  updateAndPersistRiskSettings,
  computeWarnings,
  ensureHydrated,
  getPersistenceStatus,
} from "@/lib/risk-settings";

// Phase 10 — Risk Yönetimi config endpoint.
//
// Yalnızca config okuma/yazma yapar. Trade engine, signal engine, risk
// engine execution veya canlı trading gate üzerinde HİÇBİR etkisi yok.
// Hiçbir Binance API çağrısı yapmaz.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureHydrated();
  const settings = getRiskSettings();
  const status = getPersistenceStatus();
  const persistenceStatus = status.state === "ok" ? "ok" : "fallback";
  return ok({
    settings,
    warnings: computeWarnings(settings),
    persistenceStatus,
    persistenceErrorSafe: status.errorSafe,
    lastSavedAt: status.lastSavedAt,
    lastHydratedAt: status.lastHydratedAt,
  });
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
  // Hydrate first so persist isn't writing on top of a stale-empty state.
  await ensureHydrated();
  const parsed = await parseBody(req, Body);
  if (isResponse(parsed)) return parsed;
  const result = await updateAndPersistRiskSettings(parsed);
  if (!result.ok) {
    if (result.stage === "validation") {
      return fail("Geçersiz risk ayarı", 400, { errors: result.errors });
    }
    // Persistence failure must NOT silently report success.
    return fail("Risk ayarları kalıcı olarak kaydedilemedi", 500, {
      persistenceStatus: "error",
      persistenceErrorSafe: result.errorSafe,
      settings: result.data,
    });
  }
  return ok({
    settings: result.data,
    warnings: computeWarnings(result.data),
    persistenceStatus: "saved",
    savedAt: result.savedAt,
  });
}
