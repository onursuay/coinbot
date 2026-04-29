// Phase 10 — Risk Yönetimi in-memory store.
//
// Scan-modes ile aynı pattern: serverless cold-start'ta in-memory state
// kaybolur, ensureHydrated() çağrısı Supabase'den geri yükler. Hiçbir trade
// engine veya canlı trading gate fonksiyonu bu store'a bağlı değildir.
// Patch'ler validation'dan geçer.

import {
  defaultRiskSettings,
  profileDefaults,
  type RiskProfileKey,
  type RiskSettings,
} from "./types";
import { validateRiskSettings } from "./validation";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth";

let state: RiskSettings = clone(defaultRiskSettings());
let hydrated = false;
let hydrationPromise: Promise<void> | null = null;

export type PersistenceState = "ok" | "fallback" | "unconfigured" | "pending";

interface PersistenceStatus {
  state: PersistenceState;
  /** Safe (sanitized) error string for UI display. */
  errorSafe?: string;
  /** Last successful DB save (epoch ms). */
  lastSavedAt?: number;
  /** Last successful DB read (epoch ms). */
  lastHydratedAt?: number;
}

let persistenceStatus: PersistenceStatus = { state: "pending" };

function setStatus(next: PersistenceStatus): void {
  persistenceStatus = next;
}

function safeErr(e: unknown): string {
  if (!e) return "unknown";
  if (typeof e === "string") return e.slice(0, 200);
  if (e instanceof Error) return e.message.slice(0, 200);
  try {
    const s = JSON.stringify(e);
    return s.length > 200 ? s.slice(0, 200) : s;
  } catch {
    return "unknown";
  }
}

function mergeStored(stored: unknown): RiskSettings | null {
  if (!stored || typeof stored !== "object") return null;
  const s = stored as Partial<RiskSettings> & Record<string, any>;
  const def = defaultRiskSettings();
  const merged: RiskSettings = {
    ...def,
    ...s,
    capital: { ...def.capital, ...(s.capital ?? {}) },
    positions: { ...def.positions, ...(s.positions ?? {}) },
    leverage: {
      CC:    { ...def.leverage.CC,    ...(s.leverage?.CC    ?? {}) },
      GNMR:  { ...def.leverage.GNMR,  ...(s.leverage?.GNMR  ?? {}) },
      MNLST: { ...def.leverage.MNLST, ...(s.leverage?.MNLST ?? {}) },
    },
    direction: { ...def.direction, ...(s.direction ?? {}) },
    stopLoss:  { ...def.stopLoss,  ...(s.stopLoss  ?? {}) },
    // averageDownEnabled hard-locked to false regardless of what the DB holds.
    tiered:    { ...def.tiered,    ...(s.tiered    ?? {}), averageDownEnabled: false },
    appliedToTradeEngine: false,
  };
  const v = validateRiskSettings(merged);
  return v.ok ? merged : null;
}

async function hydrateFromDb(): Promise<void> {
  if (hydrated) return;
  if (!supabaseConfigured()) {
    hydrated = true;
    setStatus({ state: "unconfigured" });
    return;
  }
  try {
    const userId = getCurrentUserId();
    const { data, error } = await supabaseAdmin()
      .from("bot_settings")
      .select("risk_settings")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    const stored = (data as any)?.risk_settings ?? null;
    if (stored) {
      const merged = mergeStored(stored);
      if (merged) {
        state = clone(merged);
        setStatus({ state: "ok", lastHydratedAt: Date.now() });
      } else {
        setStatus({ state: "fallback", errorSafe: "stored risk_settings failed validation", lastHydratedAt: Date.now() });
      }
    } else {
      // No stored row yet — defaults are fine. This is not a failure.
      setStatus({ state: "ok", lastHydratedAt: Date.now() });
    }
  } catch (e) {
    setStatus({ state: "fallback", errorSafe: safeErr(e) });
  } finally {
    hydrated = true;
  }
}

export function ensureHydrated(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (!hydrationPromise) hydrationPromise = hydrateFromDb();
  return hydrationPromise;
}

/**
 * Awaited persistence. Returns ok:false with safe error string on failure
 * — caller must surface this to the UI; it is no longer fire-and-forget.
 */
async function persistToDb(s: RiskSettings): Promise<{ ok: true; savedAt: number } | { ok: false; errorSafe: string }> {
  if (!supabaseConfigured()) {
    return { ok: false, errorSafe: "Supabase not configured" };
  }
  try {
    const userId = getCurrentUserId();
    const { error } = await supabaseAdmin()
      .from("bot_settings")
      .upsert(
        { user_id: userId, risk_settings: s },
        { onConflict: "user_id" },
      );
    if (error) throw error;
    const savedAt = Date.now();
    setStatus({
      state: "ok",
      lastSavedAt: savedAt,
      lastHydratedAt: persistenceStatus.lastHydratedAt,
    });
    return { ok: true, savedAt };
  } catch (e) {
    const errorSafe = safeErr(e);
    setStatus({
      state: "fallback",
      errorSafe,
      lastSavedAt: persistenceStatus.lastSavedAt,
      lastHydratedAt: persistenceStatus.lastHydratedAt,
    });
    return { ok: false, errorSafe };
  }
}

function clone(s: RiskSettings): RiskSettings {
  return {
    profile: s.profile,
    capital: { ...s.capital },
    positions: { ...s.positions },
    leverage: {
      CC:    { ...s.leverage.CC },
      GNMR:  { ...s.leverage.GNMR },
      MNLST: { ...s.leverage.MNLST },
    },
    direction: { ...s.direction },
    stopLoss: { ...s.stopLoss },
    tiered: { ...s.tiered },
    appliedToTradeEngine: false,
    updatedAt: s.updatedAt,
  };
}

export function getRiskSettings(): RiskSettings {
  return clone(state);
}

export function getPersistenceStatus(): PersistenceStatus {
  return { ...persistenceStatus };
}

export interface RiskSettingsPatch {
  profile?: RiskProfileKey;
  capital?: Partial<RiskSettings["capital"]>;
  positions?: Partial<RiskSettings["positions"]>;
  leverage?: {
    CC?: Partial<RiskSettings["leverage"]["CC"]>;
    GNMR?: Partial<RiskSettings["leverage"]["GNMR"]>;
    MNLST?: Partial<RiskSettings["leverage"]["MNLST"]>;
  };
  direction?: Partial<RiskSettings["direction"]>;
  stopLoss?: Partial<RiskSettings["stopLoss"]>;
  tiered?: { scaleInProfitEnabled?: boolean; averageDownEnabled?: false };
}

function applyPatch(
  patch: RiskSettingsPatch,
): { ok: true; data: RiskSettings } | { ok: false; errors: string[] } {
  const next = clone(state);

  // Profil değişiyorsa, ÖZEL dışındakilere defaultları uygula —
  // kullanıcı ayrıca capital/positions vs. patch'lerse onlar üstüne yazar.
  if (patch.profile && patch.profile !== state.profile && patch.profile !== "CUSTOM") {
    const def = profileDefaults(patch.profile);
    next.profile = patch.profile;
    next.capital = { ...def.capital, totalCapitalUsdt: state.capital.totalCapitalUsdt };
    next.positions = { ...def.positions };
    next.leverage = {
      CC:    { ...def.leverage.CC },
      GNMR:  { ...def.leverage.GNMR },
      MNLST: { ...def.leverage.MNLST },
    };
  } else if (patch.profile) {
    next.profile = patch.profile;
  }

  if (patch.capital) Object.assign(next.capital, patch.capital);
  if (patch.positions) Object.assign(next.positions, patch.positions);
  if (patch.leverage) {
    if (patch.leverage.CC)    next.leverage.CC    = { ...next.leverage.CC,    ...patch.leverage.CC };
    if (patch.leverage.GNMR)  next.leverage.GNMR  = { ...next.leverage.GNMR,  ...patch.leverage.GNMR };
    if (patch.leverage.MNLST) next.leverage.MNLST = { ...next.leverage.MNLST, ...patch.leverage.MNLST };
  }
  if (patch.direction) Object.assign(next.direction, patch.direction);
  if (patch.stopLoss) Object.assign(next.stopLoss, patch.stopLoss);
  if (patch.tiered) {
    // averageDownEnabled = true asla kabul edilmez — type sistemine ek
    // olarak runtime guard.
    if ((patch.tiered as { averageDownEnabled?: boolean }).averageDownEnabled === true) {
      return { ok: false, errors: ["Zararda pozisyon büyütme açılamaz (kilitli güvenlik kuralı)."] };
    }
    if (typeof patch.tiered.scaleInProfitEnabled === "boolean") {
      next.tiered.scaleInProfitEnabled = patch.tiered.scaleInProfitEnabled;
    }
    next.tiered.averageDownEnabled = false;
  }

  next.appliedToTradeEngine = false;
  next.updatedAt = Date.now();

  const v = validateRiskSettings(next);
  if (!v.ok) return { ok: false, errors: v.errors };
  state = next;
  return { ok: true, data: clone(state) };
}

/**
 * Synchronous in-memory update. Validates and mutates state. Does NOT
 * touch the DB — keeps tests deterministic. The API path uses
 * `updateAndPersistRiskSettings` which awaits persistence.
 */
export function updateRiskSettings(
  patch: RiskSettingsPatch,
): { ok: true; data: RiskSettings } | { ok: false; errors: string[] } {
  return applyPatch(patch);
}

/**
 * Validate + mutate + await DB persistence. Returns ok:false if the DB
 * write fails so the API/UI can surface a real error rather than reporting
 * a phantom success.
 */
export async function updateAndPersistRiskSettings(
  patch: RiskSettingsPatch,
): Promise<
  | { ok: true; data: RiskSettings; savedAt: number }
  | { ok: false; stage: "validation"; errors: string[] }
  | { ok: false; stage: "persistence"; errorSafe: string; data: RiskSettings }
> {
  const r = applyPatch(patch);
  if (!r.ok) return { ok: false, stage: "validation", errors: r.errors };
  const p = await persistToDb(r.data);
  if (!p.ok) return { ok: false, stage: "persistence", errorSafe: p.errorSafe, data: r.data };
  return { ok: true, data: r.data, savedAt: p.savedAt };
}

/** Test-only helper. */
export function __resetRiskSettingsStoreForTests(): void {
  state = clone(defaultRiskSettings());
  hydrated = false;
  hydrationPromise = null;
  persistenceStatus = { state: "pending" };
}
