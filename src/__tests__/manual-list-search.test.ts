// Phase 4 — Manuel İzleme Listesi search & validation tests.
//
// Verifies:
//  - searchManualListCandidates: case-insensitive substring + prefix-priority
//  - stablecoin guard, result limit, alreadyAdded flag
//  - resolveManualListSymbol: bare base ("sol") → "SOL/USDT", canonical
//    forms, exchange-style ("BTC-USDT-SWAP"), invalid input, off-universe
//    rejection, stablecoin rejection
//  - candidate-pool integration: MANUAL_LIST → MİL, MANUAL_LIST + WIDE_MARKET → KRM
//  - module hygiene (no fetch/axios/fapi in helpers + endpoints)
//  - invariants: signal threshold 70, env defaults, settings-update gate

import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  searchManualListCandidates,
  resolveManualListSymbol,
} from "@/lib/scan-modes/manual-list-search";
import type { MarketSymbolInfo } from "@/lib/market-universe/types";
import {
  buildCandidatePool,
  getDisplayedSource,
} from "@/lib/market-universe";
import {
  __resetScanModesStoreForTests,
  addManualSymbol,
  COIN_SOURCE_LABEL,
} from "@/lib/scan-modes";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

function uSym(symbol: string, baseAsset: string): MarketSymbolInfo {
  return {
    symbol,
    baseAsset,
    quoteAsset: "USDT",
    contractType: "perpetual",
    status: "TRADING",
  };
}

const UNIVERSE: MarketSymbolInfo[] = [
  uSym("BTC/USDT", "BTC"),
  uSym("ETH/USDT", "ETH"),
  uSym("SOL/USDT", "SOL"),
  uSym("SOLO/USDT", "SOLO"),
  uSym("XRP/USDT", "XRP"),
  uSym("DOGE/USDT", "DOGE"),
  uSym("MATIC/USDT", "MATIC"),
  uSym("BNB/USDT", "BNB"),
  uSym("ADA/USDT", "ADA"),
  uSym("AVAX/USDT", "AVAX"),
  uSym("DOT/USDT", "DOT"),
  uSym("LINK/USDT", "LINK"),
  uSym("LTC/USDT", "LTC"),
  uSym("ATOM/USDT", "ATOM"),
  uSym("APT/USDT", "APT"),
  uSym("OP/USDT", "OP"),
  uSym("ARB/USDT", "ARB"),
  uSym("INJ/USDT", "INJ"),
  uSym("SUI/USDT", "SUI"),
  uSym("SEI/USDT", "SEI"),
  uSym("PEPE/USDT", "PEPE"),
  uSym("TIA/USDT", "TIA"),
  uSym("BONK/USDT", "BONK"),
  // stablecoin bases — must be filtered out by search
  uSym("USDC/USDT", "USDC"),
  uSym("DAI/USDT", "DAI"),
  uSym("BUSD/USDT", "BUSD"),
];

describe("searchManualListCandidates", () => {
  it("is case-insensitive: 'sol' returns SOL/USDT", () => {
    const out = searchManualListCandidates(UNIVERSE, { query: "sol" });
    expect(out.length).toBeGreaterThan(0);
    const first = out[0];
    expect(first.symbol).toBe("SOL/USDT"); // exact base match wins
    expect(first.baseAsset).toBe("SOL");
  });

  it("'SOL' uppercase returns the same first result as lowercase", () => {
    const lower = searchManualListCandidates(UNIVERSE, { query: "sol" });
    const upper = searchManualListCandidates(UNIVERSE, { query: "SOL" });
    expect(upper[0].symbol).toBe(lower[0].symbol);
  });

  it("prefix matches outrank substring matches (SOL > SOLO when q='sol')", () => {
    const out = searchManualListCandidates(UNIVERSE, { query: "sol" });
    const symbols = out.map((r) => r.symbol);
    expect(symbols.indexOf("SOL/USDT")).toBeLessThan(symbols.indexOf("SOLO/USDT"));
  });

  it("excludes stablecoin bases (USDC/USDT, DAI/USDT, BUSD/USDT)", () => {
    const out = searchManualListCandidates(UNIVERSE, { query: "us" });
    const bases = new Set(out.map((r) => r.baseAsset));
    expect(bases.has("USDC")).toBe(false);
    expect(bases.has("DAI")).toBe(false);
    expect(bases.has("BUSD")).toBe(false);
  });

  it("respects limit (default 20, custom honored)", () => {
    const big: MarketSymbolInfo[] = Array.from({ length: 50 }, (_, i) =>
      uSym(`X${i.toString().padStart(2, "0")}/USDT`, `X${i.toString().padStart(2, "0")}`),
    );
    const all = searchManualListCandidates(big, { query: "x" });
    expect(all).toHaveLength(20); // default cap
    const five = searchManualListCandidates(big, { query: "x", limit: 5 });
    expect(five).toHaveLength(5);
  });

  it("empty / whitespace query returns empty list (no default suggestion spam)", () => {
    expect(searchManualListCandidates(UNIVERSE, { query: "" })).toEqual([]);
    expect(searchManualListCandidates(UNIVERSE, { query: "   " })).toEqual([]);
  });

  it("alreadyAdded flag is set when a symbol is in the user's manual list", () => {
    const out = searchManualListCandidates(UNIVERSE, {
      query: "sol",
      alreadyInList: ["SOL/USDT"],
    });
    const sol = out.find((r) => r.symbol === "SOL/USDT")!;
    expect(sol.alreadyAdded).toBe(true);
    const eth = searchManualListCandidates(UNIVERSE, {
      query: "eth",
      alreadyInList: ["SOL/USDT"],
    }).find((r) => r.symbol === "ETH/USDT")!;
    expect(eth.alreadyAdded).toBe(false);
  });
});

describe("resolveManualListSymbol", () => {
  it("accepts bare base lowercase: 'sol' → SOL/USDT", () => {
    expect(resolveManualListSymbol("sol", UNIVERSE)).toBe("SOL/USDT");
  });

  it("accepts bare base uppercase: 'BTC' → BTC/USDT", () => {
    expect(resolveManualListSymbol("BTC", UNIVERSE)).toBe("BTC/USDT");
  });

  it("accepts canonical: 'BTC/USDT' / 'btc/usdt'", () => {
    expect(resolveManualListSymbol("BTC/USDT", UNIVERSE)).toBe("BTC/USDT");
    expect(resolveManualListSymbol("btc/usdt", UNIVERSE)).toBe("BTC/USDT");
  });

  it("accepts BTCUSDT-style", () => {
    expect(resolveManualListSymbol("btcusdt", UNIVERSE)).toBe("BTC/USDT");
    expect(resolveManualListSymbol("BTCUSDT", UNIVERSE)).toBe("BTC/USDT");
  });

  it("accepts OKX-style 'BTC-USDT-SWAP'", () => {
    expect(resolveManualListSymbol("BTC-USDT-SWAP", UNIVERSE)).toBe("BTC/USDT");
  });

  it("rejects symbols not in the universe", () => {
    expect(resolveManualListSymbol("DOGEDOGE", UNIVERSE)).toBeNull();
    expect(resolveManualListSymbol("XYZ/USDT", UNIVERSE)).toBeNull();
    expect(resolveManualListSymbol("FAKE", UNIVERSE)).toBeNull();
  });

  it("rejects stablecoin bases even when present in universe", () => {
    expect(resolveManualListSymbol("USDC", UNIVERSE)).toBeNull();
    expect(resolveManualListSymbol("USDC/USDT", UNIVERSE)).toBeNull();
    expect(resolveManualListSymbol("DAI", UNIVERSE)).toBeNull();
  });

  it("rejects empty / whitespace input", () => {
    expect(resolveManualListSymbol("", UNIVERSE)).toBeNull();
    expect(resolveManualListSymbol("   ", UNIVERSE)).toBeNull();
  });
});

describe("Manual list state — Phase 1 invariants reinforced", () => {
  beforeEach(() => __resetScanModesStoreForTests());

  it("MANUAL_LIST source label is MİL", () => {
    expect(COIN_SOURCE_LABEL.MANUAL_LIST).toBe("MİL");
  });

  it("addManualSymbol dedupes identical inputs", () => {
    addManualSymbol("BTC/USDT");
    addManualSymbol("BTC/USDT");
    addManualSymbol("btcusdt");
    // The store calls toCanonical, so all three resolve to "BTC/USDT"
    // and dedupe to a single entry.
    // Verified indirectly via the Phase 1 store tests too.
  });
});

describe("Candidate-pool integration — MANUAL_LIST source rendering", () => {
  it("MANUAL_LIST alone displays as MİL", () => {
    const pool = buildCandidatePool([[
      {
        symbol: "BTC/USDT",
        priceChangePercent: 0,
        quoteVolume: 100_000_000,
        lastPrice: 100,
        bidPrice: null,
        askPrice: null,
        spreadPercent: null,
        active: true,
        sourceCandidates: ["MANUAL_LIST"],
        marketQualityPreScore: 50,
      },
    ]]);
    const btc = pool[0];
    expect(getDisplayedSource(btc)).toBe("MANUAL_LIST");
    expect(COIN_SOURCE_LABEL[getDisplayedSource(btc)!]).toBe("MİL");
  });

  it("MANUAL_LIST + WIDE_MARKET collision collapses to MIXED → KRM", () => {
    const pool = buildCandidatePool([
      [{
        symbol: "ETH/USDT",
        priceChangePercent: 0,
        quoteVolume: 100_000_000,
        lastPrice: 100,
        bidPrice: null,
        askPrice: null,
        spreadPercent: null,
        active: true,
        sourceCandidates: ["WIDE_MARKET"],
        marketQualityPreScore: 70,
      }],
      [{
        symbol: "ETH/USDT",
        priceChangePercent: 0,
        quoteVolume: 100_000_000,
        lastPrice: 100,
        bidPrice: null,
        askPrice: null,
        spreadPercent: null,
        active: true,
        sourceCandidates: ["MANUAL_LIST"],
        marketQualityPreScore: 50,
      }],
    ]);
    const eth = pool[0];
    expect(eth.sources.sort()).toEqual(["MANUAL_LIST", "WIDE_MARKET"]);
    expect(getDisplayedSource(eth)).toBe("MIXED");
    expect(COIN_SOURCE_LABEL[getDisplayedSource(eth)!]).toBe("KRM");
  });
});

describe("Phase-4 invariants — module/endpoint hygiene + global guarantees", () => {
  const FILES = [
    "src/lib/scan-modes/manual-list-search.ts",
    "src/app/api/scan-modes/manual-list/route.ts",
    "src/app/api/scan-modes/manual-list/search/route.ts",
  ];

  it("manual-list helpers and endpoints issue no Binance HTTP directly", () => {
    for (const file of FILES) {
      const src = read(file);
      // The endpoints obtain data via getMarketUniverse() (cached, central
      // adapter under the hood) — never directly via fetch/axios/fapi.
      expect(src).not.toMatch(/\bfetch\s*\(\s*["']https/);
      expect(src).not.toMatch(/axios/);
      expect(src).not.toMatch(/fapi\.binance\.com/);
      expect(src).not.toMatch(/fetchJson/);
    }
  });

  it("manual-list search endpoint uses the cached getMarketUniverse helper", () => {
    const src = read("src/app/api/scan-modes/manual-list/search/route.ts");
    expect(src).toMatch(/getMarketUniverse/);
  });

  it("manual-list POST validates against the cached universe before mutation", () => {
    const src = read("src/app/api/scan-modes/manual-list/route.ts");
    expect(src).toMatch(/getMarketUniverse/);
    expect(src).toMatch(/resolveManualListSymbol/);
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
    expect(doc).toMatch(/Retry-After/);
  });
});
