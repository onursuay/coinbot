// Phase 10 — Risk Yönetimi in-memory store.
//
// Scan-modes ile aynı pattern: serverless cold-start'ta varsayılana
// döner. Hiçbir trade engine veya canlı trading gate fonksiyonu bu
// store'a bağlı değildir. Patch'ler validation'dan geçer.

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

async function hydrateFromDb(): Promise<void> {
  if (hydrated) return;
  if (!supabaseConfigured()) { hydrated = true; return; }
  try {
    const userId = getCurrentUserId();
    const { data } = await supabaseAdmin()
      .from("bot_settings")
      .select("risk_settings")
      .eq("user_id", userId)
      .maybeSingle();
    const stored = (data as any)?.risk_settings;
    if (stored && typeof stored === "object") {
      const merged: RiskSettings = {
        ...defaultRiskSettings(),
        ...stored,
        capital: { ...defaultRiskSettings().capital, ...(stored.capital ?? {}) },
        positions: { ...defaultRiskSettings().positions, ...(stored.positions ?? {}) },
        leverage: {
          CC:    { ...defaultRiskSettings().leverage.CC,    ...(stored.leverage?.CC    ?? {}) },
          GNMR:  { ...defaultRiskSettings().leverage.GNMR,  ...(stored.leverage?.GNMR  ?? {}) },
          MNLST: { ...defaultRiskSettings().leverage.MNLST, ...(stored.leverage?.MNLST ?? {}) },
        },
        direction: { ...defaultRiskSettings().direction, ...(stored.direction ?? {}) },
        stopLoss:  { ...defaultRiskSettings().stopLoss,  ...(stored.stopLoss  ?? {}) },
        tiered:    { ...defaultRiskSettings().tiered,    ...(stored.tiered    ?? {}), averageDownEnabled: false },
        appliedToTradeEngine: false,
      };
      const v = validateRiskSettings(merged);
      if (v.ok) state = clone(merged);
    }
  } catch { /* persistence is best-effort — fall back to in-memory defaults */ }
  hydrated = true;
}

export function ensureHydrated(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (!hydrationPromise) hydrationPromise = hydrateFromDb();
  return hydrationPromise;
}

async function persistToDb(s: RiskSettings): Promise<void> {
  if (!supabaseConfigured()) return;
  try {
    const userId = getCurrentUserId();
    await supabaseAdmin()
      .from("bot_settings")
      .update({ risk_settings: s })
      .eq("user_id", userId);
  } catch { /* non-fatal */ }
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

/** Validation'dan geçerse state'i günceller, aksi halde hata döner. */
export function updateRiskSettings(
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
  // Best-effort fire-and-forget persistence; never blocks the API path.
  void persistToDb(state);
  return { ok: true, data: clone(state) };
}

/** Test-only helper. */
export function __resetRiskSettingsStoreForTests(): void {
  state = clone(defaultRiskSettings());
  hydrated = false;
  hydrationPromise = null;
}
