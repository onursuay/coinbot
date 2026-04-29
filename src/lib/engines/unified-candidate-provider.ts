// Phase 6 — Worker-side gateway to the unified candidate pool.
//
// Wraps the pure orchestrator (`buildUnifiedCandidatePool`) with a TTL
// cache + fail-safe fallback. NEVER throws: when any layer fails
// (universe unavailable, ticker fetch error, orchestrator exception),
// returns null so the worker keeps running on the legacy core-coin path.
//
// CACHING CONTRACT:
//  - Universe layer (6h TTL) and bulk ticker layer (60s TTL) are read
//    via market-universe helpers — no new Binance traffic is added here.
//  - Provider keeps its own snapshot for `unifiedCandidateRefreshIntervalSec`
//    (default 120 s = 2 min) so the worker does NOT rebuild the pool on
//    every tick. The pure orchestrator runs only when the snapshot
//    expires.
//
// SAFETY:
//  - This module does not call signal-engine, risk engine, paper-trading
//    engine or any leverage/live-gate code path.
//  - Returning null is the "fall back to core" signal for the worker.
//  - Compliant with docs/BINANCE_API_GUARDRAILS.md — only the centralised
//    adapter is used (transitively via getMarketUniverse / getCachedAllTickers).

import type { ExchangeName, Ticker } from "@/lib/exchanges/types";
import { getMarketUniverse, getCachedAllTickers } from "@/lib/market-universe";
import type { MarketSymbolInfo } from "@/lib/market-universe/types";
import { DEFAULT_MARKET_UNIVERSE_CONFIG } from "@/lib/market-universe/types";
import { getScanModesConfig, ensureScanModesHydrated } from "@/lib/scan-modes";
import {
  buildUnifiedCandidatePool,
  type DeepAnalysisCandidate,
  type UnifiedCandidatePool,
} from "@/lib/candidate-orchestrator";
import { resolveDisplayedSourceLabel } from "@/lib/scan-modes/sources";
import type { ScanModesConfig, SingleCoinSource } from "@/lib/scan-modes/types";
import { env } from "@/lib/env";

export interface UnifiedCandidateMetadata {
  symbol: string;
  /** Resolved display label: GMT / MT / MİL / KRM. Null when no source attached. */
  sourceDisplay: string | null;
  /** Full source list (e.g., ["WIDE_MARKET", "MOMENTUM"]). */
  candidateSources: SingleCoinSource[];
  /** 1-based rank within the deep-analysis subset. */
  candidateRank: number;
  /** Pre-score from the lightweight screener (0-100). Trade-side scoring untouched. */
  marketQualityPreScore: number;
  /** Present only when the candidate originated (also) from the momentum screener. */
  momentumScore?: number;
  /** Snapshot timestamp this metadata was assembled from. */
  candidatePoolGeneratedAt: number;
}

export interface UnifiedCandidateBundle {
  /** Deep-analysis subset (≤ unifiedDeepAnalysisMax). */
  deepCandidates: DeepAnalysisCandidate[];
  /** Lookup map: canonical symbol → metadata for ScanDetail. */
  metadataBySymbol: Record<string, UnifiedCandidateMetadata>;
  /** Full pool size from the orchestrator (≤ candidatePoolMax). */
  poolSize: number;
  /** Wall-clock timestamp of the underlying snapshot. */
  generatedAt: number;
  /** True if served from cache (no orchestrator re-run on this call). */
  fromCache: boolean;
}

interface CacheEntry {
  bundle: UnifiedCandidateBundle;
  fetchedAt: number;
}

const cache = new Map<ExchangeName, CacheEntry>();
// Phase 7 — last-error sidecar. Cleared on every successful refresh; set
// when the provider catches an internal failure. Diagnostic-only: callers
// (bot-orchestrator) surface it into last_tick_summary.unifiedProviderError.
const lastErrorByExchange = new Map<ExchangeName, string>();

export interface GetUnifiedCandidatesOptions {
  exchange?: ExchangeName;
  /** Override TTL — defaults to env.unifiedCandidateRefreshIntervalSec * 1000. */
  refreshIntervalMs?: number;
  /** Override deepMax — defaults to env.unifiedDeepAnalysisMax (capped at 30). */
  deepMax?: number;
  /** Force a refresh (bypass cache). */
  forceRefresh?: boolean;
  /** Test injection: provide universe / tickers / scanModes directly. */
  override?: {
    universe?: readonly MarketSymbolInfo[];
    tickers?: Record<string, Ticker>;
    scanModes?: ScanModesConfig;
  };
}

/**
 * Returns a unified candidate bundle, or null on any failure.
 * Never throws — worker callers fall back to the legacy core-only path
 * when null is returned.
 */
export async function getUnifiedCandidates(
  opts: GetUnifiedCandidatesOptions = {},
): Promise<UnifiedCandidateBundle | null> {
  const exchange: ExchangeName = opts.exchange ?? "binance";
  const ttlMs = Math.max(
    1_000,
    opts.refreshIntervalMs ?? env.unifiedCandidateRefreshIntervalSec * 1000,
  );
  // Hard cap at the orchestrator's own deepAnalysisMax (30) — prevents a
  // misconfigured env var from inflating worker analysis load.
  const deepMax = Math.max(
    0,
    Math.min(
      opts.deepMax ?? env.unifiedDeepAnalysisMax,
      DEFAULT_MARKET_UNIVERSE_CONFIG.deepAnalysisMax,
    ),
  );

  if (!opts.forceRefresh) {
    const entry = cache.get(exchange);
    if (entry && Date.now() - entry.fetchedAt < ttlMs) {
      return { ...entry.bundle, fromCache: true };
    }
  }

  try {
    const [universe, tickers] = await Promise.all([
      opts.override?.universe
        ? Promise.resolve([...opts.override.universe])
        : getMarketUniverse({ exchange }),
      opts.override?.tickers
        ? Promise.resolve({ ...opts.override.tickers })
        : getCachedAllTickers({ exchange }),
    ]);
    if (!opts.override?.scanModes) await ensureScanModesHydrated();
    const scanModes: ScanModesConfig = opts.override?.scanModes ?? getScanModesConfig();

    const result: UnifiedCandidatePool = buildUnifiedCandidatePool({
      scanModes,
      universe,
      tickers,
      deepMax,
    });

    const bundle = toBundle(result, deepMax);
    cache.set(exchange, { bundle, fetchedAt: Date.now() });
    lastErrorByExchange.delete(exchange);
    return { ...bundle, fromCache: false };
  } catch (e: any) {
    // Non-fatal — log and fall back to core. Returning null instead of
    // throwing keeps the worker tick alive (Phase 6 invariant).
    const msg = e?.message ?? String(e);
    lastErrorByExchange.set(exchange, msg);
    // eslint-disable-next-line no-console
    console.error("[unified-candidate-provider] failed:", msg);
    return null;
  }
}

function toBundle(
  pool: UnifiedCandidatePool,
  deepMax: number,
): UnifiedCandidateBundle {
  const sliced = pool.deepAnalysisCandidates.slice(0, Math.max(0, deepMax));
  const meta: Record<string, UnifiedCandidateMetadata> = {};
  for (const c of sliced) {
    const cand = c.candidate as { momentumScore?: unknown; marketQualityPreScore: number };
    const momentumScore = typeof cand.momentumScore === "number" ? cand.momentumScore : undefined;
    meta[c.symbol] = {
      symbol: c.symbol,
      sourceDisplay: resolveDisplayedSourceLabel(c.sources),
      candidateSources: [...c.sources],
      candidateRank: c.rank,
      marketQualityPreScore: cand.marketQualityPreScore,
      momentumScore,
      candidatePoolGeneratedAt: pool.generatedAt,
    };
  }
  return {
    deepCandidates: sliced,
    metadataBySymbol: meta,
    poolSize: pool.pool.length,
    generatedAt: pool.generatedAt,
    fromCache: false,
  };
}

export function getUnifiedCandidatesFetchedAt(
  exchange: ExchangeName = "binance",
): number | null {
  return cache.get(exchange)?.fetchedAt ?? null;
}

/**
 * Returns the most recent provider error message, or null if the last call
 * was successful (or no call has been made yet). Diagnostic-only — never
 * gates anything.
 */
export function getUnifiedProviderLastError(
  exchange: ExchangeName = "binance",
): string | null {
  return lastErrorByExchange.get(exchange) ?? null;
}

/** Test-only helper. */
export function __resetUnifiedCandidateCacheForTests(): void {
  cache.clear();
  lastErrorByExchange.clear();
}
