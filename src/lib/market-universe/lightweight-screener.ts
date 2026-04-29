// Phase 2 — lightweight screener.
//
// Pure function. Given the universe + already-fetched bulk ticker data
// (and optionally bid/ask from bookTicker), produces a filtered list of
// LightweightCandidate rows with a 0-100 marketQualityPreScore.
//
// CRITICAL: this module issues NO Binance API calls. The whole point of
// the lightweight tier is to lean on the toplu (bulk) endpoints already
// fetched by the central adapter — no per-symbol fan-out.
// See docs/BINANCE_API_GUARDRAILS.md §6 (toplu/WS önceliği) and §12.7.

import type { Ticker } from "@/lib/exchanges/types";
import type { SingleCoinSource } from "@/lib/scan-modes/types";
import type {
  LightweightCandidate,
  LightweightScreenerConfig,
  MarketSymbolInfo,
} from "./types";
import { DEFAULT_MARKET_UNIVERSE_CONFIG } from "./types";

export interface BookQuote {
  bid: number;
  ask: number;
}

export interface ScreenInput {
  universe: readonly MarketSymbolInfo[];
  /** Already-fetched bulk ticker map keyed by canonical symbol. */
  tickers: Record<string, Ticker>;
  /** Optional bid/ask map (e.g. from /fapi/v1/ticker/bookTicker bulk call). */
  bookTickers?: Record<string, BookQuote>;
  /** Source attribution for every coin proposed by the upstream caller. */
  source: SingleCoinSource;
  config?: Partial<LightweightScreenerConfig>;
}

const STABLECOIN_BASES = new Set([
  "USDT", "USDC", "BUSD", "DAI", "TUSD", "USDP", "FDUSD", "USDD", "PYUSD",
]);

function isStablecoinBase(base: string): boolean {
  return STABLECOIN_BASES.has(base.toUpperCase());
}

/**
 * Main entry. Filters the universe through the screener thresholds and
 * scores each survivor with a 0-100 preScore.
 */
export function runLightweightScreen(input: ScreenInput): LightweightCandidate[] {
  const cfg: LightweightScreenerConfig = {
    ...DEFAULT_MARKET_UNIVERSE_CONFIG.screener,
    ...(input.config ?? {}),
  };

  const out: LightweightCandidate[] = [];
  for (const sym of input.universe) {
    if (isStablecoinBase(sym.baseAsset)) continue; // never screen stables

    const t = input.tickers[sym.symbol];
    if (!t) continue; // no live ticker data → skip silently

    const quoteVolume = Number(t.quoteVolume24h ?? 0);
    if (!Number.isFinite(quoteVolume) || quoteVolume < cfg.minQuoteVolumeUsd) continue;

    const lastPrice = Number(t.lastPrice ?? 0);
    if (!Number.isFinite(lastPrice) || lastPrice <= 0) continue;

    const change = Number(t.changePercent24h ?? 0);
    if (!Number.isFinite(change)) continue;
    if (Math.abs(change) < cfg.minAbsPriceChangePercent) continue;

    // Bid/ask: prefer explicit bookTickers, fall back to ticker.bid/ask if
    // the adapter populated them (single-symbol adapter call does; bulk
    // /ticker/24hr does not — bulk leaves bid=ask=last and spread=0).
    let bid: number | null = null;
    let ask: number | null = null;
    const book = input.bookTickers?.[sym.symbol];
    if (book) {
      bid = Number(book.bid);
      ask = Number(book.ask);
    } else {
      const tBid = Number(t.bid);
      const tAsk = Number(t.ask);
      if (tBid > 0 && tAsk > 0 && tBid !== tAsk) {
        bid = tBid;
        ask = tAsk;
      }
    }

    let spreadPercent: number | null = null;
    if (bid !== null && ask !== null) {
      if (cfg.rejectInvalidBidAsk && (bid <= 0 || ask <= 0 || ask < bid)) continue;
      const mid = (bid + ask) / 2;
      if (mid > 0) {
        spreadPercent = ((ask - bid) / mid) * 100;
        if (spreadPercent > cfg.maxSpreadPercent) continue;
      }
    }

    const preScore = computeMarketQualityPreScore({
      quoteVolume,
      absChangePercent: Math.abs(change),
      spreadPercent,
    });

    out.push({
      symbol: sym.symbol,
      priceChangePercent: change,
      quoteVolume,
      lastPrice,
      bidPrice: bid,
      askPrice: ask,
      spreadPercent,
      active: true,
      sourceCandidates: [input.source],
      marketQualityPreScore: preScore,
    });
  }

  return out;
}

/**
 * 0-100 lightweight quality score. Components:
 *  - volume:   log-scaled in [1M, 1B] USDT → 0..50 pts
 *  - movement: |change%|         in [0.5, 8]   → 0..30 pts (saturates beyond 8%)
 *  - spread:   tighter is better in [0, 0.30]% → 0..20 pts (full pts when spread is unknown)
 */
export function computeMarketQualityPreScore(args: {
  quoteVolume: number;
  absChangePercent: number;
  spreadPercent: number | null;
}): number {
  const volPts = (() => {
    const v = Math.max(0, args.quoteVolume);
    if (v <= 1_000_000) return 0;
    if (v >= 1_000_000_000) return 50;
    // Log-linear between 1M (0 pts) and 1B (50 pts)
    const lo = Math.log10(1_000_000);
    const hi = Math.log10(1_000_000_000);
    const t = (Math.log10(v) - lo) / (hi - lo);
    return Math.round(t * 50);
  })();

  const moveCap = 8;
  const movePts = (() => {
    const m = Math.max(0, args.absChangePercent);
    if (m <= 0) return 0;
    const t = Math.min(1, m / moveCap);
    return Math.round(t * 30);
  })();

  const spreadPts = (() => {
    if (args.spreadPercent === null) return 20; // unknown → grant full credit
    const s = Math.max(0, args.spreadPercent);
    if (s >= 0.30) return 0;
    const t = 1 - s / 0.30;
    return Math.round(t * 20);
  })();

  const total = volPts + movePts + spreadPts;
  return Math.max(0, Math.min(100, total));
}
