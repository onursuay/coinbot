// Phase 1 — coin source resolution helpers.
// Given the set of sources a coin appeared in during a tick, decide what
// label to display on the dashboard/table (single source label, or KRM if
// it came from more than one mode). Detail/debug views may keep the full
// list separately.

import {
  COIN_SOURCE_LABEL,
  COIN_SOURCE_NAME,
  type CoinSource,
  type SingleCoinSource,
} from "./types";

/**
 * Resolve the displayed CoinSource for a coin.
 *
 * - 0 sources  → returns null (caller should treat as "no source attached")
 * - 1 source   → that source
 * - 2+ sources → MIXED (rendered as "KRM" via COIN_SOURCE_LABEL)
 *
 * Duplicates and unknown values are ignored. Order of input does not matter.
 */
export function resolveDisplayedCoinSource(
  sources: readonly SingleCoinSource[],
): CoinSource | null {
  if (!sources || sources.length === 0) return null;
  const valid: SingleCoinSource[] = [];
  const seen = new Set<SingleCoinSource>();
  for (const s of sources) {
    if (s === "WIDE_MARKET" || s === "MOMENTUM" || s === "MANUAL_LIST") {
      if (!seen.has(s)) {
        seen.add(s);
        valid.push(s);
      }
    }
  }
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];
  return "MIXED";
}

/** Convenience: resolve and return the short display label, or null. */
export function resolveDisplayedSourceLabel(
  sources: readonly SingleCoinSource[],
): string | null {
  const src = resolveDisplayedCoinSource(sources);
  return src ? COIN_SOURCE_LABEL[src] : null;
}

/** Convenience: full Turkish name for a CoinSource. */
export function getCoinSourceName(source: CoinSource): string {
  return COIN_SOURCE_NAME[source];
}
