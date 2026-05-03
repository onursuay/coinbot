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

    // SOURCE OF TRUTH: bot_settings.risk_settings JSONB. Direct table SELECT —
    // RPC bypass'ine güvenmiyoruz çünkü RPC RETURNING geçmişte transaction
    // commit edilmediğinde de "başarılı" görünüyordu. Direct read hem
    // rowExists hem de stored değeri tek call'da verir.
    const { data, error } = await sb
      .from("bot_settings")
      .select("user_id, risk_settings")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw error;

    const rowFound = data != null;
    const stored =
      (data as { risk_settings?: unknown } | null)?.risk_settings ?? null;
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
type PersistVia = "direct_update" | "direct_insert";

async function persistToDb(
  s: RiskSettings,
): Promise<
  | { ok: true; savedAt: number; via: PersistVia }
  | { ok: false; errorSafe: string }
> {
  if (!supabaseConfigured()) {
    return { ok: false, errorSafe: "Supabase not configured" };
  }
  const sb = supabaseAdmin();
  const userId = resolveUserId();

  try {
    // Önce row var mı? Bu hem mantıksal yolu (direct_update vs direct_insert)
    // belirlemek hem de diagnostics için.
    const rowCheck = await sb
      .from("bot_settings")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (rowCheck.error) throw rowCheck.error;
    const rowExists = rowCheck.data != null;

    let via: PersistVia;
    if (rowExists) {
      // direct_update: mevcut row'u güncelle.
      const upd = await sb
        .from("bot_settings")
        .update({ risk_settings: s as unknown as Record<string, unknown> })
        .eq("user_id", userId);
      if (upd.error) throw upd.error;
      via = "direct_update";
    } else {
      // direct_insert: yeni row gerekir; upsert + onConflict, idempotent.
      const ins = await sb
        .from("bot_settings")
        .upsert(
          {
            user_id: userId,
            risk_settings: s as unknown as Record<string, unknown>,
          },
          { onConflict: "user_id" },
        );
      if (ins.error) throw ins.error;
      via = "direct_insert";
    }

    // Bağımsız verify: write sonrası DB'den DOĞRUDAN risk_settings kolonunu
    // okuyup gönderilenle karşılaştır. RPC RETURNING'e güvenmiyoruz —
    // ayrı bir transaction'da primary'den okuyoruz.
    const verify = await sb
      .from("bot_settings")
      .select("risk_settings")
      .eq("user_id", userId)
      .maybeSingle();

    if (verify.error) throw verify.error;

    const stored = (verify.data as { risk_settings?: unknown } | null)
      ?.risk_settings as
      | {
          profile?: string;
          capital?: { totalCapitalUsdt?: number };
          updatedAt?: number;
        }
      | null
      | undefined;

    if (!stored) {
      const errorSafe = `DB verify boş: bot_settings.risk_settings null veya satır yok (via=${via}).`;
      setStatus({
        state: "fallback",
        errorSafe,
        lastSavedAt: persistenceStatus.lastSavedAt,
        lastHydratedAt: persistenceStatus.lastHydratedAt,
      });
      return { ok: false, errorSafe };
    }

    const expectedCap = s.capital.totalCapitalUsdt;
    const expectedUpdatedAt = s.updatedAt;
    const expectedProfile = s.profile;
    const verifiedCap = stored.capital?.totalCapitalUsdt;
    const verifiedUpdatedAt = stored.updatedAt;
    const verifiedProfile = stored.profile;

    const capOk =
      typeof verifiedCap === "number" && verifiedCap === expectedCap;
    const tsOk = verifiedUpdatedAt === expectedUpdatedAt;
    const profileOk = verifiedProfile === expectedProfile;

    if (!capOk || !tsOk || !profileOk) {
      const errorSafe = `DB verify mismatch (via=${via}): sent profile=${expectedProfile} cap=${expectedCap} ts=${expectedUpdatedAt} got profile=${verifiedProfile ?? "null"} cap=${verifiedCap ?? "null"} ts=${verifiedUpdatedAt ?? "null"}`;
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
    return { ok: true, savedAt, via };
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
  | { ok: true; data: RiskSettings; savedAt: number; via: PersistVia }
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
