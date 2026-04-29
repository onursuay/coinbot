// Phase 10 — Risk Yönetimi in-memory store.
//
// Vercel serverless: birden fazla lambda instance paralel koşar. Bu yüzden
// API GET path her çağrıda DB'den yeniden okur (forceReloadFromDb). Aksi
// halde A instance'ı PUT'la DB'yi günceller ama B instance'ı kendi
// hydrated=true cache'iyle eski default değerleri döner — kullanıcı hard
// refresh sonrası ayarların kaybolduğunu görür.
//
// Trade engine sync getRiskSettings() çağırır; bu da en son hydrate edilmiş
// state'i döner. Worker tick'leri ensureHydrated() çağırarak cold start'tan
// sonra ilk tick'te DB'den yükler. Hiçbir live trading gate fonksiyonu bu
// store'a bağlı değildir.

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

/**
 * Reads the persisted row from Supabase. Goes through the get_risk_settings
 * RPC so PostgREST's per-column schema cache for the freshly-added JSONB
 * column never enters the picture. Falls back to a column-level SELECT
 * only if the RPC isn't deployed yet.
 *
 * State is replaced atomically when validation passes; on validation
 * failure the in-memory defaults are kept and persistenceStatus moves to
 * "fallback".
 */
async function readFromDb(): Promise<{
  rowFound: boolean;
  riskSettingsPresent: boolean;
}> {
  if (!supabaseConfigured()) {
    setStatus({ state: "unconfigured" });
    return { rowFound: false, riskSettingsPresent: false };
  }
  try {
    const userId = getCurrentUserId();
    const sb = supabaseAdmin();

    // Primary path — RPC. Returns the JSONB payload directly via raw SQL,
    // so PostgREST never has to resolve the risk_settings column.
    let stored: unknown = null;
    let rowFound = false;
    const rpcRead = await sb.rpc("get_risk_settings", { p_user_id: userId });
    if (!rpcRead.error) {
      stored = rpcRead.data ?? null;
      // RPC returns NULL only when the row exists with a NULL column or
      // the row doesn't exist at all. Either way the in-memory defaults
      // are correct; row presence is checked through a tiny REST select
      // so diagnostics can distinguish the two cases.
      const { data: rowProbe } = await sb
        .from("bot_settings")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();
      rowFound = rowProbe != null;
    } else {
      // Fallback — RPC not deployed yet. Column-level select; this is
      // exactly the path that hits PostgREST cache issues, but we keep
      // it for environments without 0016.
      const { data, error } = await sb
        .from("bot_settings")
        .select("risk_settings")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      rowFound = data != null;
      stored = (data as any)?.risk_settings ?? null;
    }
    const riskSettingsPresent = stored != null;
    if (stored) {
      const merged = mergeStored(stored);
      if (merged) {
        state = clone(merged);
        setStatus({
          state: "ok",
          lastHydratedAt: Date.now(),
          lastSavedAt: persistenceStatus.lastSavedAt,
        });
      } else {
        setStatus({
          state: "fallback",
          errorSafe: "stored risk_settings failed validation",
          lastHydratedAt: Date.now(),
          lastSavedAt: persistenceStatus.lastSavedAt,
        });
      }
    } else {
      // No stored payload yet — defaults are correct, not a failure.
      setStatus({
        state: "ok",
        lastHydratedAt: Date.now(),
        lastSavedAt: persistenceStatus.lastSavedAt,
      });
    }
    return { rowFound, riskSettingsPresent };
  } catch (e) {
    setStatus({
      state: "fallback",
      errorSafe: safeErr(e),
      lastHydratedAt: persistenceStatus.lastHydratedAt,
      lastSavedAt: persistenceStatus.lastSavedAt,
    });
    return { rowFound: false, riskSettingsPresent: false };
  }
}

async function hydrateFromDb(): Promise<void> {
  if (hydrated) return;
  await readFromDb();
  hydrated = true;
}

export function ensureHydrated(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (!hydrationPromise) hydrationPromise = hydrateFromDb();
  return hydrationPromise;
}

/**
 * Force a fresh read from the DB regardless of the per-process hydrated
 * flag. Used by the GET API path so reads are coherent across Vercel
 * lambda instances (a warm instance must not serve stale defaults after
 * another instance persisted new values).
 */
export async function forceReloadFromDb(): Promise<{
  rowFound: boolean;
  riskSettingsPresent: boolean;
}> {
  const r = await readFromDb();
  hydrated = true;
  return r;
}

/**
 * Awaited persistence. Returns ok:false with safe error string on failure
 * — caller must surface this to the UI; it is no longer fire-and-forget.
 */
async function persistToDb(s: RiskSettings): Promise<{ ok: true; savedAt: number } | { ok: false; errorSafe: string }> {
  if (!supabaseConfigured()) {
    return { ok: false, errorSafe: "Supabase not configured" };
  }
  const sb = supabaseAdmin();
  const userId = getCurrentUserId();
  try {
    // Primary path — RPC bypasses PostgREST column resolution for writes.
    // The plpgsql function executes UPDATE/INSERT in raw SQL and surfaces
    // the stored value via RETURNING. The non-null return value IS the
    // proof of persistence — we don't follow up with a column-level
    // SELECT because that path hits PostgREST's stale schema cache for
    // the JSONB column and returns null even when the row is correct.
    const rpcRes = await sb.rpc("set_risk_settings", {
      p_user_id: userId,
      p_settings: s as unknown as Record<string, unknown>,
    });
    if (!rpcRes.error && rpcRes.data != null) {
      const savedAt = Date.now();
      setStatus({
        state: "ok",
        lastSavedAt: savedAt,
        lastHydratedAt: persistenceStatus.lastHydratedAt,
      });
      return { ok: true, savedAt };
    }
    let lastErr: string | null = rpcRes.error ? safeErr(rpcRes.error) : null;

    // Fallback — RPC not deployed yet (migration 0015 missing) or other
    // PostgREST function-cache issue. Try upsert + select-then-update/insert
    // so an older environment still saves.
    const { error: upsertErr } = await sb
      .from("bot_settings")
      .upsert({ user_id: userId, risk_settings: s }, { onConflict: "user_id" });
    if (upsertErr) {
      lastErr = safeErr(upsertErr);
      const { data: existing, error: selErr } = await sb
        .from("bot_settings")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (selErr) throw selErr;
      if (existing) {
        const { error: updErr } = await sb
          .from("bot_settings")
          .update({ risk_settings: s })
          .eq("user_id", userId);
        if (updErr) throw updErr;
      } else {
        const { error: insErr } = await sb
          .from("bot_settings")
          .insert({ user_id: userId, risk_settings: s });
        if (insErr) throw insErr;
      }
    }

    // Verify only on the fallback path — RPC's RETURNING is already
    // authoritative when it succeeds. Use the same get_risk_settings RPC
    // for the read so PostgREST column cache stays out of the way.
    const verifyRpc = await sb.rpc("get_risk_settings", { p_user_id: userId });
    let storedAfter: unknown = null;
    if (!verifyRpc.error) {
      storedAfter = verifyRpc.data ?? null;
    } else {
      const { data: verify, error: verifyErr } = await sb
        .from("bot_settings")
        .select("risk_settings")
        .eq("user_id", userId)
        .maybeSingle();
      if (verifyErr) throw verifyErr;
      storedAfter = (verify as any)?.risk_settings ?? null;
    }
    if (storedAfter == null) {
      const hint = lastErr ? ` (last write error: ${lastErr})` : "";
      throw new Error(`DB write verified empty — risk_settings did not persist${hint}`);
    }
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

/**
 * Safe debug snapshot for the GET ?debug=1 endpoint. Reads the DB row
 * directly so the response reflects current persisted state, not the
 * per-instance in-memory cache. Returns no secrets.
 */
export interface RiskSettingsDebugSnapshot {
  hasSupabaseConfigured: boolean;
  selectedUserId: string;
  persistenceStatus: PersistenceState;
  persistenceErrorSafe?: string;
  lastSavedAt?: number;
  lastHydratedAt?: number;
  dbRowFound: boolean;
  dbRiskSettingsPresent: boolean;
  dbRiskSettingsProfile: RiskProfileKey | null;
  dbRiskSettingsCapital: number | null;
  inMemoryProfile: RiskProfileKey;
  inMemoryCapital: number;
  hydratedFlag: boolean;
}

export async function getDebugSnapshot(): Promise<RiskSettingsDebugSnapshot> {
  const hasSupabaseConfigured = supabaseConfigured();
  const selectedUserId = getCurrentUserId();
  let dbRowFound = false;
  let dbRiskSettingsPresent = false;
  let dbRiskSettingsProfile: RiskProfileKey | null = null;
  let dbRiskSettingsCapital: number | null = null;
  if (hasSupabaseConfigured) {
    try {
      const sb = supabaseAdmin();
      // Row presence — small select that doesn't depend on JSONB column cache.
      const { data: rowProbe } = await sb
        .from("bot_settings")
        .select("user_id")
        .eq("user_id", selectedUserId)
        .maybeSingle();
      dbRowFound = rowProbe != null;

      // JSONB payload — through RPC so PostgREST column cache stays out.
      const rpcRead = await sb.rpc("get_risk_settings", { p_user_id: selectedUserId });
      let stored: unknown = null;
      if (!rpcRead.error) {
        stored = rpcRead.data ?? null;
      } else {
        const { data: legacy } = await sb
          .from("bot_settings")
          .select("risk_settings")
          .eq("user_id", selectedUserId)
          .maybeSingle();
        stored = (legacy as any)?.risk_settings ?? null;
      }
      dbRiskSettingsPresent = stored != null;
      if (stored && typeof stored === "object") {
        const p = (stored as any).profile;
        if (p === "LOW" || p === "STANDARD" || p === "AGGRESSIVE" || p === "CUSTOM") {
          dbRiskSettingsProfile = p;
        }
        const cap = (stored as any).capital?.totalCapitalUsdt;
        if (typeof cap === "number" && Number.isFinite(cap)) {
          dbRiskSettingsCapital = cap;
        }
      }
    } catch {
      // Diagnostics-only — surface DB read errors via persistenceStatus already.
    }
  }
  return {
    hasSupabaseConfigured,
    selectedUserId,
    persistenceStatus: persistenceStatus.state,
    persistenceErrorSafe: persistenceStatus.errorSafe,
    lastSavedAt: persistenceStatus.lastSavedAt,
    lastHydratedAt: persistenceStatus.lastHydratedAt,
    dbRowFound,
    dbRiskSettingsPresent,
    dbRiskSettingsProfile,
    dbRiskSettingsCapital,
    inMemoryProfile: state.profile,
    inMemoryCapital: state.capital.totalCapitalUsdt,
    hydratedFlag: hydrated,
  };
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
