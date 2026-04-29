// Phase 1 — in-memory store for scan modes config.
//
// Scaffold-only: state lives in module-level memory inside the API process.
// This is intentional for the skeleton phase — no Supabase migration, no DB
// reads/writes inside scanner/worker hot paths, no new Binance API traffic.
// Persistence to Supabase is deferred to a later phase per project plan.
//
// On serverless cold-start the state resets to DEFAULT_SCAN_MODES_CONFIG.
// This is acceptable for Phase 1: nothing in the scanner/worker reads these
// values yet — they are surfaced in the UI as a configuration skeleton only.

import {
  DEFAULT_SCAN_MODES_CONFIG,
  type ScanModesConfig,
} from "./types";
import { toCanonical } from "@/lib/exchanges/symbol-normalizer";

let state: ScanModesConfig = cloneConfig(DEFAULT_SCAN_MODES_CONFIG);

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

export function getScanModesConfig(): ScanModesConfig {
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
  }
  return cloneConfig(state);
}

/** Test-only helper. Resets the in-memory store to defaults. */
export function __resetScanModesStoreForTests(): void {
  state = cloneConfig(DEFAULT_SCAN_MODES_CONFIG);
}
