// Phase 3 — Momentum Taraması: pure screener.
//
// Selects the top-N gainers AND the top-N losers from the universe,
// merges them, applies hygiene filters (volume / spread / stablecoin /
// status) and produces ranked, scored MomentumCandidate rows.
//
// Always evaluates both directions together — there is NO "gainers only"
// or "losers only" knob. Aktif/Pasif at the scan-modes level is the only
// user-facing control.
//
// CRITICAL: this module is a pure function over already-fetched bulk
// ticker data. It DOES NOT issue any Binance HTTP itself. See
// docs/BINANCE_API_GUARDRAILS.md §6 (toplu önceliği) and §12.7
// (no per-symbol fan-out fetches).

import type { Ticker } from "@/lib/exchanges/types";
import type {
  MarketSymbolInfo,
  LightweightCandidate,
} from "@/lib/market-universe/types";
import type { BookQuote } from "@/lib/market-universe/lightweight-screener";
import type {
  MomentumCandidate,
  MomentumScreenerConfig,
} from "./types";
import { DEFAULT_MOMENTUM_CONFIG } from "./types";

const STABLECOIN_BASES = new Set([
  "USDT", "USDC", "BUSD", "DAI", "TUSD", "USDP", "FDUSD", "USDD", "PYUSD",
]);

function isStablecoinBase(base: string): boolean {
  return STABLECOIN_BASES.has(base.toUpperCase());
}

export interface MomentumScreenInput {
  universe: readonly MarketSymbolInfo[];
  /** Already-fetched bulk ticker map keyed by canonical symbol. */
  tickers: Record<string, Ticker>;
  /** Optional bid/ask map (e.g. from /fapi/v1/ticker/bookTicker bulk call). */
  bookTickers?: Record<string, BookQuote>;
  config?: Partial<MomentumScreenerConfig>;
}

interface ScreenedRow extends LightweightCandidate {
  // Internal — pre-bias signed change; preserved on LightweightCandidate too.
}

export function runMomentumScreen(input: MomentumScreenInput): MomentumCandidate[] {
  const cfg: MomentumScreenerConfig = { ...DEFAULT_MOMENTUM_CONFIG, ...(input.config ?? {}) };

  const screened: ScreenedRow[] = [];
  for (const sym of input.universe) {
    if (isStablecoinBase(sym.baseAsset)) continue;
    if (sym.status !== "TRADING") continue;
    if (sym.contractType !== "perpetual") continue;
    if (sym.quoteAsset !== "USDT") continue;

    const t = input.tickers[sym.symbol];
    if (!t) continue;

    const quoteVolume = Number(t.quoteVolume24h ?? 0);
    if (!Number.isFinite(quoteVolume) || quoteVolume < cfg.minQuoteVolumeUsd) continue;

    const lastPrice = Number(t.lastPrice ?? 0);
    if (!Number.isFinite(lastPrice) || lastPrice <= 0) continue;

    const change = Number(t.changePercent24h ?? 0);
    if (!Number.isFinite(change)) continue;
    if (Math.abs(change) < cfg.minAbsMovePercent) continue;

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

    screened.push({
      symbol: sym.symbol,
      priceChangePercent: change,
      quoteVolume,
      lastPrice,
      bidPrice: bid,
      askPrice: ask,
      spreadPercent,
      active: true,
      sourceCandidates: ["MOMENTUM"],
      // Lightweight preScore is left blank/0 here — momentumScore is the
      // canonical metric for this layer. Pool merging keeps the higher
      // preScore from any source, so a 0 here just means "rely on the
      // momentum-specific score for ranking within the momentum pool."
      marketQualityPreScore: 0,
    });
  }

  // Split, sort each half, take top-N
  const gainers = screened.filter((r) => r.priceChangePercent > 0);
  const losers = screened.filter((r) => r.priceChangePercent < 0);
  gainers.sort((a, b) => b.priceChangePercent - a.priceChangePercent);
  losers.sort((a, b) => a.priceChangePercent - b.priceChangePercent);

  const topGainers = gainers.slice(0, Math.max(0, cfg.topGainersLimit));
  const topLosers = losers.slice(0, Math.max(0, cfg.topLosersLimit));

  // Merge + dedupe (a coin's signed change% can't simultaneously be both;
  // dedupe is defensive against duplicate universe rows).
  const seen = new Set<string>();
  const combined: ScreenedRow[] = [];
  for (const r of [...topGainers, ...topLosers]) {
    if (seen.has(r.symbol)) continue;
    seen.add(r.symbol);
    combined.push(r);
  }

  // Score, rank, sort, cap
  const scored: MomentumCandidate[] = combined.map((r) => {
    const directionBias: "UP" | "DOWN" = r.priceChangePercent > 0 ? "UP" : "DOWN";
    const momentumScore = computeMomentumScore({
      absChangePercent: Math.abs(r.priceChangePercent),
      quoteVolume: r.quoteVolume,
      spreadPercent: r.spreadPercent,
    });
    return {
      ...r,
      directionBias,
      momentumScore,
      momentumRank: 0, // assigned after final sort
      // Mirror momentumScore into the lightweight preScore field too so
      // the candidate-pool comparator (which sorts by preScore) treats
      // momentum entries on the same scale as wide-market entries.
      marketQualityPreScore: momentumScore,
    };
  });

  scored.sort((a, b) => {
    if (b.momentumScore !== a.momentumScore) return b.momentumScore - a.momentumScore;
    if (b.quoteVolume !== a.quoteVolume) return b.quoteVolume - a.quoteVolume;
    return a.symbol.localeCompare(b.symbol);
  });

  const capped = scored.slice(0, Math.max(0, cfg.maxMomentumCandidates));
  return capped.map((c, i) => ({ ...c, momentumRank: i + 1 }));
}

/**
 * 0..100 momentum score. Components (saturating):
 *  - movement size  : |change%| in [minMove, 15%]   → 0..40 pts
 *  - quote volume   : log-scaled in [1M, 1B] USDT   → 0..30 pts
 *  - spread health  : tighter is better in [0,0.30]% → 0..20 pts
 *                     unknown spread → full credit (20 pts)
 *  - direction clarity: |change%| / 5%, capped at 1 → 0..10 pts
 */
export function computeMomentumScore(args: {
  absChangePercent: number;
  quoteVolume: number;
  spreadPercent: number | null;
}): number {
  const movePts = (() => {
    const m = Math.max(0, args.absChangePercent);
    if (m <= 0) return 0;
    const t = Math.min(1, m / 15);
    return Math.round(t * 40);
  })();

  const volPts = (() => {
    const v = Math.max(0, args.quoteVolume);
    if (v <= 1_000_000) return 0;
    if (v >= 1_000_000_000) return 30;
    const lo = Math.log10(1_000_000);
    const hi = Math.log10(1_000_000_000);
    const t = (Math.log10(v) - lo) / (hi - lo);
    return Math.round(t * 30);
  })();

  const spreadPts = (() => {
    if (args.spreadPercent === null) return 20;
    const s = Math.max(0, args.spreadPercent);
    if (s >= 0.30) return 0;
    const t = 1 - s / 0.30;
    return Math.round(t * 20);
  })();

  const clarityPts = (() => {
    const m = Math.max(0, args.absChangePercent);
    const t = Math.min(1, m / 5);
    return Math.round(t * 10);
  })();

  const total = movePts + volPts + spreadPts + clarityPts;
  return Math.max(0, Math.min(100, total));
}
