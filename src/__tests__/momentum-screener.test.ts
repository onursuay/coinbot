// Phase 3 — Momentum Taraması tests.
//
// Verifies:
//  - top gainers + top losers selected together (no direction knob)
//  - hygiene filters: stablecoin, status, volume, spread, |move|
//  - dedupe across the merged top-N lists
//  - maxMomentumCandidates cap
//  - momentumScore bounded to 0..100
//  - directionBias UP/DOWN follows signed change%
//  - integration with Phase-2 candidate pool: MOMENTUM source preserved;
//    GMT + MT collision collapses to MIXED → KRM
//  - module is HTTP-free (no fetch / axios / fapi.binance.com)
//  - Phase-3 invariants: trade threshold 70 unchanged, live gate unchanged

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Ticker } from "@/lib/exchanges/types";
import type { MarketSymbolInfo, LightweightCandidate } from "@/lib/market-universe/types";
import { buildCandidatePool, getDisplayedSource } from "@/lib/market-universe";
import {
  DEFAULT_MOMENTUM_CONFIG,
  runMomentumScreen,
  computeMomentumScore,
  type MomentumCandidate,
} from "@/lib/momentum-screener";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

function uSym(over: Partial<MarketSymbolInfo> & { symbol: string; baseAsset: string }): MarketSymbolInfo {
  return {
    quoteAsset: "USDT",
    contractType: "perpetual",
    status: "TRADING",
    ...over,
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
    changePercent24h: 0,
    timestamp: Date.now(),
    ...over,
  };
}

describe("runMomentumScreen — gainers and losers together", () => {
  const universe: MarketSymbolInfo[] = [
    uSym({ symbol: "AAA/USDT", baseAsset: "AAA" }),
    uSym({ symbol: "BBB/USDT", baseAsset: "BBB" }),
    uSym({ symbol: "CCC/USDT", baseAsset: "CCC" }),
    uSym({ symbol: "DDD/USDT", baseAsset: "DDD" }),
    uSym({ symbol: "EEE/USDT", baseAsset: "EEE" }),
    uSym({ symbol: "FFF/USDT", baseAsset: "FFF" }),
    // stablecoin base — never selected
    uSym({ symbol: "USDC/USDT", baseAsset: "USDC" }),
  ];

  const tickers: Record<string, Ticker> = {
    "AAA/USDT": ticker("AAA/USDT", { quoteVolume24h: 200_000_000, changePercent24h: 12 }), // big gainer
    "BBB/USDT": ticker("BBB/USDT", { quoteVolume24h: 150_000_000, changePercent24h: 8 }),  // gainer
    "CCC/USDT": ticker("CCC/USDT", { quoteVolume24h: 100_000_000, changePercent24h: -10 }), // big loser
    "DDD/USDT": ticker("DDD/USDT", { quoteVolume24h:  80_000_000, changePercent24h: -6 }),  // loser
    "EEE/USDT": ticker("EEE/USDT", { quoteVolume24h:  60_000_000, changePercent24h: 0.5 }), // below |move| floor
    "FFF/USDT": ticker("FFF/USDT", { quoteVolume24h:     500_000, changePercent24h: 5 }),   // below volume floor
    "USDC/USDT": ticker("USDC/USDT", { quoteVolume24h: 1e9, changePercent24h: 5 }),
  };

  it("selects top gainers AND top losers (both directions) by default", () => {
    const out = runMomentumScreen({ universe, tickers });
    const symbols = out.map((c) => c.symbol).sort();
    // AAA, BBB on the gainers side; CCC, DDD on the losers side. EEE/FFF/USDC excluded.
    expect(symbols).toEqual(["AAA/USDT", "BBB/USDT", "CCC/USDT", "DDD/USDT"]);
  });

  it("attaches directionBias correctly per signed change%", () => {
    const out = runMomentumScreen({ universe, tickers });
    const byBias: Record<string, "UP" | "DOWN"> = {};
    for (const c of out) byBias[c.symbol] = c.directionBias;
    expect(byBias["AAA/USDT"]).toBe("UP");
    expect(byBias["BBB/USDT"]).toBe("UP");
    expect(byBias["CCC/USDT"]).toBe("DOWN");
    expect(byBias["DDD/USDT"]).toBe("DOWN");
  });

  it("ranks deterministically (1..N) sorted by momentumScore desc", () => {
    const out = runMomentumScreen({ universe, tickers });
    expect(out.map((c) => c.momentumRank)).toEqual([1, 2, 3, 4]);
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1].momentumScore).toBeGreaterThanOrEqual(out[i].momentumScore);
    }
  });

  it("source attribution is MOMENTUM on every emitted row", () => {
    const out = runMomentumScreen({ universe, tickers });
    for (const c of out) {
      expect(c.sourceCandidates).toEqual(["MOMENTUM"]);
    }
  });

  it("config exposes only Aktif/Pasif equivalent — no gainers/losers/both knob", () => {
    // The config object must NOT carry a direction selector; only the
    // top-N counts per direction (which are internal limits, not UI knobs).
    const keys = Object.keys(DEFAULT_MOMENTUM_CONFIG);
    expect(keys).not.toContain("direction");
    expect(keys).not.toContain("mode");
    expect(keys).not.toContain("includeGainers");
    expect(keys).not.toContain("includeLosers");
  });
});

describe("Hygiene filters", () => {
  const baseUniverse: MarketSymbolInfo[] = [
    uSym({ symbol: "X/USDT", baseAsset: "X" }),
  ];

  it("filters by minQuoteVolumeUsd", () => {
    const out = runMomentumScreen({
      universe: baseUniverse,
      tickers: { "X/USDT": ticker("X/USDT", { quoteVolume24h: 500_000, changePercent24h: 8 }) },
    });
    expect(out).toHaveLength(0);
  });

  it("filters by minAbsMovePercent (default 2%)", () => {
    const out = runMomentumScreen({
      universe: baseUniverse,
      tickers: { "X/USDT": ticker("X/USDT", { quoteVolume24h: 100_000_000, changePercent24h: 0.5 }) },
    });
    expect(out).toHaveLength(0);
  });

  it("applies spread filter only when bid/ask is available", () => {
    const out1 = runMomentumScreen({
      universe: baseUniverse,
      tickers: { "X/USDT": ticker("X/USDT", { quoteVolume24h: 100_000_000, changePercent24h: 5 }) },
      bookTickers: { "X/USDT": { bid: 100, ask: 105 } }, // ~4.88% spread → reject
    });
    expect(out1).toHaveLength(0);

    const out2 = runMomentumScreen({
      universe: baseUniverse,
      tickers: { "X/USDT": ticker("X/USDT", { quoteVolume24h: 100_000_000, changePercent24h: 5 }) },
      bookTickers: { "X/USDT": { bid: 99.99, ask: 100.01 } }, // tight → pass
    });
    expect(out2).toHaveLength(1);
    expect(out2[0].spreadPercent).toBeGreaterThan(0);
  });

  it("rejects stablecoin bases unconditionally", () => {
    const out = runMomentumScreen({
      universe: [
        uSym({ symbol: "USDC/USDT", baseAsset: "USDC" }),
        uSym({ symbol: "DAI/USDT", baseAsset: "DAI" }),
      ],
      tickers: {
        "USDC/USDT": ticker("USDC/USDT", { quoteVolume24h: 1e9, changePercent24h: 8 }),
        "DAI/USDT": ticker("DAI/USDT", { quoteVolume24h: 1e9, changePercent24h: -8 }),
      },
    });
    expect(out).toHaveLength(0);
  });

  it("respects topGainersLimit and topLosersLimit independently", () => {
    const universe: MarketSymbolInfo[] = [];
    const tickers: Record<string, Ticker> = {};
    for (let i = 0; i < 30; i++) {
      const g = `G${i}/USDT`;
      universe.push(uSym({ symbol: g, baseAsset: `G${i}` }));
      tickers[g] = ticker(g, { quoteVolume24h: 100_000_000 + i, changePercent24h: 30 - i * 0.5 });
    }
    for (let i = 0; i < 30; i++) {
      const l = `L${i}/USDT`;
      universe.push(uSym({ symbol: l, baseAsset: `L${i}` }));
      tickers[l] = ticker(l, { quoteVolume24h: 100_000_000 + i, changePercent24h: -30 + i * 0.5 });
    }
    const out = runMomentumScreen({
      universe,
      tickers,
      config: { topGainersLimit: 5, topLosersLimit: 5, maxMomentumCandidates: 100 },
    });
    expect(out.length).toBe(10);
    const ups = out.filter((c) => c.directionBias === "UP").length;
    const downs = out.filter((c) => c.directionBias === "DOWN").length;
    expect(ups).toBe(5);
    expect(downs).toBe(5);
  });

  it("enforces maxMomentumCandidates as a final hard cap", () => {
    const universe: MarketSymbolInfo[] = [];
    const tickers: Record<string, Ticker> = {};
    for (let i = 0; i < 60; i++) {
      const g = `G${i}/USDT`;
      universe.push(uSym({ symbol: g, baseAsset: `G${i}` }));
      tickers[g] = ticker(g, { quoteVolume24h: 100_000_000, changePercent24h: 30 - i * 0.3 });
    }
    const out = runMomentumScreen({
      universe,
      tickers,
      config: { topGainersLimit: 60, topLosersLimit: 60, maxMomentumCandidates: 12 },
    });
    expect(out.length).toBe(12);
    expect(out[out.length - 1].momentumRank).toBe(12);
  });
});

describe("computeMomentumScore", () => {
  it("returns a value in [0, 100]", () => {
    expect(computeMomentumScore({ absChangePercent: 0, quoteVolume: 0, spreadPercent: 0 })).toBeGreaterThanOrEqual(0);
    expect(computeMomentumScore({ absChangePercent: 50, quoteVolume: 1e12, spreadPercent: 0 })).toBeLessThanOrEqual(100);
  });

  it("rewards larger movements and higher volume", () => {
    const lo = computeMomentumScore({ absChangePercent: 2, quoteVolume: 5_000_000, spreadPercent: null });
    const hi = computeMomentumScore({ absChangePercent: 12, quoteVolume: 500_000_000, spreadPercent: 0.05 });
    expect(hi).toBeGreaterThan(lo);
  });

  it("grants full spread credit when spreadPercent is unknown (null)", () => {
    const known = computeMomentumScore({ absChangePercent: 5, quoteVolume: 100_000_000, spreadPercent: 0.30 });
    const unknown = computeMomentumScore({ absChangePercent: 5, quoteVolume: 100_000_000, spreadPercent: null });
    expect(unknown).toBeGreaterThanOrEqual(known);
  });
});

describe("Integration with Phase-2 candidate pool", () => {
  const universe: MarketSymbolInfo[] = [
    uSym({ symbol: "BTC/USDT", baseAsset: "BTC" }),
    uSym({ symbol: "ETH/USDT", baseAsset: "ETH" }),
  ];
  const tickers: Record<string, Ticker> = {
    "BTC/USDT": ticker("BTC/USDT", { quoteVolume24h: 500_000_000, changePercent24h: 7 }),
    "ETH/USDT": ticker("ETH/USDT", { quoteVolume24h: 200_000_000, changePercent24h: -4 }),
  };

  it("MOMENTUM source survives buildCandidatePool when alone", () => {
    const moms = runMomentumScreen({ universe, tickers });
    const pool = buildCandidatePool([moms]);
    for (const e of pool) {
      expect(e.sources).toEqual(["MOMENTUM"]);
      expect(getDisplayedSource(e)).toBe("MOMENTUM");
    }
  });

  it("GMT (WIDE_MARKET) + MT (MOMENTUM) collision collapses to MIXED → KRM", () => {
    // Hand-crafted GMT row for BTC so it collides with the MT row.
    const gmt: LightweightCandidate[] = [{
      symbol: "BTC/USDT",
      priceChangePercent: 7,
      quoteVolume: 500_000_000,
      lastPrice: 100,
      bidPrice: null,
      askPrice: null,
      spreadPercent: null,
      active: true,
      sourceCandidates: ["WIDE_MARKET"],
      marketQualityPreScore: 75,
    }];
    const mt: MomentumCandidate[] = runMomentumScreen({
      universe: [uSym({ symbol: "BTC/USDT", baseAsset: "BTC" })],
      tickers: { "BTC/USDT": tickers["BTC/USDT"] },
    });

    const pool = buildCandidatePool([gmt, mt]);
    const btc = pool.find((p) => p.symbol === "BTC/USDT")!;
    expect(btc.sources.sort()).toEqual(["MOMENTUM", "WIDE_MARKET"]);
    expect(getDisplayedSource(btc)).toBe("MIXED");
  });

  it("respects pool max — momentum candidates can be capped by the pool layer too", () => {
    const big: MomentumCandidate[] = Array.from({ length: 40 }, (_, i) => ({
      symbol: `C${i}/USDT`,
      priceChangePercent: 5 + (i % 3),
      quoteVolume: 100_000_000 - i,
      lastPrice: 100,
      bidPrice: null,
      askPrice: null,
      spreadPercent: null,
      active: true,
      sourceCandidates: ["MOMENTUM"],
      marketQualityPreScore: 100 - i,
      directionBias: "UP",
      momentumRank: i + 1,
      momentumScore: 100 - i,
    }));
    const pool = buildCandidatePool([big], { maxSize: 25 });
    expect(pool).toHaveLength(25);
  });
});

describe("Phase-3 invariants — module hygiene + global guarantees", () => {
  const FILES = [
    "src/lib/momentum-screener/types.ts",
    "src/lib/momentum-screener/momentum-screener.ts",
    "src/lib/momentum-screener/index.ts",
  ];

  it("momentum-screener module issues no Binance HTTP calls", () => {
    for (const file of FILES) {
      const src = read(file);
      expect(src).not.toMatch(/\bfetch\s*\(/);
      expect(src).not.toMatch(/axios/);
      expect(src).not.toMatch(/fapi\.binance\.com/);
      expect(src).not.toMatch(/fetchJson/);
    }
  });

  it("signal-engine still rejects trades below 70", () => {
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

  it("Binance API guardrails doc is still present", () => {
    const doc = read("docs/BINANCE_API_GUARDRAILS.md");
    expect(doc).toMatch(/Değişmez Ana Kural/);
    expect(doc).toMatch(/418/);
  });
});
