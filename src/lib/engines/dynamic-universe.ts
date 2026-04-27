// Dynamic Universe v2 — quality-filters non-core Binance Futures candidates.
// Called once per tick using the shared ticker map (no extra API calls).

import type { Ticker } from "@/lib/exchanges/types";

export interface DynamicCandidateOptions {
  allSymbols: string[];
  tickerMap: Record<string, Ticker>;
  coreSet: Set<string>;
  maxCandidates: number;          // upper ceiling, NOT a target quota
  minVolume24hUsd: number;
  maxSpreadPct: number;           // e.g. 0.2 means 0.2%
  maxPriceChangePct: number;      // abs 24h change — pump/dump proxy
  minMomentumPct?: number;        // abs 24h change minimum — dead/flat markets rejected (default 1.0%)
}

export interface DynamicCandidateResult {
  candidates: string[];
  totalConsidered: number;
  rejectedLowVolume: number;
  rejectedStablecoin: number;
  rejectedHighSpread: number;
  rejectedPumpDump: number;
  rejectedWeakMomentum: number;   // |change| < minMomentumPct — no observable trend
  rejectedNoData: number;
}

const STABLE_BASES = new Set([
  "USDC", "BUSD", "DAI", "TUSD", "FDUSD", "USDD", "FRAX", "LUSD", "GUSD",
  "USDP", "USTC", "USDS", "SUSD", "CEUR", "EURS", "EURT", "WBTC", "WETH",
  "STETH", "BETH", "WBETH",
]);

export function selectDynamicCandidates(opts: DynamicCandidateOptions): DynamicCandidateResult {
  const maxSpreadFrac = opts.maxSpreadPct / 100;
  const minMomentumPct = opts.minMomentumPct ?? 1.0;
  let rejectedLowVolume = 0;
  let rejectedStablecoin = 0;
  let rejectedHighSpread = 0;
  let rejectedPumpDump = 0;
  let rejectedWeakMomentum = 0;
  let rejectedNoData = 0;
  let totalConsidered = 0;
  const candidates: { symbol: string; volume: number }[] = [];

  for (const sym of opts.allSymbols) {
    if (opts.coreSet.has(sym)) continue;
    const t = opts.tickerMap[sym];
    if (!t) { rejectedNoData++; continue; }
    totalConsidered++;
    const base = sym.split("/")[0] ?? sym;
    if (STABLE_BASES.has(base)) { rejectedStablecoin++; continue; }
    if (t.quoteVolume24h < opts.minVolume24hUsd) { rejectedLowVolume++; continue; }
    if (t.spread > maxSpreadFrac) { rejectedHighSpread++; continue; }
    if (Math.abs(t.changePercent24h) > opts.maxPriceChangePct) { rejectedPumpDump++; continue; }
    // Weak momentum: flat/dead markets have no observable trend — high volume alone is not enough
    if (Math.abs(t.changePercent24h) < minMomentumPct) { rejectedWeakMomentum++; continue; }
    candidates.push({ symbol: sym, volume: t.quoteVolume24h });
  }

  // Sort by volume descending among quality-filtered candidates.
  // maxCandidates is a ceiling only — if fewer quality candidates exist, the list stays short.
  candidates.sort((a, b) => b.volume - a.volume);
  return {
    candidates: candidates.slice(0, opts.maxCandidates).map((c) => c.symbol),
    totalConsidered,
    rejectedLowVolume,
    rejectedStablecoin,
    rejectedHighSpread,
    rejectedPumpDump,
    rejectedWeakMomentum,
    rejectedNoData,
  };
}
