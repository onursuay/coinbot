// Dynamic Universe v2 — quality-filters non-core Binance Futures candidates.
// Called once per tick using the shared ticker map (no extra API calls).

import type { Ticker } from "@/lib/exchanges/types";

export interface DynamicCandidateOptions {
  allSymbols: string[];
  tickerMap: Record<string, Ticker>;
  coreSet: Set<string>;
  maxCandidates: number;
  minVolume24hUsd: number;
  maxSpreadPct: number;          // e.g. 0.2 means 0.2%
  maxPriceChangePct: number;     // abs 24h change — pump/dump proxy
}

export interface DynamicCandidateResult {
  candidates: string[];
  totalConsidered: number;
  rejectedLowVolume: number;
  rejectedStablecoin: number;
  rejectedHighSpread: number;
  rejectedPumpDump: number;
  rejectedNoData: number;
}

const STABLE_BASES = new Set([
  "USDC", "BUSD", "DAI", "TUSD", "FDUSD", "USDD", "FRAX", "LUSD", "GUSD",
  "USDP", "USTC", "USDS", "SUSD", "CEUR", "EURS", "EURT", "WBTC", "WETH",
  "STETH", "BETH", "WBETH",
]);

export function selectDynamicCandidates(opts: DynamicCandidateOptions): DynamicCandidateResult {
  const maxSpreadFrac = opts.maxSpreadPct / 100;
  let rejectedLowVolume = 0;
  let rejectedStablecoin = 0;
  let rejectedHighSpread = 0;
  let rejectedPumpDump = 0;
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
    candidates.push({ symbol: sym, volume: t.quoteVolume24h });
  }

  candidates.sort((a, b) => b.volume - a.volume);
  return {
    candidates: candidates.slice(0, opts.maxCandidates).map((c) => c.symbol),
    totalConsidered,
    rejectedLowVolume,
    rejectedStablecoin,
    rejectedHighSpread,
    rejectedPumpDump,
    rejectedNoData,
  };
}
