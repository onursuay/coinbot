// Phase 1 → Persistence — scan modes config store.
//
// Faz 1'de yalnız in-memory idi; cold-start'ta DEFAULT_SCAN_MODES_CONFIG'e
// dönüyordu. Bu modül Supabase `bot_settings.scan_modes_config` JSONB
// kolonuna kalıcı yazma/okuma ekler. Pattern: risk-settings/store ile aynı
// (lazy hydrate + best-effort persist).
//
// Kapsam: yalnızca konfig okuma/yazma. Trade engine, signal engine, risk
// engine veya canlı trading gate üzerinde HİÇBİR etkisi yoktur. Hiçbir
// Binance API çağrısı eklenmez.

import {
  DEFAULT_SCAN_MODES_CONFIG,
  type ScanModesConfig,
} from "./types";
import { toCanonical } from "@/lib/exchanges/symbol-normalizer";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth";

let state: ScanModesConfig = cloneConfig(DEFAULT_SCAN_MODES_CONFIG);
let hydrated = false;
let hydrationPromise: Promise<void> | null = null;

function cloneConfig(c: ScanModesConfig): ScanModesConfig {
  return {
    wideMarket: { active: c.wideMarket.active },
    momentum: { active: c.momentum.active, direction: c.momentum.direction },
    manualList: {
      active: c.manualList.active,
      symbols: [...c.manualList.symbols],
    },
  };
}

function mergeStored(stored: unknown): ScanModesConfig | null {
  if (!stored || typeof stored !== "object") return null;
  const s = stored as Partial<ScanModesConfig> & Record<string, any>;
  const def = DEFAULT_SCAN_MODES_CONFIG;
  const next: ScanModesConfig = {
    wideMarket: {
      active: typeof s.wideMarket?.active === "boolean" ? s.wideMarket.active : def.wideMarket.active,
    },
    momentum: {
      active: typeof s.momentum?.active === "boolean" ? s.momentum.active : def.momentum.active,
      direction: "both",
    },
    manualList: {
      active: typeof s.manualList?.active === "boolean" ? s.manualList.active : def.manualList.active,
      symbols: Array.isArray(s.manualList?.symbols)
        ? s.manualList.symbols
            .filter((x: unknown): x is string => typeof x === "string")
            .map((x: string) => toCanonical(x).trim())
            .filter((x: string) => x.length > 0)
        : [...def.manualList.symbols],
    },
  };
  return next;
}

async function hydrateFromDb(): Promise<void> {
  if (hydrated) return;
  if (!supabaseConfigured()) { hydrated = true; return; }
  try {
    const userId = getCurrentUserId();
    const { data } = await supabaseAdmin()
      .from("bot_settings")
      .select("scan_modes_config")
      .eq("user_id", userId)
      .maybeSingle();
    const stored = (data as any)?.scan_modes_config;
    const merged = mergeStored(stored);
    if (merged) state = merged;
  } catch {
    // best-effort — fall back to in-memory defaults
  }
  hydrated = true;
}

export function ensureScanModesHydrated(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (!hydrationPromise) hydrationPromise = hydrateFromDb();
  return hydrationPromise;
}

async function persistToDb(s: ScanModesConfig): Promise<void> {
  if (!supabaseConfigured()) return;
  try {
    const userId = getCurrentUserId();
    await supabaseAdmin()
      .from("bot_settings")
      .update({ scan_modes_config: s })
      .eq("user_id", userId);
  } catch {
    // non-fatal
  }
}

/** Sync getter — UI/worker tarafları ensureScanModesHydrated() sonrasında çağırmalı. */
export function getScanModesConfig(): ScanModesConfig {
  return cloneConfig(state);
}

/** Async getter — hydrate + clone tek adımda, worker/serverless cold-start güvenli. */
export async function getScanModesConfigAsync(): Promise<ScanModesConfig> {
  await ensureScanModesHydrated();
  return cloneConfig(state);
}

/**
 * Patch — partial update. Booleans flip independently. The manual list's
 * `active` toggle never clears `symbols` (Phase 1 spec: deactivating the
 * mode preserves the curated list).
 */
export interface ScanModesPatch {
  wideMarket?: { active?: boolean };
  momentum?: { active?: boolean };
  manualList?: { active?: boolean };
}

export function updateScanModesConfig(patch: ScanModesPatch): ScanModesConfig {
  const next = cloneConfig(state);
  if (patch.wideMarket && typeof patch.wideMarket.active === "boolean") {
    next.wideMarket.active = patch.wideMarket.active;
  }
  if (patch.momentum && typeof patch.momentum.active === "boolean") {
    next.momentum.active = patch.momentum.active;
  }
  if (patch.manualList && typeof patch.manualList.active === "boolean") {
    // Toggling active does NOT mutate `symbols`.
    next.manualList.active = patch.manualList.active;
  }
  state = next;
  void persistToDb(state);
  return cloneConfig(state);
}

/** Add a symbol to the manual list. Idempotent; preserves order. */
export function addManualSymbol(rawSymbol: string): ScanModesConfig {
  const sym = toCanonical(rawSymbol).trim();
  if (!sym) return cloneConfig(state);
  if (!state.manualList.symbols.includes(sym)) {
    state = {
      ...cloneConfig(state),
      manualList: {
        active: state.manualList.active,
        symbols: [...state.manualList.symbols, sym],
      },
    };
    void persistToDb(state);
  }
  return cloneConfig(state);
}

/** Remove a symbol from the manual list. */
export function removeManualSymbol(rawSymbol: string): ScanModesConfig {
  const sym = toCanonical(rawSymbol).trim();
  if (!sym) return cloneConfig(state);
  if (state.manualList.symbols.includes(sym)) {
    state = {
      ...cloneConfig(state),
      manualList: {
        active: state.manualList.active,
        symbols: state.manualList.symbols.filter((s) => s !== sym),
      },
    };
    void persistToDb(state);
  }
  return cloneConfig(state);
}

/** Test-only helper. Resets the in-memory store to defaults. */
export function __resetScanModesStoreForTests(): void {
  state = cloneConfig(DEFAULT_SCAN_MODES_CONFIG);
  hydrated = false;
  hydrationPromise = null;
}
