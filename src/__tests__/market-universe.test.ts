// Phase 2 — Geniş Market Taraması Katmanlı Altyapı tests.
//
// Verifies:
//  - universe filter accepts only tradable USDT perpetuals
//  - universe TTL caching behavior
//  - lightweight screener thresholds (volume/spread/movement/status)
//  - candidate pool dedupe, multi-source merge, max-50 cap
//  - deep-analysis max-30 cap and ranking
//  - Phase-2 invariants: trade threshold 70 unchanged, live-gate unchanged,
//    no Binance call sites added outside the central adapter, guardrails
//    doc still present.

import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { FuturesSymbolInfo, Ticker } from "@/lib/exchanges/types";
import {
  DEFAULT_MARKET_UNIVERSE_CONFIG,
  filterToTradableUsdtPerpetuals,
  getMarketUniverse,
  getMarketUniverseFetchedAt,
  __resetMarketUniverseCacheForTests,
  runLightweightScreen,
  computeMarketQualityPreScore,
  buildCandidatePool,
  getDisplayedSource,
  getDeepAnalysisCandidates,
  type LightweightCandidate,
  type MarketSymbolInfo,
} from "@/lib/market-universe";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

// ---------- helpers ----------
function rawSym(opts: Partial<FuturesSymbolInfo> & {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
}): FuturesSymbolInfo {
  return {
    exchangeSymbol: `${opts.baseAsset}${opts.quoteAsset}`,
    marketType: "futures",
    contractType: "perpetual",
    minOrderSize: 0.001,
    minNotional: 5,
    stepSize: 0.001,
    tickSize: 0.01,
    maxLeverage: 20,
    isActive: true,
    ...opts,
  };
}

function ticker(sym: string, over: Partial<Ticker> = {}): Ticker {
  return {
    symbol: sym,
    lastPrice: 100,
    bid: 100,
    ask: 100,
    spread: 0,
    volume24h: 0,
    quoteVolume24h: 5_000_000,
    high24h: 105,
    low24h: 95,
    changePercent24h: 1.5,
    timestamp: Date.now(),
    ...over,
  };
}

// ---------- universe-store ----------
describe("filterToTradableUsdtPerpetuals", () => {
  it("keeps only USDT perpetual + active + canonical /USDT symbols", () => {
    const raw: FuturesSymbolInfo[] = [
      rawSym({ symbol: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT" }),
      rawSym({ symbol: "ETH/USDT", baseAsset: "ETH", quoteAsset: "USDT" }),
      // delivery contracts, USDC quote, inactive, BUSD quote — all excluded
      rawSym({ symbol: "BTC/USD", baseAsset: "BTC", quoteAsset: "USD", contractType: "delivery" }),
      rawSym({ symbol: "ETH/USDC", baseAsset: "ETH", quoteAsset: "USDC" }),
      rawSym({ symbol: "DELIST/USDT", baseAsset: "DELIST", quoteAsset: "USDT", isActive: false }),
      rawSym({ symbol: "ETHBUSD", baseAsset: "ETH", quoteAsset: "BUSD" }),
    ];
    const filtered = filterToTradableUsdtPerpetuals(raw);
    expect(filtered.map((s) => s.symbol)).toEqual(["BTC/USDT", "ETH/USDT"]);
    for (const s of filtered) {
      expect(s.contractType).toBe("perpetual");
      expect(s.quoteAsset).toBe("USDT");
      expect(s.status).toBe("TRADING");
    }
  });
});

describe("getMarketUniverse caching", () => {
  beforeEach(() => __resetMarketUniverseCacheForTests());

  it("uses overrideRaw and caches for the configured TTL", async () => {
    const raw: FuturesSymbolInfo[] = [
      rawSym({ symbol: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT" }),
      rawSym({ symbol: "ETH/USDT", baseAsset: "ETH", quoteAsset: "USDT" }),
    ];
    const a = await getMarketUniverse({ overrideRaw: raw });
    expect(a.map((s) => s.symbol)).toEqual(["BTC/USDT", "ETH/USDT"]);
    const ts = getMarketUniverseFetchedAt("binance");
    expect(typeof ts).toBe("number");

    // Without overrideRaw, second call within TTL must return cached data
    // (no adapter invocation needed — proven by stable order/length).
    const b = await getMarketUniverse({});
    expect(b.map((s) => s.symbol)).toEqual(["BTC/USDT", "ETH/USDT"]);
  });

  it("uses the documented 6h TTL by default", () => {
    expect(DEFAULT_MARKET_UNIVERSE_CONFIG.universeTtlMs).toBe(6 * 60 * 60 * 1000);
    expect(DEFAULT_MARKET_UNIVERSE_CONFIG.lightweightScanIntervalMs).toBe(2 * 60 * 1000);
    expect(DEFAULT_MARKET_UNIVERSE_CONFIG.candidatePoolMax).toBe(50);
    expect(DEFAULT_MARKET_UNIVERSE_CONFIG.deepAnalysisMax).toBe(30);
  });
});

// ---------- lightweight-screener ----------
describe("runLightweightScreen", () => {
  const universe: MarketSymbolInfo[] = [
    { symbol: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT", contractType: "perpetual", status: "TRADING" },
    { symbol: "ETH/USDT", baseAsset: "ETH", quoteAsset: "USDT", contractType: "perpetual", status: "TRADING" },
    { symbol: "DOGE/USDT", baseAsset: "DOGE", quoteAsset: "USDT", contractType: "perpetual", status: "TRADING" },
    // stablecoin base — must be skipped
    { symbol: "USDC/USDT", baseAsset: "USDC", quoteAsset: "USDT", contractType: "perpetual", status: "TRADING" },
  ];

  it("filters by minQuoteVolumeUsd, minAbsPriceChangePercent, and ignores stablecoin bases", () => {
    const tickers: Record<string, Ticker> = {
      "BTC/USDT": ticker("BTC/USDT", { quoteVolume24h: 500_000_000, changePercent24h: 2.4 }),
      // ETH below volume floor → excluded
      "ETH/USDT": ticker("ETH/USDT", { quoteVolume24h: 500_000, changePercent24h: 3 }),
      // DOGE below movement floor → excluded
      "DOGE/USDT": ticker("DOGE/USDT", { quoteVolume24h: 200_000_000, changePercent24h: 0.1 }),
      // USDC stablecoin base — never even considered
      "USDC/USDT": ticker("USDC/USDT", { quoteVolume24h: 1_000_000_000, changePercent24h: 5 }),
    };
    const out = runLightweightScreen({ universe, tickers, source: "WIDE_MARKET" });
    expect(out.map((c) => c.symbol)).toEqual(["BTC/USDT"]);
    expect(out[0].sourceCandidates).toEqual(["WIDE_MARKET"]);
    expect(out[0].active).toBe(true);
    expect(out[0].marketQualityPreScore).toBeGreaterThan(0);
  });

  it("applies maxSpreadPercent only when bid/ask is available", () => {
    const tickers: Record<string, Ticker> = {
      "BTC/USDT": ticker("BTC/USDT", { quoteVolume24h: 500_000_000, changePercent24h: 2 }),
      "ETH/USDT": ticker("ETH/USDT", { quoteVolume24h: 200_000_000, changePercent24h: 2 }),
    };
    const bookTickers = {
      "BTC/USDT": { bid: 99.99, ask: 100.01 }, // ~0.02% — passes
      "ETH/USDT": { bid: 100.0, ask: 105.0 },  // ~4.88% — fails 0.30% cap
    };
    const out = runLightweightScreen({ universe, tickers, bookTickers, source: "WIDE_MARKET" });
    expect(out.map((c) => c.symbol)).toEqual(["BTC/USDT"]);
    expect(out[0].spreadPercent).toBeGreaterThan(0);
    expect(out[0].spreadPercent!).toBeLessThan(0.05);
    expect(out[0].bidPrice).toBe(99.99);
    expect(out[0].askPrice).toBe(100.01);
  });

  it("falls back gracefully when bid/ask is missing — spread filter is not applied", () => {
    const tickers: Record<string, Ticker> = {
      "BTC/USDT": ticker("BTC/USDT", { quoteVolume24h: 500_000_000, changePercent24h: 2 }),
    };
    const out = runLightweightScreen({ universe, tickers, source: "WIDE_MARKET" });
    expect(out).toHaveLength(1);
    expect(out[0].spreadPercent).toBeNull();
  });

  it("skips symbols missing live ticker data (no fan-out fetch)", () => {
    const tickers: Record<string, Ticker> = {}; // empty
    const out = runLightweightScreen({ universe, tickers, source: "WIDE_MARKET" });
    expect(out).toHaveLength(0);
  });

  it("computeMarketQualityPreScore is bounded to 0..100", () => {
    expect(computeMarketQualityPreScore({ quoteVolume: 0, absChangePercent: 0, spreadPercent: 0 })).toBeGreaterThanOrEqual(0);
    expect(computeMarketQualityPreScore({ quoteVolume: 1e12, absChangePercent: 50, spreadPercent: 0 })).toBeLessThanOrEqual(100);
    // Higher volume + bigger movement → higher score.
    const lo = computeMarketQualityPreScore({ quoteVolume: 5_000_000, absChangePercent: 0.6, spreadPercent: null });
    const hi = computeMarketQualityPreScore({ quoteVolume: 500_000_000, absChangePercent: 4, spreadPercent: 0.05 });
    expect(hi).toBeGreaterThan(lo);
  });
});

// ---------- candidate-pool ----------
function lwc(over: Partial<LightweightCandidate>): LightweightCandidate {
  return {
    symbol: over.symbol ?? "BTC/USDT",
    priceChangePercent: 2,
    quoteVolume: 100_000_000,
    lastPrice: 100,
    bidPrice: null,
    askPrice: null,
    spreadPercent: null,
    active: true,
    sourceCandidates: ["WIDE_MARKET"],
    marketQualityPreScore: 60,
    ...over,
  };
}

describe("buildCandidatePool", () => {
  it("dedupes by symbol and merges sources from multiple groups", () => {
    const wide = [lwc({ symbol: "BTC/USDT", marketQualityPreScore: 70, sourceCandidates: ["WIDE_MARKET"] })];
    const mom = [
      lwc({ symbol: "BTC/USDT", marketQualityPreScore: 90, sourceCandidates: ["MOMENTUM"] }),
      lwc({ symbol: "ETH/USDT", marketQualityPreScore: 65, sourceCandidates: ["MOMENTUM"] }),
    ];
    const manual = [lwc({ symbol: "BTC/USDT", marketQualityPreScore: 50, sourceCandidates: ["MANUAL_LIST"] })];
    const pool = buildCandidatePool([wide, mom, manual]);
    const btc = pool.find((p) => p.symbol === "BTC/USDT")!;
    expect(btc.sources).toEqual(["WIDE_MARKET", "MOMENTUM", "MANUAL_LIST"]);
    expect(btc.candidate.marketQualityPreScore).toBe(90); // best-of wins
    expect(getDisplayedSource(btc)).toBe("MIXED");

    const eth = pool.find((p) => p.symbol === "ETH/USDT")!;
    expect(getDisplayedSource(eth)).toBe("MOMENTUM");
  });

  it("enforces maxSize (default 50)", () => {
    const big = Array.from({ length: 120 }, (_, i) =>
      lwc({ symbol: `C${i}/USDT`, marketQualityPreScore: 100 - i }),
    );
    const pool = buildCandidatePool([big]);
    expect(pool).toHaveLength(50);
    // Highest-score entries kept
    expect(pool[0].candidate.marketQualityPreScore).toBe(100);
    expect(pool[49].candidate.marketQualityPreScore).toBe(51);
  });

  it("respects custom maxSize", () => {
    const big = Array.from({ length: 10 }, (_, i) => lwc({ symbol: `C${i}/USDT`, marketQualityPreScore: 100 - i }));
    expect(buildCandidatePool([big], { maxSize: 5 })).toHaveLength(5);
    expect(buildCandidatePool([big], { maxSize: 0 })).toHaveLength(0);
  });
});

// ---------- deep-analysis ----------
describe("getDeepAnalysisCandidates", () => {
  it("caps at default 30 and ranks 1..N by preScore desc", () => {
    const big = Array.from({ length: 80 }, (_, i) =>
      lwc({ symbol: `C${i}/USDT`, marketQualityPreScore: i }), // ascending
    );
    const pool = buildCandidatePool([big], { maxSize: 80 });
    const deep = getDeepAnalysisCandidates(pool);
    expect(deep).toHaveLength(30);
    expect(deep[0].rank).toBe(1);
    expect(deep[29].rank).toBe(30);
    // Highest preScore first
    expect(deep[0].candidate.marketQualityPreScore).toBe(79);
    expect(deep[29].candidate.marketQualityPreScore).toBe(50);
  });

  it("respects custom max and handles empty input", () => {
    expect(getDeepAnalysisCandidates([])).toEqual([]);
    const pool = buildCandidatePool([[lwc({ symbol: "BTC/USDT" })]]);
    expect(getDeepAnalysisCandidates(pool, { max: 0 })).toEqual([]);
    expect(getDeepAnalysisCandidates(pool, { max: 5 })).toHaveLength(1);
  });

  it("breaks ties by quoteVolume then movement then symbol", () => {
    const a = lwc({ symbol: "AAA/USDT", marketQualityPreScore: 80, quoteVolume: 100, priceChangePercent: 2 });
    const b = lwc({ symbol: "BBB/USDT", marketQualityPreScore: 80, quoteVolume: 200, priceChangePercent: 2 });
    const c = lwc({ symbol: "CCC/USDT", marketQualityPreScore: 80, quoteVolume: 200, priceChangePercent: 5 });
    const pool = buildCandidatePool([[a, b, c]]);
    const deep = getDeepAnalysisCandidates(pool, { max: 10 });
    // Higher quoteVolume comes before lower; within same volume, larger |move| first
    expect(deep.map((d) => d.symbol)).toEqual(["CCC/USDT", "BBB/USDT", "AAA/USDT"]);
  });
});

// ---------- Phase 2 invariants ----------
describe("Phase 2 invariants — values and rules that must NOT change", () => {
  it("signal-engine still rejects trades below 70 (MIN_SIGNAL_CONFIDENCE)", () => {
    const src = read("src/lib/engines/signal-engine.ts");
    expect(src).toMatch(/if\s*\(\s*score\s*<\s*70\s*\)/);
  });

  it("env defaults still keep live trading off and paper as default mode", () => {
    const src = read("src/lib/env.ts");
    expect(src).toMatch(/hardLiveTradingAllowed:\s*bool\(process\.env\.HARD_LIVE_TRADING_ALLOWED,\s*false\)/);
    expect(src).toMatch(/defaultTradingMode:\s*str\(process\.env\.DEFAULT_TRADING_MODE,\s*"paper"\)/);
  });

  it("settings/update endpoint still does NOT accept enable_live_trading from clients", () => {
    const src = read("src/app/api/settings/update/route.ts");
    expect(src).not.toMatch(/enable_live_trading/);
  });

  it("market-universe layer issues no Binance HTTP calls (only the central adapter is allowed)", () => {
    // Per docs/BINANCE_API_GUARDRAILS.md §8/§12: scattered fetch/axios/http calls
    // outside the central adapter are forbidden. The market-universe layer
    // must rely entirely on the adapter via getAdapter().
    for (const file of [
      "src/lib/market-universe/types.ts",
      "src/lib/market-universe/universe-store.ts",
      "src/lib/market-universe/lightweight-screener.ts",
      "src/lib/market-universe/candidate-pool.ts",
      "src/lib/market-universe/deep-analysis.ts",
      "src/lib/market-universe/index.ts",
    ]) {
      const src = read(file);
      // No raw fetch / axios / fapi.binance.com / fetchJson outside the adapter.
      expect(src).not.toMatch(/\bfetch\s*\(/);
      expect(src).not.toMatch(/axios/);
      expect(src).not.toMatch(/fapi\.binance\.com/);
      expect(src).not.toMatch(/fetchJson/);
    }
  });

  it("Binance API guardrails doc is still present", () => {
    const doc = read("docs/BINANCE_API_GUARDRAILS.md");
    expect(doc).toMatch(/Değişmez Ana Kural/);
    expect(doc).toMatch(/418/);
    expect(doc).toMatch(/Retry-After/);
  });
});
