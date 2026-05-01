// Phase 5 — Birleşik Aday Havuz Entegrasyonu tests.
//
// Verifies:
//  - 3 sources active → single unified pool
//  - Toggling each source off prevents its candidates from joining
//  - Manuel pasif: list preserved (Faz 1) but candidates excluded
//  - Same coin from all 3 sources → single entry, MIXED → KRM
//  - Single MANUAL_LIST → MİL displayed
//  - poolMax (default 50) and deepMax (default 30) caps
//  - summary metrics correctness (counts, mixed, missing-data, filtered-out)
//  - off-universe manual symbol stripped (filteredOutManualSymbols)
//  - missing market data: in-universe symbol without ticker is included
//    as degraded entry and listed in missingMarketDataSymbols
//  - module hygiene: no fetch/axios/fapi/fetchJson in orchestrator files
//  - worker behavior unchanged: orchestrator NOT imported under worker/
//  - global invariants: signal threshold 70, env defaults, settings gate

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Ticker } from "@/lib/exchanges/types";
import type { MarketSymbolInfo } from "@/lib/market-universe/types";
import { getDisplayedSource } from "@/lib/market-universe";
import {
  buildUnifiedCandidatePool,
  type UnifiedCandidatePool,
} from "@/lib/candidate-orchestrator";
import { COIN_SOURCE_LABEL, type ScanModesConfig } from "@/lib/scan-modes/types";

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

function ticker(sym: string, over: Partial<Ticker> = {}): Ticker {
  return {
    symbol: sym,
    lastPrice: 100,
    bid: 100,
    ask: 100,
    spread: 0,
    volume24h: 0,
    quoteVolume24h: 100_000_000,
    high24h: 105,
    low24h: 95,
    changePercent24h: 3,
    timestamp: Date.now(),
    ...over,
  };
}

function modes(over: Partial<ScanModesConfig> = {}): ScanModesConfig {
  return {
    wideMarket: { active: false, ...over.wideMarket },
    momentum: { active: false, direction: "both", ...over.momentum },
    manualList: { active: false, symbols: [], ...over.manualList },
  };
}

const UNIVERSE: MarketSymbolInfo[] = [
  uSym("BTC/USDT", "BTC"),
  uSym("ETH/USDT", "ETH"),
  uSym("SOL/USDT", "SOL"),
  uSym("DOGE/USDT", "DOGE"),
  uSym("XRP/USDT", "XRP"),
  uSym("AVAX/USDT", "AVAX"),
  uSym("MATIC/USDT", "MATIC"),
];

const TICKERS: Record<string, Ticker> = {
  "BTC/USDT": ticker("BTC/USDT", { quoteVolume24h: 800_000_000, changePercent24h: 6 }),
  "ETH/USDT": ticker("ETH/USDT", { quoteVolume24h: 500_000_000, changePercent24h: 4 }),
  "SOL/USDT": ticker("SOL/USDT", { quoteVolume24h: 250_000_000, changePercent24h: -7 }),
  "DOGE/USDT": ticker("DOGE/USDT", { quoteVolume24h: 150_000_000, changePercent24h: 9 }),
  "XRP/USDT": ticker("XRP/USDT", { quoteVolume24h: 120_000_000, changePercent24h: -5 }),
  "AVAX/USDT": ticker("AVAX/USDT", { quoteVolume24h: 80_000_000, changePercent24h: 3 }),
  "MATIC/USDT": ticker("MATIC/USDT", { quoteVolume24h: 60_000_000, changePercent24h: -3 }),
};

describe("buildUnifiedCandidatePool — source activation", () => {
  it("with all 3 sources active, produces a single unified pool", () => {
    const result = buildUnifiedCandidatePool({
      scanModes: modes({
        wideMarket: { active: true },
        momentum: { active: true, direction: "both" },
        manualList: { active: true, symbols: ["AVAX/USDT"] },
      }),
      universe: UNIVERSE,
      tickers: TICKERS,
    });
    expect(result.summary.unifiedCandidateCount).toBeGreaterThan(0);
    expect(result.summary.wideMarketCandidateCount).toBeGreaterThan(0);
    expect(result.summary.momentumCandidateCount).toBeGreaterThan(0);
    expect(result.summary.manualListCandidateCount).toBe(1);
  });

  it("WIDE_MARKET inactive → no WIDE_MARKET candidates contribute", () => {
    const result = buildUnifiedCandidatePool({
      scanModes: modes({
        momentum: { active: true, direction: "both" },
      }),
      universe: UNIVERSE,
      tickers: TICKERS,
    });
    expect(result.summary.wideMarketCandidateCount).toBe(0);
    for (const e of result.pool) {
      expect(e.sources).not.toContain("WIDE_MARKET");
    }
  });

  it("MOMENTUM inactive → no MOMENTUM candidates contribute", () => {
    const result = buildUnifiedCandidatePool({
      scanModes: modes({
        wideMarket: { active: true },
      }),
      universe: UNIVERSE,
      tickers: TICKERS,
    });
    expect(result.summary.momentumCandidateCount).toBe(0);
    for (const e of result.pool) {
      expect(e.sources).not.toContain("MOMENTUM");
    }
  });

  it("MANUAL_LIST inactive → manual symbols excluded from pool but PRESERVED in config", () => {
    const cfg = modes({
      wideMarket: { active: true },
      manualList: { active: false, symbols: ["AVAX/USDT", "MATIC/USDT"] },
    });
    const result = buildUnifiedCandidatePool({
      scanModes: cfg,
      universe: UNIVERSE,
      tickers: TICKERS,
    });
    expect(result.summary.manualListCandidateCount).toBe(0);
    for (const e of result.pool) {
      expect(e.sources).not.toContain("MANUAL_LIST");
    }
    // Config object itself is unchanged — caller still owns the saved list.
    expect(cfg.manualList.symbols).toEqual(["AVAX/USDT", "MATIC/USDT"]);
  });
});

describe("Source merging — dedupe and KRM rendering", () => {
  it("same coin from all 3 sources produces a single entry with MIXED → KRM", () => {
    // BTC fits all three: wide-market screener picks it (volume + movement),
    // momentum screener picks it (top gainer), manual list contains it.
    const result = buildUnifiedCandidatePool({
      scanModes: modes({
        wideMarket: { active: true },
        momentum: { active: true, direction: "both" },
        manualList: { active: true, symbols: ["BTC/USDT"] },
      }),
      universe: UNIVERSE,
      tickers: TICKERS,
    });
    const btc = result.pool.find((e) => e.symbol === "BTC/USDT");
    expect(btc).toBeTruthy();
    const sources = (btc!.sources as string[]).slice().sort();
    expect(sources).toEqual(["MANUAL_LIST", "MOMENTUM", "WIDE_MARKET"]);
    expect(getDisplayedSource(btc!)).toBe("MIXED");
    expect(COIN_SOURCE_LABEL[getDisplayedSource(btc!)!]).toBe("KRM");
    // Symbol exists exactly ONCE in the pool.
    const occurrences = result.pool.filter((e) => e.symbol === "BTC/USDT").length;
    expect(occurrences).toBe(1);
  });

  it("single-source MANUAL_LIST entry displays as MİL", () => {
    // A coin only the user picked (no momentum / wide-market match).
    // Use a freshly-listed-style coin: low volume so it slips both screens.
    const universe: MarketSymbolInfo[] = [uSym("XYZ/USDT", "XYZ")];
    const tickers = { "XYZ/USDT": ticker("XYZ/USDT", { quoteVolume24h: 0.5e6, changePercent24h: 0.1 }) };
    const result = buildUnifiedCandidatePool({
      scanModes: modes({
        wideMarket: { active: true },
        momentum: { active: true, direction: "both" },
        manualList: { active: true, symbols: ["XYZ/USDT"] },
      }),
      universe,
      tickers,
    });
    const xyz = result.pool.find((e) => e.symbol === "XYZ/USDT")!;
    expect(xyz.sources).toEqual(["MANUAL_LIST"]);
    expect(getDisplayedSource(xyz)).toBe("MANUAL_LIST");
    expect(COIN_SOURCE_LABEL[getDisplayedSource(xyz)!]).toBe("MİL");
  });

  it("summary.mixedCandidateCount counts only entries with ≥2 sources", () => {
    const result = buildUnifiedCandidatePool({
      scanModes: modes({
        wideMarket: { active: true },
        momentum: { active: true, direction: "both" },
      }),
      universe: UNIVERSE,
      tickers: TICKERS,
    });
    let manualMix = 0;
    for (const e of result.pool) if (e.sources.length >= 2) manualMix++;
    expect(result.summary.mixedCandidateCount).toBe(manualMix);
  });
});

describe("Manual list — universe validation and missing market data", () => {
  it("off-universe manual symbols are stripped (filteredOutManualSymbols)", () => {
    const result = buildUnifiedCandidatePool({
      scanModes: modes({
        manualList: { active: true, symbols: ["FAKE/USDT", "BTC/USDT"] },
      }),
      universe: UNIVERSE,
      tickers: TICKERS,
    });
    expect(result.filteredOutManualSymbols).toEqual(["FAKE/USDT"]);
    expect(result.pool.find((e) => e.symbol === "FAKE/USDT")).toBeUndefined();
    expect(result.pool.find((e) => e.symbol === "BTC/USDT")).toBeTruthy();
  });

  it("manual symbol present in universe but no ticker → degraded entry + missingMarketDataSymbols", () => {
    const tickersWithGap: Record<string, Ticker> = { ...TICKERS };
    delete tickersWithGap["AVAX/USDT"]; // simulate stale/late ticker
    const result = buildUnifiedCandidatePool({
      scanModes: modes({
        manualList: { active: true, symbols: ["AVAX/USDT"] },
      }),
      universe: UNIVERSE,
      tickers: tickersWithGap,
    });
    expect(result.missingMarketDataSymbols).toEqual(["AVAX/USDT"]);
    expect(result.summary.missingMarketDataCount).toBe(1);
    const avax = result.pool.find((e) => e.symbol === "AVAX/USDT");
    expect(avax).toBeTruthy(); // still in pool (degraded)
    expect(avax!.candidate.marketQualityPreScore).toBe(0);
    expect(avax!.sources).toEqual(["MANUAL_LIST"]);
  });

  it("stablecoin-base manual symbols are stripped even if user added one", () => {
    const universe = [...UNIVERSE, uSym("USDC/USDT", "USDC")];
    const result = buildUnifiedCandidatePool({
      scanModes: modes({
        manualList: { active: true, symbols: ["USDC/USDT"] },
      }),
      universe,
      tickers: { ...TICKERS, "USDC/USDT": ticker("USDC/USDT", { quoteVolume24h: 1e9, changePercent24h: 5 }) },
    });
    expect(result.filteredOutManualSymbols).toEqual(["USDC/USDT"]);
    expect(result.pool.find((e) => e.symbol === "USDC/USDT")).toBeUndefined();
  });
});

describe("Limits — pool max 50, deep analysis max 30", () => {
  it("respects default poolMax=50 and deepMax=30", () => {
    // Big synthetic universe so both screens produce many candidates.
    const universe: MarketSymbolInfo[] = [];
    const tickers: Record<string, Ticker> = {};
    for (let i = 0; i < 120; i++) {
      const sym = `C${i.toString().padStart(3, "0")}/USDT`;
      universe.push(uSym(sym, `C${i}`));
      tickers[sym] = ticker(sym, {
        quoteVolume24h: 200_000_000 + i,
        changePercent24h: (i % 2 === 0 ? 1 : -1) * (3 + (i % 7)),
      });
    }
    const result = buildUnifiedCandidatePool({
      scanModes: modes({
        wideMarket: { active: true },
        momentum: { active: true, direction: "both" },
      }),
      universe,
      tickers,
    });
    expect(result.pool.length).toBeLessThanOrEqual(50);
    expect(result.deepAnalysisCandidates.length).toBeLessThanOrEqual(30);
    expect(result.summary.unifiedCandidateCount).toBe(result.pool.length);
    expect(result.summary.deepAnalysisCandidateCount).toBe(result.deepAnalysisCandidates.length);
    expect(result.summary.filteredOutCount).toBeGreaterThanOrEqual(0);
  });

  it("respects custom poolMax/deepMax", () => {
    const universe: MarketSymbolInfo[] = [];
    const tickers: Record<string, Ticker> = {};
    for (let i = 0; i < 60; i++) {
      const sym = `D${i}/USDT`;
      universe.push(uSym(sym, `D${i}`));
      tickers[sym] = ticker(sym, { quoteVolume24h: 100_000_000, changePercent24h: 4 });
    }
    const result = buildUnifiedCandidatePool({
      scanModes: modes({
        wideMarket: { active: true },
      }),
      universe,
      tickers,
      poolMax: 10,
      deepMax: 4,
    });
    expect(result.pool.length).toBe(10);
    expect(result.deepAnalysisCandidates.length).toBe(4);
  });
});

describe("Summary metrics", () => {
  it("totalUniverseCount mirrors input universe size", () => {
    const result = buildUnifiedCandidatePool({
      scanModes: modes({ wideMarket: { active: true } }),
      universe: UNIVERSE,
      tickers: TICKERS,
    });
    expect(result.summary.totalUniverseCount).toBe(UNIVERSE.length);
  });

  it("counts are non-negative integers and self-consistent", () => {
    const result: UnifiedCandidatePool = buildUnifiedCandidatePool({
      scanModes: modes({
        wideMarket: { active: true },
        momentum: { active: true, direction: "both" },
        manualList: { active: true, symbols: ["AVAX/USDT", "MATIC/USDT"] },
      }),
      universe: UNIVERSE,
      tickers: TICKERS,
    });
    const s = result.summary;
    for (const v of [
      s.totalUniverseCount,
      s.wideMarketCandidateCount,
      s.momentumCandidateCount,
      s.manualListCandidateCount,
      s.mixedCandidateCount,
      s.unifiedCandidateCount,
      s.deepAnalysisCandidateCount,
      s.filteredOutCount,
      s.missingMarketDataCount,
    ]) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
    // unified <= sum-of-source counts (because of dedupe).
    expect(s.unifiedCandidateCount).toBeLessThanOrEqual(
      s.wideMarketCandidateCount + s.momentumCandidateCount + s.manualListCandidateCount,
    );
    // deep <= unified
    expect(s.deepAnalysisCandidateCount).toBeLessThanOrEqual(s.unifiedCandidateCount);
  });
});

describe("Phase-5 invariants — module/codebase hygiene + global guarantees", () => {
  const ORCHESTRATOR_FILES = [
    "src/lib/candidate-orchestrator/types.ts",
    "src/lib/candidate-orchestrator/build-unified-candidates.ts",
    "src/lib/candidate-orchestrator/index.ts",
    "src/app/api/candidate-pool/snapshot/route.ts",
  ];

  it("orchestrator and snapshot endpoint issue no Binance HTTP directly", () => {
    for (const file of ORCHESTRATOR_FILES) {
      const src = read(file);
      expect(src).not.toMatch(/\bfetch\s*\(\s*["']https/);
      expect(src).not.toMatch(/axios/);
      expect(src).not.toMatch(/fapi\.binance\.com/);
      expect(src).not.toMatch(/fetchJson/);
    }
  });

  it("snapshot endpoint relies on cached helpers (universe + bulk tickers)", () => {
    const src = read("src/app/api/candidate-pool/snapshot/route.ts");
    expect(src).toMatch(/getMarketUniverse/);
    expect(src).toMatch(/getCachedAllTickers/);
  });

  it("worker entry does NOT import the orchestrator directly (only via bot-orchestrator + provider)", () => {
    // worker/index.ts itself must stay free of orchestrator imports — the
    // routing goes through bot-orchestrator → unified-candidate-provider.
    const workerOrchestratorRefs = grepRepo("worker", /candidate-orchestrator/);
    expect(workerOrchestratorRefs).toEqual([]);
  });

  it("Phase 6 — bot-orchestrator imports the provider, not the orchestrator directly, and the call is feature-flag gated", () => {
    const botOrchestrator = read("src/lib/engines/bot-orchestrator.ts");
    // The pure orchestrator must not be imported into the engine — only the
    // safe provider wrapper (which adds TTL cache + fail-safe fallback).
    expect(botOrchestrator).not.toMatch(/from\s+["']@\/lib\/candidate-orchestrator["']/);
    // The provider must be imported.
    expect(botOrchestrator).toMatch(/unified-candidate-provider/);
    // The provider call must be gated by env.useUnifiedCandidatePool.
    expect(botOrchestrator).toMatch(/env\.useUnifiedCandidatePool/);
  });

  it("signal-engine still rejects trades below 70", () => {
    const src = read("src/lib/engines/signal-engine.ts");
    expect(src).toMatch(/aggressiveMinScore\s*\?\?\s*70/);
  });

  it("env defaults still keep live trading off and paper as default mode", () => {
    const src = read("src/lib/env.ts");
    expect(src).toMatch(/hardLiveTradingAllowed:\s*bool\(process\.env\.HARD_LIVE_TRADING_ALLOWED,\s*false\)/);
    expect(src).toMatch(/defaultTradingMode:\s*str\(process\.env\.DEFAULT_TRADING_MODE,\s*"paper"\)/);
  });

  it("settings/update endpoint still does NOT accept enable_live_trading", () => {
    const src = read("src/app/api/settings/update/route.ts");
    expect(src).not.toMatch(/enable_live_trading/);
  });

  it("Binance API guardrails doc is still present", () => {
    const doc = read("docs/BINANCE_API_GUARDRAILS.md");
    expect(doc).toMatch(/Değişmez Ana Kural/);
    expect(doc).toMatch(/418/);
  });
});

// ---- helpers ----
function grepRepo(rootDir: string, pattern: RegExp): string[] {
  const root = path.join(REPO_ROOT, rootDir);
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  walk(root, (file) => {
    if (!/\.(ts|tsx|mjs|cjs|js)$/.test(file)) return;
    const src = fs.readFileSync(file, "utf8");
    if (pattern.test(src)) out.push(path.relative(REPO_ROOT, file));
  });
  return out;
}

function walk(dir: string, onFile: (file: string) => void) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      walk(full, onFile);
    } else {
      onFile(full);
    }
  }
}
