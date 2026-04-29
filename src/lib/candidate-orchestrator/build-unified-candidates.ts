// Phase 5 — Birleşik Aday Havuz Entegrasyonu: orchestrator.
//
// Pure function. Combines the three scan-mode sources (Geniş Market /
// Momentum / Manuel İzleme Listesi) into a single deduplicated candidate
// pool, then derives the deep-analysis subset.
//
// CRITICAL: this module issues ZERO Binance HTTP itself. It runs entirely
// over data the caller has already gathered (universe + bulk tickers).
// See docs/BINANCE_API_GUARDRAILS.md §6, §7, §12.
//
// CRITICAL: this module DOES NOT call signal-engine, risk engine,
// paper-trading-engine, or any leverage logic. It produces a pool of
// candidates only — the existing trading universe and worker tick remain
// untouched.

import type { Ticker } from "@/lib/exchanges/types";
import type {
  LightweightCandidate,
  MarketSymbolInfo,
} from "@/lib/market-universe/types";
import {
  DEFAULT_MARKET_UNIVERSE_CONFIG,
  buildCandidatePool,
  getDeepAnalysisCandidates,
  runLightweightScreen,
} from "@/lib/market-universe";
import { resolveDisplayedCoinSource } from "@/lib/scan-modes/sources";
import { runMomentumScreen } from "@/lib/momentum-screener";
import type { ScanModesConfig } from "@/lib/scan-modes/types";
import type {
  BuildUnifiedCandidatesInput,
  CandidateSummaryMetrics,
  UnifiedCandidatePool,
} from "./types";

const STABLECOIN_BASES = new Set([
  "USDT", "USDC", "BUSD", "DAI", "TUSD", "USDP", "FDUSD", "USDD", "PYUSD",
]);

const isStable = (base: string) => STABLECOIN_BASES.has(base.toUpperCase());

export function buildUnifiedCandidatePool(
  input: BuildUnifiedCandidatesInput,
): UnifiedCandidatePool {
  const poolMax = input.poolMax ?? DEFAULT_MARKET_UNIVERSE_CONFIG.candidatePoolMax;
  const deepMax = input.deepMax ?? DEFAULT_MARKET_UNIVERSE_CONFIG.deepAnalysisMax;

  const groups: LightweightCandidate[][] = [];

  // 1) Geniş Market Taraması — only if active
  let wideMarketCount = 0;
  if (input.scanModes.wideMarket.active) {
    const wm = runLightweightScreen({
      universe: input.universe,
      tickers: input.tickers,
      bookTickers: input.bookTickers,
      source: "WIDE_MARKET",
      config: input.screenerConfig,
    });
    wideMarketCount = wm.length;
    groups.push(wm);
  }

  // 2) Momentum Taraması — only if active
  let momentumCount = 0;
  if (input.scanModes.momentum.active) {
    const mom = runMomentumScreen({
      universe: input.universe,
      tickers: input.tickers,
      bookTickers: input.bookTickers,
      config: input.momentumConfig,
    });
    momentumCount = mom.length;
    groups.push(mom);
  }

  // 3) Manuel İzleme Listesi — only if active. Symbols are validated
  //    against the universe; off-universe / stablecoin entries are
  //    stripped (filteredOutManualSymbols). Symbols in the universe but
  //    without live ticker data are included as degraded entries
  //    (missingMarketDataSymbols).
  const filteredOutManualSymbols: string[] = [];
  const missingMarketDataSymbols: string[] = [];
  let manualCount = 0;
  if (input.scanModes.manualList.active) {
    const universeSet = new Set(input.universe.map((s) => s.symbol));
    const manualGroup: LightweightCandidate[] = [];
    for (const sym of input.scanModes.manualList.symbols) {
      const [base] = sym.split("/");
      if (!base || isStable(base) || !universeSet.has(sym)) {
        filteredOutManualSymbols.push(sym);
        continue;
      }
      const t: Ticker | undefined = input.tickers[sym];
      if (!t) {
        // Universe says it's tradable but ticker missing — degraded entry.
        missingMarketDataSymbols.push(sym);
        manualGroup.push({
          symbol: sym,
          priceChangePercent: 0,
          quoteVolume: 0,
          lastPrice: 0,
          bidPrice: null,
          askPrice: null,
          spreadPercent: null,
          active: true,
          sourceCandidates: ["MANUAL_LIST"],
          marketQualityPreScore: 0,
        });
        continue;
      }
      let bid: number | null = null;
      let ask: number | null = null;
      let spreadPercent: number | null = null;
      const book = input.bookTickers?.[sym];
      if (book && book.bid > 0 && book.ask > 0) {
        bid = book.bid;
        ask = book.ask;
        const mid = (bid + ask) / 2;
        if (mid > 0 && ask >= bid) spreadPercent = ((ask - bid) / mid) * 100;
      } else if (t.bid > 0 && t.ask > 0 && t.bid !== t.ask) {
        bid = Number(t.bid);
        ask = Number(t.ask);
      }

      manualGroup.push({
        symbol: sym,
        priceChangePercent: Number(t.changePercent24h ?? 0) || 0,
        quoteVolume: Number(t.quoteVolume24h ?? 0) || 0,
        lastPrice: Number(t.lastPrice ?? 0) || 0,
        bidPrice: bid,
        askPrice: ask,
        spreadPercent,
        active: true,
        sourceCandidates: ["MANUAL_LIST"],
        // Manual entries get a baseline "user-curated" preScore so they
        // are not pushed off the pool by the cap. Volume/movement still
        // contribute via the components in computeManualPreScore.
        marketQualityPreScore: computeManualPreScore({
          quoteVolume: Number(t.quoteVolume24h ?? 0),
          absChangePercent: Math.abs(Number(t.changePercent24h ?? 0)),
        }),
      });
    }
    manualCount = manualGroup.length;
    groups.push(manualGroup);
  }

  // 4) Pre-cap totals — used to compute filteredOutCount accurately.
  const preCapPool = buildCandidatePool(groups, { maxSize: Number.MAX_SAFE_INTEGER });
  const pool = preCapPool.slice(0, Math.max(0, poolMax));
  const filteredOutCount = Math.max(0, preCapPool.length - pool.length);

  // 5) Deep-analysis subset (re-uses Phase-2 ranker)
  const deepAnalysisCandidates = getDeepAnalysisCandidates(pool, { max: deepMax });

  // 6) Mixed count
  let mixedCandidateCount = 0;
  for (const e of pool) {
    if (resolveDisplayedCoinSource(e.sources) === "MIXED") mixedCandidateCount++;
  }

  const summary: CandidateSummaryMetrics = {
    totalUniverseCount: input.universe.length,
    wideMarketCandidateCount: wideMarketCount,
    momentumCandidateCount: momentumCount,
    manualListCandidateCount: manualCount,
    mixedCandidateCount,
    unifiedCandidateCount: pool.length,
    deepAnalysisCandidateCount: deepAnalysisCandidates.length,
    filteredOutCount,
    missingMarketDataCount: missingMarketDataSymbols.length,
  };

  return {
    pool,
    deepAnalysisCandidates,
    summary,
    filteredOutManualSymbols,
    missingMarketDataSymbols,
    generatedAt: Date.now(),
  };
}

/**
 * Manual-list baseline preScore: small floor (10) so that user-curated
 * coins survive the cap, plus a modest contribution from volume/movement
 * so that lively manuals rank ahead of stale ones. Stays inside [0,100].
 */
function computeManualPreScore(args: {
  quoteVolume: number;
  absChangePercent: number;
}): number {
  const baseline = 10;
  const v = Math.max(0, args.quoteVolume);
  const volPts = (() => {
    if (v <= 1_000_000) return 0;
    if (v >= 1_000_000_000) return 40;
    const lo = Math.log10(1_000_000);
    const hi = Math.log10(1_000_000_000);
    const t = (Math.log10(v) - lo) / (hi - lo);
    return Math.round(t * 40);
  })();
  const moveCap = 8;
  const m = Math.max(0, args.absChangePercent);
  const movePts = Math.round(Math.min(1, m / moveCap) * 30);
  const total = baseline + volPts + movePts;
  return Math.max(0, Math.min(100, total));
}

/** Convenience helper for tests: a no-input default pool from a config. */
export function emptyUnifiedPool(scanModes: ScanModesConfig): UnifiedCandidatePool {
  return buildUnifiedCandidatePool({
    scanModes,
    universe: [],
    tickers: {},
  });
}
