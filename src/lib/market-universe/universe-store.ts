// Phase 2 — Geniş Market Taraması: universe store.
//
// Owns the cached list of TRADABLE USDT-margined perpetual symbols for a
// given exchange. Wraps the centralised exchange adapter (which is the
// only allowed Binance API client per docs/BINANCE_API_GUARDRAILS.md);
// adds a 6h TTL on top so the universe layer's caching contract is
// explicit and decoupled from the adapter's own short-term cache.
//
// IMPORTANT: this module DOES NOT auto-refresh. Callers (future phases)
// invoke `getMarketUniverse()` (cache-respecting) or `refreshMarketUniverse()`
// (force) on their own cadence. Phase 2 introduces no periodic Binance
// traffic.

import type { ExchangeName, FuturesSymbolInfo } from "@/lib/exchanges/types";
import { getAdapter } from "@/lib/exchanges/exchange-factory";
import type { MarketSymbolInfo } from "./types";
import { DEFAULT_MARKET_UNIVERSE_CONFIG } from "./types";

interface UniverseCacheEntry {
  fetchedAt: number;
  symbols: MarketSymbolInfo[];
}

const cache = new Map<ExchangeName, UniverseCacheEntry>();

/**
 * Filter a raw FuturesSymbolInfo list down to the universe we care about.
 * Mirrors the Binance adapter's own filter (PERPETUAL/USDT/TRADING) but
 * applied at the universe layer too — so even if the adapter relaxes
 * filtering in the future, this layer keeps its contract.
 */
export function filterToTradableUsdtPerpetuals(
  raw: readonly FuturesSymbolInfo[],
): MarketSymbolInfo[] {
  const out: MarketSymbolInfo[] = [];
  for (const s of raw) {
    if (s.contractType !== "perpetual") continue;
    if (s.quoteAsset !== "USDT") continue;
    if (!s.isActive) continue; // adapter encodes status==TRADING as isActive
    if (!s.symbol.endsWith("/USDT")) continue;
    out.push({
      symbol: s.symbol,
      baseAsset: s.baseAsset,
      quoteAsset: "USDT",
      contractType: "perpetual",
      status: "TRADING",
    });
  }
  return out;
}

export interface GetUniverseOptions {
  exchange?: ExchangeName;
  ttlMs?: number;
  /** Inject a pre-fetched list (used by tests + callers that already have data). */
  overrideRaw?: FuturesSymbolInfo[];
}

/**
 * Returns the cached universe; refetches via the adapter only when the TTL
 * has expired (or no entry exists, or `overrideRaw` is provided).
 */
export async function getMarketUniverse(
  opts: GetUniverseOptions = {},
): Promise<MarketSymbolInfo[]> {
  const exchange: ExchangeName = opts.exchange ?? "binance";
  const ttl = opts.ttlMs ?? DEFAULT_MARKET_UNIVERSE_CONFIG.universeTtlMs;

  if (opts.overrideRaw) {
    const symbols = filterToTradableUsdtPerpetuals(opts.overrideRaw);
    cache.set(exchange, { fetchedAt: Date.now(), symbols });
    return [...symbols];
  }

  const entry = cache.get(exchange);
  if (entry && Date.now() - entry.fetchedAt < ttl) {
    return [...entry.symbols];
  }
  return refreshMarketUniverse({ exchange });
}

/**
 * Force refresh — bypasses TTL. Single source of Binance traffic for this
 * module: a single `adapter.getFuturesSymbols()` call (already weight-cheap,
 * already adapter-cached for 60s upstream). Caller is responsible for not
 * invoking this on a tight loop.
 */
export async function refreshMarketUniverse(
  opts: { exchange?: ExchangeName } = {},
): Promise<MarketSymbolInfo[]> {
  const exchange: ExchangeName = opts.exchange ?? "binance";
  const adapter = getAdapter(exchange);
  const raw = await adapter.getFuturesSymbols();
  const symbols = filterToTradableUsdtPerpetuals(raw);
  cache.set(exchange, { fetchedAt: Date.now(), symbols });
  return [...symbols];
}

/** Returns the timestamp of the last successful refresh, or null. */
export function getMarketUniverseFetchedAt(
  exchange: ExchangeName = "binance",
): number | null {
  return cache.get(exchange)?.fetchedAt ?? null;
}

/** Test-only helper. */
export function __resetMarketUniverseCacheForTests(): void {
  cache.clear();
}
