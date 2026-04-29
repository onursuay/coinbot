// Phase 2 — candidate pool.
//
// Pure function. Merges LightweightCandidate rows from one or more sources
// (Geniş Market Taraması, Momentum Taraması, Manuel İzleme Listesi) into a
// deduplicated, capped pool. Each entry tracks the full set of sources it
// came from; consumers render the displayed source label via
// scan-modes/sources.ts (≥2 sources → MIXED → "KRM").
//
// No I/O — works on in-memory data.

import type { SingleCoinSource } from "@/lib/scan-modes/types";
import { resolveDisplayedCoinSource } from "@/lib/scan-modes/sources";
import type {
  CandidatePoolEntry,
  LightweightCandidate,
  MarketUniverseConfig,
} from "./types";
import { DEFAULT_MARKET_UNIVERSE_CONFIG } from "./types";

export interface BuildPoolOptions {
  /** Hard cap. Default: DEFAULT_MARKET_UNIVERSE_CONFIG.candidatePoolMax (50). */
  maxSize?: number;
}

/**
 * Build a unified candidate pool from N independent screen results.
 * - Dedupes by canonical symbol.
 * - When the same symbol appears in multiple inputs, sources are unioned
 *   (preserving first-seen order) and the candidate snapshot kept is the
 *   one with the highest marketQualityPreScore (ties broken by quoteVolume).
 * - Final list is sorted by preScore desc, sliced to `maxSize`.
 */
export function buildCandidatePool(
  groups: ReadonlyArray<readonly LightweightCandidate[]>,
  opts: BuildPoolOptions = {},
): CandidatePoolEntry[] {
  const maxSize = opts.maxSize ?? DEFAULT_MARKET_UNIVERSE_CONFIG.candidatePoolMax;
  const bySymbol = new Map<string, CandidatePoolEntry>();

  for (const group of groups) {
    for (const c of group) {
      const existing = bySymbol.get(c.symbol);
      if (!existing) {
        bySymbol.set(c.symbol, {
          symbol: c.symbol,
          sources: dedupeSources(c.sourceCandidates),
          candidate: { ...c, sourceCandidates: dedupeSources(c.sourceCandidates) },
        });
        continue;
      }
      existing.sources = mergeSources(existing.sources, c.sourceCandidates);
      // Keep the better-scored snapshot. Ties: larger quoteVolume wins.
      if (
        c.marketQualityPreScore > existing.candidate.marketQualityPreScore ||
        (c.marketQualityPreScore === existing.candidate.marketQualityPreScore &&
          c.quoteVolume > existing.candidate.quoteVolume)
      ) {
        existing.candidate = { ...c, sourceCandidates: existing.sources };
      } else {
        // Keep snapshot but reflect the merged source list on it.
        existing.candidate = { ...existing.candidate, sourceCandidates: existing.sources };
      }
    }
  }

  const all = Array.from(bySymbol.values());
  all.sort((a, b) => {
    const ds = b.candidate.marketQualityPreScore - a.candidate.marketQualityPreScore;
    if (ds !== 0) return ds;
    const dv = b.candidate.quoteVolume - a.candidate.quoteVolume;
    if (dv !== 0) return dv;
    return a.symbol.localeCompare(b.symbol);
  });
  return all.slice(0, Math.max(0, maxSize));
}

/** Helper: resolves the displayed source for a pool entry (single | MIXED). */
export function getDisplayedSource(entry: CandidatePoolEntry) {
  return resolveDisplayedCoinSource(entry.sources);
}

function dedupeSources(s: readonly SingleCoinSource[]): SingleCoinSource[] {
  const out: SingleCoinSource[] = [];
  const seen = new Set<SingleCoinSource>();
  for (const x of s) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

function mergeSources(
  a: readonly SingleCoinSource[],
  b: readonly SingleCoinSource[],
): SingleCoinSource[] {
  const out: SingleCoinSource[] = [];
  const seen = new Set<SingleCoinSource>();
  for (const x of [...a, ...b]) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

export type { MarketUniverseConfig };
