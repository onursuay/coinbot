// Risk Yönetimi kalıcılık katmanı.
//
// SOURCE OF TRUTH:
//   Tablo  : public.bot_settings
//   Row    : user_id = '00000000-0000-0000-0000-000000000001' (single tenant)
//   Kolon  : risk_settings JSONB
//
// Tüm yazma/okuma DOĞRUDAN bu kolon üzerinden yapılır. RPC, in-memory cache
// veya başka bir aldatıcı katman kullanılmaz. Vercel serverless: birden fazla
// lambda instance paralel koşar; bu yüzden GET path her çağrıda DB'den
// yeniden okur (forceReloadFromDb).
//
// Trade engine sync getRiskSettings() çağırır; bu da en son hydrate edilmiş
// state'i döner. Worker tick'leri ensureHydrated() çağırarak cold start'tan
// sonra ilk tick'te DB'den yükler. Hiçbir live trading gate fonksiyonu bu
// store'a bağlı değildir; appliedToTradeEngine = false invariant'i korunur.

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
let lastReadSource: ReadSource = "pending";

export type PersistenceState = "ok" | "fallback" | "unconfigured" | "pending";

/**
 * Risk settings okumasının nereden geldiğini gösterir. Debug + UI için
 * kullanılır; in-memory cache yerine kullanıcının DB durumunu doğru
 * yansıtır.
 */
export type ReadSource =
  | "db_bot_settings_risk_settings"
  | "default_fallback_no_db_settings"
  | "pending";

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

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";

/**
 * Single-tenant scaffolding. The system user_id is hard-coded so persistence
 * cannot accidentally fan out to a wrong row even if `getCurrentUserId()` is
 * later modified for multi-tenant.
 */
function resolveUserId(): string {
  const fromAuth = getCurrentUserId();
  return fromAuth || SYSTEM_USER_ID;
}

/**
 * Reads the persisted row from Supabase via direct table SELECT (no RPC).
 * Returns the source of truth indicator for diagnostics.
 *
 * State is replaced atomically when validation passes; on validation
 * failure the in-memory defaults are kept and persistenceStatus moves to
 * "fallback".
 */
async function readFromDb(): Promise<{
  rowFound: boolean;
  riskSettingsPresent: boolean;
  source: ReadSource;
}> {
  if (!supabaseConfigured()) {
    setStatus({ state: "unconfigured" });
    lastReadSource = "default_fallback_no_db_settings";
    return { rowFound: false, riskSettingsPresent: false, source: lastReadSource };
  }
  try {
    const userId = resolveUserId();
    const sb = supabaseAdmin();

    // Use get_risk_settings RPC — bypasses PostgREST per-instance column cache.
    // Supabase load-balances across multiple PostgREST instances; some may have
    // stale schema cache returning null for risk_settings even when DB has data.
    // The RPC executes at the PostgreSQL layer (SECURITY DEFINER plpgsql) and
    // always reads the actual column, regardless of PostgREST cache state.
    const { data: rpcData, error: rpcError } = await sb.rpc("get_risk_settings", {
      p_user_id: userId,
    });

    if (rpcError) throw rpcError;

    // Determine row existence via a lightweight direct SELECT on non-JSONB column.
    // This is just for diagnostics (rowFound flag) and uses a column that has
    // been in the schema from the start, so its cache is always fresh.
    const rowCheck = await sb
      .from("bot_settings")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    const rowFound = rowCheck.data != null;
    const stored = rpcData ?? null;
    const riskSettingsPresent = stored != null;

    if (stored) {
      const merged = mergeStored(stored);
      if (merged) {
        state = clone(merged);
        lastReadSource = "db_bot_settings_risk_settings";
        setStatus({
          state: "ok",
          lastHydratedAt: Date.now(),
          lastSavedAt: persistenceStatus.lastSavedAt,
        });
      } else {
        // Validation failed on stored payload — keep defaults but flag.
        lastReadSource = "default_fallback_no_db_settings";
        setStatus({
          state: "fallback",
          errorSafe: "stored risk_settings failed validation",
          lastHydratedAt: Date.now(),
          lastSavedAt: persistenceStatus.lastSavedAt,
        });
      }
    } else {
      // No payload — defaults are correct, not a failure. Source is "default".
      lastReadSource = "default_fallback_no_db_settings";
      setStatus({
        state: "ok",
        lastHydratedAt: Date.now(),
        lastSavedAt: persistenceStatus.lastSavedAt,
      });
    }
    return { rowFound, riskSettingsPresent, source: lastReadSource };
  } catch (e) {
    lastReadSource = "default_fallback_no_db_settings";
    setStatus({
      state: "fallback",
      errorSafe: safeErr(e),
      lastHydratedAt: persistenceStatus.lastHydratedAt,
      lastSavedAt: persistenceStatus.lastSavedAt,
    });
    return { rowFound: false, riskSettingsPresent: false, source: lastReadSource };
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
 * Force a fresh read from the DB regardless of the per-process hydrated flag.
 * Used by the GET API path so reads are coherent across Vercel lambda
 * instances.
 */
export async function forceReloadFromDb(): Promise<{
  rowFound: boolean;
  riskSettingsPresent: boolean;
  source: ReadSource;
}> {
  const r = await readFromDb();
  hydrated = true;
  return r;
}

/**
 * Awaited persistence. Direct table UPDATE/INSERT — no RPC, no in-memory
 * shortcut. Returns ok:false with safe error on failure so the API/UI can
 * surface a real error rather than reporting phantom success.
 *
 * Strategy:
 *  1. Ensure row exists (INSERT ... ON CONFLICT DO NOTHING).
 *  2. UPDATE risk_settings column with .select() chain so PostgREST is
 *     forced to return the actually-stored row (catches phantom drops).
 *  3. Independent verify SELECT on the same column — must echo what we sent.
 */
async function persistToDb(
  s: RiskSettings,
): Promise<
  | { ok: true; savedAt: number; via: "rpc_set_risk_settings" }
  | { ok: false; errorSafe: string }
> {
  if (!supabaseConfigured()) {
    return { ok: false, errorSafe: "Supabase not configured" };
  }
  const sb = supabaseAdmin();
  const userId = resolveUserId();

  try {
    // Write via set_risk_settings RPC — bypasses PostgREST's per-column
    // schema cache for write paths, which silently drops updates to the
    // freshly-added risk_settings JSONB column even after NOTIFY reload.
    // The RPC executes raw SQL inside the DB, so column resolution happens
    // at the plpgsql layer, not at the REST layer.
    const rpcResult = await sb.rpc("set_risk_settings", {
      p_user_id: userId,
      p_settings: s as unknown as Record<string, unknown>,
    });

    if (rpcResult.error) {
      // RPC function may not exist — capture descriptive error.
      throw Object.assign(rpcResult.error, {
        _context: `set_risk_settings RPC error (function may be missing or have wrong signature)`,
      });
    }

    // Independent verify via get_risk_settings RPC — DO NOT use direct SELECT.
    // Supabase load-balances across multiple PostgREST instances; some may have
    // stale schema cache that returns null for the risk_settings column even
    // when the DB has a real value. The get_risk_settings RPC runs at the
    // PostgreSQL layer (SECURITY DEFINER plpgsql) and always sees the actual
    // column, bypassing per-instance PostgREST column resolution entirely.
    const verRpc = await sb.rpc("get_risk_settings", { p_user_id: userId });
    if (verRpc.error) throw verRpc.error;

    const stored = verRpc.data as {
      profile?: string;
      capital?: { totalCapitalUsdt?: number };
      updatedAt?: number;
    } | null;

    if (!stored) {
      return {
        ok: false,
        errorSafe: "get_risk_settings RPC null döndürdü — satır yok veya risk_settings null.",
      };
    }

    const expectedProfile = s.profile;
    const expectedCap = s.capital.totalCapitalUsdt;
    const expectedUpdatedAt = s.updatedAt;
    const verifiedProfile = stored.profile;
    const verifiedCap = stored.capital?.totalCapitalUsdt;
    const verifiedUpdatedAt = stored.updatedAt;

    const profileOk = verifiedProfile === expectedProfile;
    const capOk = typeof verifiedCap === "number" && verifiedCap === expectedCap;
    // updatedAt in DB must match what we just wrote — old timestamp means write was dropped.
    const tsOk = verifiedUpdatedAt === expectedUpdatedAt;

    if (!profileOk || !capOk || !tsOk) {
      const errorSafe = `DB verify mismatch: sent cap=${expectedCap} ts=${expectedUpdatedAt} but DB has cap=${verifiedCap ?? "null"} ts=${verifiedUpdatedAt ?? "null"} (set_risk_settings yazmadı — DB eski değeri koruyor)`;
      setStatus({
        state: "fallback",
        errorSafe,
        lastSavedAt: persistenceStatus.lastSavedAt,
        lastHydratedAt: persistenceStatus.lastHydratedAt,
      });
      return { ok: false, errorSafe };
    }

    const savedAt = Date.now();
    setStatus({
      state: "ok",
      lastSavedAt: savedAt,
      lastHydratedAt: persistenceStatus.lastHydratedAt,
    });
    return { ok: true, savedAt, via: "rpc_set_risk_settings" };
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

export function getReadSource(): ReadSource {
  return lastReadSource;
}

/**
 * Safe debug snapshot for the GET ?debug=1 endpoint. Reads the DB row
 * directly so the response reflects current persisted state, not the
 * per-instance in-memory cache. Returns no secrets.
 */
export interface RiskSettingsDebugSnapshot {
  hasSupabaseConfigured: boolean;
  hasServiceRoleKey: boolean;
  selectedUserId: string;
  persistenceStatus: PersistenceState;
  persistenceErrorSafe?: string;
  lastSavedAt?: number;
  lastHydratedAt?: number;
  rowExists: boolean;
  dbRiskSettingsPresent: boolean;
  dbRiskSettingsProfile: RiskProfileKey | null;
  dbRiskSettingsCapital: number | null;
  dbRiskSettings: unknown;
  inMemoryProfile: RiskProfileKey;
  inMemoryCapital: number;
  hydratedFlag: boolean;
  source: ReadSource;
  normalizedResponse: {
    profile: RiskProfileKey;
    capital: { totalCapitalUsdt: number; riskPerTradePercent: number; maxDailyLossPercent: number };
  };
}

export async function getDebugSnapshot(): Promise<RiskSettingsDebugSnapshot> {
  const hasSupabaseConfigured = supabaseConfigured();
  // Service role key presence (only the existence flag — never the value).
  const hasServiceRoleKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const selectedUserId = resolveUserId();

  let rowExists = false;
  let dbRiskSettings: unknown = null;
  let dbRiskSettingsPresent = false;
  let dbRiskSettingsProfile: RiskProfileKey | null = null;
  let dbRiskSettingsCapital: number | null = null;

  if (hasSupabaseConfigured) {
    try {
      const sb = supabaseAdmin();
      const { data } = await sb
        .from("bot_settings")
        .select("user_id, risk_settings")
        .eq("user_id", selectedUserId)
        .maybeSingle();

      rowExists = data != null;
      const stored = (data as { risk_settings?: unknown } | null)?.risk_settings ?? null;
      dbRiskSettingsPresent = stored != null;
      dbRiskSettings = stored;

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
      // Diagnostics-only — surface DB read errors via persistenceStatus.
    }
  }

  return {
    hasSupabaseConfigured,
    hasServiceRoleKey,
    selectedUserId,
    persistenceStatus: persistenceStatus.state,
    persistenceErrorSafe: persistenceStatus.errorSafe,
    lastSavedAt: persistenceStatus.lastSavedAt,
    lastHydratedAt: persistenceStatus.lastHydratedAt,
    rowExists,
    dbRiskSettingsPresent,
    dbRiskSettingsProfile,
    dbRiskSettingsCapital,
    dbRiskSettings,
    inMemoryProfile: state.profile,
    inMemoryCapital: state.capital.totalCapitalUsdt,
    hydratedFlag: hydrated,
    source: lastReadSource,
    normalizedResponse: {
      profile: state.profile,
      capital: {
        totalCapitalUsdt: state.capital.totalCapitalUsdt,
        riskPerTradePercent: state.capital.riskPerTradePercent,
        maxDailyLossPercent: state.capital.maxDailyLossPercent,
      },
    },
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
  | { ok: true; data: RiskSettings; savedAt: number; via: "rpc_set_risk_settings" }
  | { ok: false; stage: "validation"; errors: string[] }
  | { ok: false; stage: "persistence"; errorSafe: string; data: RiskSettings }
> {
  const r = applyPatch(patch);
  if (!r.ok) return { ok: false, stage: "validation", errors: r.errors };
  const p = await persistToDb(r.data);
  if (!p.ok) return { ok: false, stage: "persistence", errorSafe: p.errorSafe, data: r.data };
  return { ok: true, data: r.data, savedAt: p.savedAt, via: p.via };
}

/** Test-only helper. */
export function __resetRiskSettingsStoreForTests(): void {
  state = clone(defaultRiskSettings());
  hydrated = false;
  hydrationPromise = null;
  persistenceStatus = { state: "pending" };
  lastReadSource = "pending";
}
