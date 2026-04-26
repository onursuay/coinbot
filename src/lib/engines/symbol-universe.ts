// Symbol universe — fetches all active USDT-M futures symbols, pre-filters by
// volume/spread/funding, and returns cursor-paginated batches for scanner/tick.

import type { ExchangeName, Ticker } from "@/lib/exchanges/types";
import { getAdapter } from "@/lib/exchanges/exchange-factory";

export type ScanUniverse = "all_futures" | "watchlist_only" | "top_volume";

export interface UniverseOptions {
  exchange: ExchangeName;
  scanMode: ScanUniverse;
  min24hVolumeUsd: number;
  maxSpreadPct: number;      // e.g. 0.1 = 0.1%
  maxFundingRateAbs: number; // e.g. 0.003 = 0.3% — applied in deep analysis
  maxSymbolsPerTick: number;
  cursor?: string | null;    // index into sorted universe list
  watchlistSymbols?: string[];
}

export interface UniverseSlice {
  totalSymbols: number;        // raw universe size (before pre-filter)
  preFilteredCount: number;    // after volume + spread filter
  batchSymbols: string[];      // symbols for this tick
  nextCursor: string;          // "0" = wrap, otherwise next start index
  tickerMap: Record<string, Ticker>;
}

const SYMBOL_TTL = 10 * 60 * 1000; // 10 min
const TICKER_TTL = 60 * 1000;       // 1 min

const symbolCache = new Map<ExchangeName, { at: number; symbols: string[] }>();
const tickerCache = new Map<ExchangeName, { at: number; tickers: Record<string, Ticker> }>();

const FALLBACK_SYMBOLS = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT"];

export async function getUniverseSlice(opts: UniverseOptions): Promise<UniverseSlice> {
  const adapter = getAdapter(opts.exchange);

  // Watchlist-only: bypass universe entirely
  if (opts.scanMode === "watchlist_only") {
    const symbols = opts.watchlistSymbols?.length ? opts.watchlistSymbols : FALLBACK_SYMBOLS;
    return {
      totalSymbols: symbols.length,
      preFilteredCount: symbols.length,
      batchSymbols: symbols.slice(0, opts.maxSymbolsPerTick),
      nextCursor: "0",
      tickerMap: {},
    };
  }

  // 1. Symbol list (cached 10 min)
  let allSymbols: string[];
  const symCached = symbolCache.get(opts.exchange);
  if (symCached && Date.now() - symCached.at < SYMBOL_TTL) {
    allSymbols = symCached.symbols;
  } else {
    try {
      allSymbols = await adapter.getSymbols();
      symbolCache.set(opts.exchange, { at: Date.now(), symbols: allSymbols });
    } catch {
      allSymbols = FALLBACK_SYMBOLS;
    }
  }

  // 2. All tickers (cached 1 min)
  let tickerMap: Record<string, Ticker> = {};
  const tkrCached = tickerCache.get(opts.exchange);
  if (tkrCached && Date.now() - tkrCached.at < TICKER_TTL) {
    tickerMap = tkrCached.tickers;
  } else {
    try {
      const tickers = await adapter.getAllTickers();
      const map: Record<string, Ticker> = {};
      tickers.forEach((t) => { map[t.symbol] = t; });
      tickerCache.set(opts.exchange, { at: Date.now(), tickers: map });
      tickerMap = map;
    } catch { /* non-fatal — proceed without ticker pre-filter */ }
  }

  // 3. Pre-filter: volume + spread
  const maxSpreadFrac = opts.maxSpreadPct / 100;
  const filtered = allSymbols.filter((sym) => {
    const t = tickerMap[sym];
    if (!t) return true; // no ticker data → include (deep analysis will filter)
    if (t.quoteVolume24h > 0 && t.quoteVolume24h < opts.min24hVolumeUsd) return false;
    if (t.spread > 0 && t.spread > maxSpreadFrac) return false;
    return true;
  });

  // 4. Sort by 24h volume desc
  filtered.sort((a, b) => {
    const va = tickerMap[a]?.quoteVolume24h ?? 0;
    const vb = tickerMap[b]?.quoteVolume24h ?? 0;
    return vb - va;
  });

  // top_volume: just the top N, no cursor
  if (opts.scanMode === "top_volume") {
    return {
      totalSymbols: allSymbols.length,
      preFilteredCount: filtered.length,
      batchSymbols: filtered.slice(0, opts.maxSymbolsPerTick),
      nextCursor: "0",
      tickerMap,
    };
  }

  // all_futures: cursor-based pagination so each tick scans a different batch
  const cursorIndex = parseInt(opts.cursor ?? "0", 10) || 0;
  const start = Math.min(cursorIndex, filtered.length);
  const batch = filtered.slice(start, start + opts.maxSymbolsPerTick);
  const next = start + opts.maxSymbolsPerTick;
  const nextCursor = next < filtered.length ? String(next) : "0"; // wrap when done

  return {
    totalSymbols: allSymbols.length,
    preFilteredCount: filtered.length,
    batchSymbols: batch,
    nextCursor,
    tickerMap,
  };
}

export function clearUniverseCache(exchange?: ExchangeName) {
  if (exchange) {
    symbolCache.delete(exchange);
    tickerCache.delete(exchange);
  } else {
    symbolCache.clear();
    tickerCache.clear();
  }
}
