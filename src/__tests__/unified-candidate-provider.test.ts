// Phase 6 — Worker'a Güvenli Entegrasyon tests.
//
// Verifies:
//  - Feature flag default (env.useUnifiedCandidatePool === false).
//  - Provider returns null when underlying calls throw (fail-safe).
//  - Provider TTL cache: second call within window does not re-run orchestrator.
//  - Provider builds metadata-bearing bundle (sourceDisplay GMT/MT/MİL/KRM,
//    candidateSources, candidateRank, marketQualityPreScore).
//  - poolMax (50) and deepMax (30) caps preserved.
//  - bot-orchestrator integration: provider import, feature-flag gate, no
//    direct orchestrator import.
//  - Codebase hygiene: no per-tick Binance fetch added in worker entry,
//    bot-orchestrator, or the provider (only cached helpers).
//  - Global invariants unchanged: signal threshold 70, env safety defaults,
//    settings/update endpoint guard, BINANCE_API_GUARDRAILS doc still present.

import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Ticker } from "@/lib/exchanges/types";
import type { MarketSymbolInfo } from "@/lib/market-universe/types";
import type { ScanModesConfig } from "@/lib/scan-modes/types";
import {
  getUnifiedCandidates,
  __resetUnifiedCandidateCacheForTests,
  getUnifiedCandidatesFetchedAt,
} from "@/lib/engines/unified-candidate-provider";
import { env } from "@/lib/env";

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

const UNIVERSE: MarketSymbolInfo[] = [
  uSym("BTC/USDT", "BTC"),
  uSym("ETH/USDT", "ETH"),
  uSym("SOL/USDT", "SOL"),
  uSym("DOGE/USDT", "DOGE"),
  uSym("AVAX/USDT", "AVAX"),
  uSym("XRP/USDT", "XRP"),
  uSym("LINK/USDT", "LINK"),
];

const TICKERS: Record<string, Ticker> = {
  "BTC/USDT": ticker("BTC/USDT", { quoteVolume24h: 800_000_000, changePercent24h: 6 }),
  "ETH/USDT": ticker("ETH/USDT", { quoteVolume24h: 500_000_000, changePercent24h: 4 }),
  "SOL/USDT": ticker("SOL/USDT", { quoteVolume24h: 250_000_000, changePercent24h: -7 }),
  "DOGE/USDT": ticker("DOGE/USDT", { quoteVolume24h: 150_000_000, changePercent24h: 9 }),
  "AVAX/USDT": ticker("AVAX/USDT", { quoteVolume24h: 80_000_000, changePercent24h: 3 }),
  "XRP/USDT": ticker("XRP/USDT", { quoteVolume24h: 120_000_000, changePercent24h: -5 }),
  "LINK/USDT": ticker("LINK/USDT", { quoteVolume24h: 60_000_000, changePercent24h: -3 }),
};

function modes(over: Partial<ScanModesConfig> = {}): ScanModesConfig {
  return {
    wideMarket: { active: false, ...over.wideMarket },
    momentum: { active: false, direction: "both", ...over.momentum },
    manualList: { active: false, symbols: [], ...over.manualList },
  };
}

describe("Phase 7 — feature flag default + paper-mode rollout", () => {
  it("USE_UNIFIED_CANDIDATE_POOL defaults to true (paper-mode rollout)", () => {
    expect(env.useUnifiedCandidatePool).toBe(true);
  });

  it("env exposes the unified worker config knobs", () => {
    expect(typeof env.unifiedDeepAnalysisMax).toBe("number");
    expect(env.unifiedDeepAnalysisMax).toBeGreaterThan(0);
    expect(typeof env.unifiedCandidateRefreshIntervalSec).toBe("number");
    expect(env.unifiedCandidateRefreshIntervalSec).toBeGreaterThan(0);
  });

  it("hard live trading is still gated off (env default unchanged)", () => {
    expect(env.hardLiveTradingAllowed).toBe(false);
    expect(env.defaultTradingMode).toBe("paper");
  });
});

describe("getUnifiedCandidates — bundle assembly", () => {
  beforeEach(() => {
    __resetUnifiedCandidateCacheForTests();
  });

  it("returns deep candidates with metadata when sources are active", async () => {
    const bundle = await getUnifiedCandidates({
      override: {
        universe: UNIVERSE,
        tickers: TICKERS,
        scanModes: modes({
          wideMarket: { active: true },
          momentum: { active: true, direction: "both" },
          manualList: { active: true, symbols: ["AVAX/USDT"] },
        }),
      },
    });
    expect(bundle).not.toBeNull();
    expect(bundle!.deepCandidates.length).toBeGreaterThan(0);
    expect(bundle!.deepCandidates.length).toBeLessThanOrEqual(30);
    expect(bundle!.poolSize).toBeLessThanOrEqual(50);
    // Every deep candidate has metadata.
    for (const c of bundle!.deepCandidates) {
      const meta = bundle!.metadataBySymbol[c.symbol];
      expect(meta).toBeTruthy();
      expect(meta.candidateRank).toBe(c.rank);
      expect(meta.marketQualityPreScore).toBe(c.candidate.marketQualityPreScore);
      expect(meta.candidateSources.length).toBeGreaterThan(0);
      // sourceDisplay must be one of GMT/MT/MİL/KRM (or null in degenerate cases).
      if (meta.sourceDisplay !== null) {
        expect(["GMT", "MT", "MİL", "KRM"]).toContain(meta.sourceDisplay);
      }
    }
  });

  it("KRM displayed when ≥2 sources hit the same symbol", async () => {
    const bundle = await getUnifiedCandidates({
      override: {
        universe: UNIVERSE,
        tickers: TICKERS,
        scanModes: modes({
          wideMarket: { active: true },
          momentum: { active: true, direction: "both" },
          manualList: { active: true, symbols: ["BTC/USDT"] },
        }),
      },
    });
    const btc = bundle!.metadataBySymbol["BTC/USDT"];
    expect(btc).toBeTruthy();
    expect(btc.candidateSources.length).toBeGreaterThanOrEqual(2);
    expect(btc.sourceDisplay).toBe("KRM");
  });

  it("MİL displayed when only the manual list hits a symbol", async () => {
    const universe: MarketSymbolInfo[] = [uSym("XYZ/USDT", "XYZ")];
    const tickers: Record<string, Ticker> = {
      "XYZ/USDT": ticker("XYZ/USDT", { quoteVolume24h: 0.5e6, changePercent24h: 0.1 }),
    };
    const bundle = await getUnifiedCandidates({
      override: {
        universe,
        tickers,
        scanModes: modes({
          wideMarket: { active: true },
          momentum: { active: true, direction: "both" },
          manualList: { active: true, symbols: ["XYZ/USDT"] },
        }),
      },
    });
    const meta = bundle!.metadataBySymbol["XYZ/USDT"];
    expect(meta.sourceDisplay).toBe("MİL");
    expect(meta.candidateSources).toEqual(["MANUAL_LIST"]);
  });

  it("respects deepMax cap and never exceeds 30 (orchestrator default)", async () => {
    // Big synthetic universe to force the cap.
    const universe: MarketSymbolInfo[] = [];
    const tickers: Record<string, Ticker> = {};
    for (let i = 0; i < 80; i++) {
      const sym = `Z${i}/USDT`;
      universe.push(uSym(sym, `Z${i}`));
      tickers[sym] = ticker(sym, {
        quoteVolume24h: 50_000_000 + i,
        changePercent24h: (i % 2 === 0 ? 1 : -1) * (3 + (i % 5)),
      });
    }
    const bundle = await getUnifiedCandidates({
      deepMax: 100, // ask for more than the hard cap
      override: {
        universe,
        tickers,
        scanModes: modes({ wideMarket: { active: true } }),
      },
    });
    expect(bundle).not.toBeNull();
    // 30 is the hard ceiling regardless of caller request.
    expect(bundle!.deepCandidates.length).toBeLessThanOrEqual(30);
  });
});

describe("getUnifiedCandidates — TTL cache + fallback", () => {
  beforeEach(() => {
    __resetUnifiedCandidateCacheForTests();
  });

  it("caches snapshot within TTL — second call returns fromCache=true", async () => {
    const first = await getUnifiedCandidates({
      refreshIntervalMs: 60_000,
      override: {
        universe: UNIVERSE,
        tickers: TICKERS,
        scanModes: modes({ wideMarket: { active: true } }),
      },
    });
    expect(first).not.toBeNull();
    expect(first!.fromCache).toBe(false);
    const t1 = first!.generatedAt;

    const second = await getUnifiedCandidates({
      refreshIntervalMs: 60_000,
      override: {
        universe: UNIVERSE,
        tickers: TICKERS,
        scanModes: modes({ wideMarket: { active: true } }),
      },
    });
    expect(second).not.toBeNull();
    expect(second!.fromCache).toBe(true);
    expect(second!.generatedAt).toBe(t1);
    expect(getUnifiedCandidatesFetchedAt()).toBeGreaterThan(0);
  });

  it("forceRefresh bypasses cache", async () => {
    await getUnifiedCandidates({
      override: {
        universe: UNIVERSE,
        tickers: TICKERS,
        scanModes: modes({ wideMarket: { active: true } }),
      },
    });
    const fresh = await getUnifiedCandidates({
      forceRefresh: true,
      override: {
        universe: UNIVERSE,
        tickers: TICKERS,
        scanModes: modes({ wideMarket: { active: true } }),
      },
    });
    expect(fresh!.fromCache).toBe(false);
  });

  it("returns null on internal failure (fail-safe — never throws)", async () => {
    // Intentionally pass a malformed universe (object instead of array) to
    // make the orchestrator throw. The provider must swallow and return null.
    const bundle = await getUnifiedCandidates({
      forceRefresh: true,
      override: {
        // @ts-expect-error — intentionally broken to trigger the fallback path
        universe: { not: "an-array" },
        tickers: TICKERS,
        scanModes: modes({ wideMarket: { active: true } }),
      },
    });
    expect(bundle).toBeNull();
  });

  it("empty active sources → empty deep list, but bundle is still non-null", async () => {
    const bundle = await getUnifiedCandidates({
      forceRefresh: true,
      override: {
        universe: UNIVERSE,
        tickers: TICKERS,
        scanModes: modes(), // all sources inactive
      },
    });
    expect(bundle).not.toBeNull();
    expect(bundle!.deepCandidates.length).toBe(0);
    expect(Object.keys(bundle!.metadataBySymbol).length).toBe(0);
  });
});

describe("Phase 6 invariants — codebase hygiene + global guarantees", () => {
  it("provider never issues Binance HTTP directly (cached helpers only)", () => {
    const src = read("src/lib/engines/unified-candidate-provider.ts");
    expect(src).not.toMatch(/\bfetch\s*\(\s*["']https/);
    expect(src).not.toMatch(/\baxios\b/);
    expect(src).not.toMatch(/fapi\.binance\.com/);
    expect(src).not.toMatch(/fetchJson/);
    expect(src).toMatch(/getMarketUniverse/);
    expect(src).toMatch(/getCachedAllTickers/);
  });

  it("bot-orchestrator imports the provider and gates the call by feature flag", () => {
    const src = read("src/lib/engines/bot-orchestrator.ts");
    expect(src).toMatch(/unified-candidate-provider/);
    expect(src).toMatch(/env\.useUnifiedCandidatePool/);
    // No direct import of the pure orchestrator into the engine.
    expect(src).not.toMatch(/from\s+["']@\/lib\/candidate-orchestrator["']/);
  });

  it("bot-orchestrator does not add per-tick Binance fetch / axios / fapi", () => {
    const src = read("src/lib/engines/bot-orchestrator.ts");
    expect(src).not.toMatch(/\bfetch\s*\(\s*["']https/);
    expect(src).not.toMatch(/\baxios\b/);
    expect(src).not.toMatch(/fapi\.binance\.com/);
  });

  it("worker entry still does not import the orchestrator", () => {
    const src = read("worker/index.ts");
    expect(src).not.toMatch(/candidate-orchestrator/);
  });

  it("env exposes USE_UNIFIED_CANDIDATE_POOL with default true (Phase 7 paper-mode rollout)", () => {
    const src = read("src/lib/env.ts");
    expect(src).toMatch(/useUnifiedCandidatePool:\s*bool\(process\.env\.USE_UNIFIED_CANDIDATE_POOL,\s*true\)/);
  });

  it("signal-engine default score gate is 70 (aggressive paper mode may lower it)", () => {
    const src = read("src/lib/engines/signal-engine.ts");
    // Default threshold stays 70 when aggressiveMinScore is not provided.
    expect(src).toMatch(/aggressiveMinScore\s*\?\?\s*70/);
    expect(src).toMatch(/if\s*\(\s*score\s*<\s*minScore\s*\)/);
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

  it("worker lock helpers untouched (acquire/renew/release present)", () => {
    const src = read("worker/lock.ts");
    expect(src).toMatch(/acquireLock/);
    expect(src).toMatch(/renewLock/);
    expect(src).toMatch(/releaseLock/);
  });
});
