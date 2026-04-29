// Phase 5 — bulk ticker cache (60s TTL).
//
// Wraps a single `adapter.getAllTickers()` call (toplu endpoint, weight ~40)
// in a tight in-memory cache so that read-only consumers like the
// `/api/candidate-pool/snapshot` endpoint do NOT issue a fresh Binance
// request per page hit. Goes through the central exchange adapter — no
// scattered fetch. Compliant with docs/BINANCE_API_GUARDRAILS.md §6 / §8 / §12.

import type { ExchangeName, Ticker } from "@/lib/exchanges/types";
import { getAdapter } from "@/lib/exchanges/exchange-factory";

interface BulkCacheEntry {
  fetchedAt: number;
  byCanonical: Record<string, Ticker>;
}

const DEFAULT_TTL_MS = 60_000; // 1 minute

const cache = new Map<ExchangeName, BulkCacheEntry>();

export interface GetCachedAllTickersOptions {
  exchange?: ExchangeName;
  ttlMs?: number;
  /** Inject a pre-built ticker map (used by tests). */
  override?: Record<string, Ticker>;
}

export async function getCachedAllTickers(
  opts: GetCachedAllTickersOptions = {},
): Promise<Record<string, Ticker>> {
  const exchange: ExchangeName = opts.exchange ?? "binance";
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;

  if (opts.override) {
    cache.set(exchange, { fetchedAt: Date.now(), byCanonical: { ...opts.override } });
    return { ...opts.override };
  }

  const entry = cache.get(exchange);
  if (entry && Date.now() - entry.fetchedAt < ttl) {
    return { ...entry.byCanonical };
  }

  const adapter = getAdapter(exchange);
  const list = await adapter.getAllTickers();
  const byCanonical: Record<string, Ticker> = {};
  for (const t of list) byCanonical[t.symbol] = t;
  cache.set(exchange, { fetchedAt: Date.now(), byCanonical });
  return { ...byCanonical };
}

export function getBulkTickerFetchedAt(exchange: ExchangeName = "binance"): number | null {
  return cache.get(exchange)?.fetchedAt ?? null;
}

/** Test-only helper. */
export function __resetBulkTickerCacheForTests(): void {
  cache.clear();
}
