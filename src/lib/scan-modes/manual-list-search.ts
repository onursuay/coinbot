// Phase 4 — Manuel İzleme Listesi search/validation helpers.
//
// Pure functions over a pre-fetched market universe (Phase 2 cache). This
// module DOES NOT issue any Binance HTTP itself — callers pass in the
// already-cached universe list. See docs/BINANCE_API_GUARDRAILS.md.
//
// Two responsibilities:
//   1. searchManualListCandidates() — substring search over the universe,
//      with stablecoin guard and result limit.
//   2. resolveManualListSymbol() — canonicalize user input ("sol" → "SOL/USDT")
//      and confirm the result is in the tradable universe.

import type { MarketSymbolInfo } from "@/lib/market-universe/types";
import { toCanonical } from "@/lib/exchanges/symbol-normalizer";

const STABLECOIN_BASES = new Set([
  "USDT", "USDC", "BUSD", "DAI", "TUSD", "USDP", "FDUSD", "USDD", "PYUSD",
]);

const isStable = (base: string) => STABLECOIN_BASES.has(base.toUpperCase());

export interface ManualListSearchResult {
  symbol: string;     // canonical "SOL/USDT"
  baseAsset: string;  // "SOL"
  alreadyAdded: boolean;
}

export interface SearchOptions {
  query: string;
  limit?: number;
  /** Symbols already in the user's manual list — used to mark `alreadyAdded`. */
  alreadyInList?: readonly string[];
}

const DEFAULT_LIMIT = 20;

/**
 * Search the universe for symbols matching `query`. Match is case-
 * insensitive substring against the base asset OR the full canonical
 * symbol. Stablecoin bases are excluded.
 *
 * Empty/short queries return an empty list (no "long default suggestion"
 * behavior) — the UI can show a hint until the user types ≥1 char.
 */
export function searchManualListCandidates(
  universe: readonly MarketSymbolInfo[],
  opts: SearchOptions,
): ManualListSearchResult[] {
  const limit = Math.max(1, opts.limit ?? DEFAULT_LIMIT);
  const q = (opts.query ?? "").trim().toUpperCase();
  if (!q) return [];

  const already = new Set((opts.alreadyInList ?? []).map((s) => s.toUpperCase()));

  // Score: 3 = baseAsset exact, 2 = baseAsset prefix, 1 = baseAsset substring,
  //        0 = full-symbol substring (least specific). Higher score wins.
  type Hit = { score: number; result: ManualListSearchResult };
  const hits: Hit[] = [];
  for (const sym of universe) {
    if (isStable(sym.baseAsset)) continue;
    const base = sym.baseAsset.toUpperCase();
    const full = sym.symbol.toUpperCase();

    let score: number | null = null;
    if (base === q) score = 3;
    else if (base.startsWith(q)) score = 2;
    else if (base.includes(q)) score = 1;
    else if (full.includes(q)) score = 0;
    if (score === null) continue;

    hits.push({
      score,
      result: {
        symbol: sym.symbol,
        baseAsset: sym.baseAsset,
        alreadyAdded: already.has(sym.symbol.toUpperCase()),
      },
    });
  }

  hits.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.result.symbol.localeCompare(b.result.symbol);
  });

  return hits.slice(0, limit).map((h) => h.result);
}

/**
 * Try to canonicalize and validate user input against the universe. Used
 * by the manual-list POST endpoint before mutating the store.
 *
 * Accepts:
 *   - "BTC/USDT", "btc/usdt"        → BTC/USDT
 *   - "BTCUSDT", "btcusdt"          → BTC/USDT
 *   - "BTC", "btc"                  → BTC/USDT (assumed USDT pair)
 *   - "BTC-USDT-SWAP" (OKX-style)   → BTC/USDT
 *
 * Returns the canonical symbol if it's in the universe; otherwise null.
 * Stablecoin-base inputs are rejected.
 */
export function resolveManualListSymbol(
  raw: string,
  universe: readonly MarketSymbolInfo[],
): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;

  const universeSet = new Set(universe.map((s) => s.symbol));

  // First attempt: direct canonicalization
  const direct = toCanonical(trimmed);
  if (direct.includes("/") && tryCandidate(direct, universeSet)) return direct;

  // Bare-base attempt: "BTC" → "BTC/USDT"
  const upper = trimmed.toUpperCase().replace(/\s+/g, "");
  if (!upper.includes("/") && !upper.includes("-")) {
    const candidate = `${upper}/USDT`;
    if (tryCandidate(candidate, universeSet)) return candidate;
  }

  return null;
}

function tryCandidate(candidate: string, universeSet: Set<string>): boolean {
  const [base, quote] = candidate.split("/");
  if (!base || quote !== "USDT") return false;
  if (isStable(base)) return false;
  return universeSet.has(candidate);
}
