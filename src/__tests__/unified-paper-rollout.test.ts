// Phase 7 / Phase 14 — Unified Candidate Pool, mode-safe rollout tests.
//
// Verifies:
//  - canUseUnifiedCandidatePoolForMode() (Phase 14 — mode-safe helper) returns
//    the expected verdict for every combination of (trading_mode ×
//    enable_live_trading × env.hardLiveTradingAllowed).
//  - Provider exposes the lastError sidecar (set on failure, cleared on
//    successful refresh).
//  - Provider returns fromCache flag correctly across calls.
//  - Codebase invariants: env default true, mode-safe helper present and
//    referenced inside bot-orchestrator hot path, live-trading values
//    untouched, no scattered Binance fetch.

import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Ticker } from "@/lib/exchanges/types";
import type { MarketSymbolInfo } from "@/lib/market-universe/types";
import type { ScanModesConfig } from "@/lib/scan-modes/types";
import { canUseUnifiedCandidatePoolForMode } from "@/lib/engines/bot-orchestrator";
import {
  getUnifiedCandidates,
  getUnifiedProviderLastError,
  __resetUnifiedCandidateCacheForTests,
} from "@/lib/engines/unified-candidate-provider";
import { env } from "@/lib/env";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

function uSym(symbol: string, baseAsset: string): MarketSymbolInfo {
  return { symbol, baseAsset, quoteAsset: "USDT", contractType: "perpetual", status: "TRADING" };
}
function ticker(sym: string, over: Partial<Ticker> = {}): Ticker {
  return {
    symbol: sym,
    lastPrice: 100, bid: 100, ask: 100, spread: 0,
    volume24h: 0, quoteVolume24h: 100_000_000,
    high24h: 105, low24h: 95, changePercent24h: 3,
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
  uSym("AVAX/USDT", "AVAX"),
];
const TICKERS: Record<string, Ticker> = {
  "BTC/USDT": ticker("BTC/USDT", { quoteVolume24h: 800_000_000, changePercent24h: 6 }),
  "ETH/USDT": ticker("ETH/USDT", { quoteVolume24h: 500_000_000, changePercent24h: 4 }),
  "SOL/USDT": ticker("SOL/USDT", { quoteVolume24h: 250_000_000, changePercent24h: -7 }),
  "AVAX/USDT": ticker("AVAX/USDT", { quoteVolume24h: 80_000_000, changePercent24h: 3 }),
};

describe("canUseUnifiedCandidatePoolForMode — mode-safe gate (Phase 14)", () => {
  it("paper mode + live trading off → allowed (unified pool may run)", () => {
    expect(env.hardLiveTradingAllowed).toBe(false);
    const check = canUseUnifiedCandidatePoolForMode({
      trading_mode: "paper",
      enable_live_trading: false,
    });
    expect(check.allowed).toBe(true);
    expect(check.blockedReason).toBeNull();
    expect(check.tradeMode).toBe("paper");
    expect(check.executionMode).toBe("simulated");
  });

  it("trading_mode='live' + gate closed → blocked (live execution gate, not paper-lock)", () => {
    // HARD_LIVE_TRADING_ALLOWED=false in test env — gate cannot fully pass.
    const check = canUseUnifiedCandidatePoolForMode({
      trading_mode: "live",
      enable_live_trading: false,
    });
    expect(check.allowed).toBe(false);
    expect(check.blockedReason).toMatch(/live_execution_gate_blocked/);
    // Reason must NOT say "trading_mode=live" — that was the paper-lock anti-pattern.
    expect(check.blockedReason).not.toBe("trading_mode=live");
    expect(check.tradeMode).toBe("live");
    expect(check.executionMode).toBe("live_gate_closed");
  });

  it("trading_mode='live' + enable_live_trading=true but hard gate off → still blocked", () => {
    // env.hardLiveTradingAllowed is false — triple gate cannot pass.
    const check = canUseUnifiedCandidatePoolForMode({
      trading_mode: "live",
      enable_live_trading: true,
    });
    expect(check.allowed).toBe(false);
    expect(check.blockedReason).toMatch(/HARD_LIVE_TRADING_ALLOWED=false/);
    expect(check.executionMode).toBe("live_gate_closed");
  });

  it("missing/unknown values default to allowed (paper mode assumed)", () => {
    const check = canUseUnifiedCandidatePoolForMode({});
    expect(check.allowed).toBe(true);
    expect(check.executionMode).toBe("simulated");
  });

  it("candidate pool is NOT paper-locked: live mode result has tradeMode='live'", () => {
    const check = canUseUnifiedCandidatePoolForMode({ trading_mode: "live" });
    // Even when blocked, the tradeMode reflects the actual mode — not 'paper'.
    expect(check.tradeMode).toBe("live");
  });
});

describe("provider — lastError sidecar", () => {
  beforeEach(() => {
    __resetUnifiedCandidateCacheForTests();
  });

  it("getUnifiedProviderLastError starts null", () => {
    expect(getUnifiedProviderLastError()).toBeNull();
  });

  it("captures error message after a failure", async () => {
    const bundle = await getUnifiedCandidates({
      forceRefresh: true,
      override: {
        // @ts-expect-error — intentionally broken
        universe: { not: "an-array" },
        tickers: TICKERS,
        scanModes: modes({ wideMarket: { active: true } }),
      },
    });
    expect(bundle).toBeNull();
    expect(getUnifiedProviderLastError()).toBeTruthy();
    expect(typeof getUnifiedProviderLastError()).toBe("string");
  });

  it("clears lastError on a subsequent successful refresh", async () => {
    // First call fails
    await getUnifiedCandidates({
      forceRefresh: true,
      override: {
        // @ts-expect-error — broken on purpose
        universe: { not: "an-array" },
        tickers: TICKERS,
        scanModes: modes({ wideMarket: { active: true } }),
      },
    });
    expect(getUnifiedProviderLastError()).toBeTruthy();

    // Second call succeeds → sidecar must be wiped.
    const bundle = await getUnifiedCandidates({
      forceRefresh: true,
      override: {
        universe: UNIVERSE,
        tickers: TICKERS,
        scanModes: modes({ wideMarket: { active: true } }),
      },
    });
    expect(bundle).not.toBeNull();
    expect(getUnifiedProviderLastError()).toBeNull();
  });
});

describe("provider — fromCache flag", () => {
  beforeEach(() => {
    __resetUnifiedCandidateCacheForTests();
  });

  it("first call: fromCache=false; cached call: fromCache=true; force refresh: fromCache=false", async () => {
    const a = await getUnifiedCandidates({
      refreshIntervalMs: 60_000,
      override: { universe: UNIVERSE, tickers: TICKERS, scanModes: modes({ wideMarket: { active: true } }) },
    });
    expect(a!.fromCache).toBe(false);

    const b = await getUnifiedCandidates({
      refreshIntervalMs: 60_000,
      override: { universe: UNIVERSE, tickers: TICKERS, scanModes: modes({ wideMarket: { active: true } }) },
    });
    expect(b!.fromCache).toBe(true);

    const c = await getUnifiedCandidates({
      forceRefresh: true,
      override: { universe: UNIVERSE, tickers: TICKERS, scanModes: modes({ wideMarket: { active: true } }) },
    });
    expect(c!.fromCache).toBe(false);
  });
});

describe("Phase 7 / Phase 14 invariants — codebase", () => {
  it("env default for USE_UNIFIED_CANDIDATE_POOL is true", () => {
    const src = read("src/lib/env.ts");
    expect(src).toMatch(/useUnifiedCandidatePool:\s*bool\(process\.env\.USE_UNIFIED_CANDIDATE_POOL,\s*true\)/);
  });

  it("canUseUnifiedCandidatePoolForMode is exported from bot-orchestrator (Phase 14 name)", () => {
    const src = read("src/lib/engines/bot-orchestrator.ts");
    expect(src).toMatch(/export function canUseUnifiedCandidatePoolForMode/);
    // Deprecated alias must also still be exported for backwards compat.
    expect(src).toMatch(/export function isUnifiedPoolPaperSafe/);
  });

  it("internal tickBot usage uses poolModeCheck (mode-safe, not paper-safe)", () => {
    const src = read("src/lib/engines/bot-orchestrator.ts");
    expect(src).toMatch(/env\.useUnifiedCandidatePool\s*&&\s*poolModeCheck\.allowed/);
    // Must NOT reference old paper-safety variable in hot path.
    expect(src).not.toMatch(/paperSafety\.safe/);
  });

  it("live gate references env.hardLiveTradingAllowed and enable_live_trading", () => {
    const src = read("src/lib/engines/bot-orchestrator.ts");
    expect(src).toMatch(/hardLiveTradingAllowed/);
    expect(src).toMatch(/enable_live_trading\s*===\s*true/);
  });

  it("last_tick_summary surfaces Phase 7 fields", () => {
    const src = read("src/lib/engines/bot-orchestrator.ts");
    expect(src).toMatch(/unifiedPoolFromCache:/);
    expect(src).toMatch(/unifiedProviderError:/);
    expect(src).toMatch(/analyzedSymbolsCount:/);
    expect(src).toMatch(/coreSymbolsCount:/);
    expect(src).toMatch(/unifiedSymbolsCount:/);
  });

  it("last_tick_summary surfaces Phase 14 mode-safe fields", () => {
    const src = read("src/lib/engines/bot-orchestrator.ts");
    expect(src).toMatch(/unifiedCandidatePoolModeAllowed:/);
    expect(src).toMatch(/unifiedCandidatePoolBlockedReason:/);
    expect(src).toMatch(/tradeMode:/);
    expect(src).toMatch(/executionMode:/);
  });

  it("worker .env.example documents USE_UNIFIED_CANDIDATE_POOL=true", () => {
    const src = read("worker/.env.example");
    expect(src).toMatch(/USE_UNIFIED_CANDIDATE_POOL=true/);
  });

  it("live trading defaults still locked off (HARD_LIVE_TRADING_ALLOWED=false)", () => {
    const env_src = read("src/lib/env.ts");
    expect(env_src).toMatch(/hardLiveTradingAllowed:\s*bool\(process\.env\.HARD_LIVE_TRADING_ALLOWED,\s*false\)/);
    expect(env_src).toMatch(/defaultTradingMode:\s*str\(process\.env\.DEFAULT_TRADING_MODE,\s*"paper"\)/);
    // Settings update endpoint must still NOT accept enable_live_trading.
    const route = read("src/app/api/settings/update/route.ts");
    expect(route).not.toMatch(/enable_live_trading/);
  });

  it("signal-engine default score gate is 70 (aggressive paper mode HARD-DISABLED, May 2026)", () => {
    const src = read("src/lib/engines/signal-engine.ts");
    // Default threshold must remain 70 when no aggressiveMinScore is provided.
    expect(src).toMatch(/aggressiveMinScore\s*\?\?\s*70/);
    // Gate must use the resolved minScore variable.
    expect(src).toMatch(/if\s*\(\s*score\s*<\s*minScore\s*\)/);
    // Aggressive mode is hard-disabled — bypass channel cannot reopen via env.
    const aggHelper = read("src/lib/aggressive-paper-mode.ts");
    expect(aggHelper).toMatch(/HARD-DISABLED/);
    expect(aggHelper).toMatch(/active:\s*false/);
  });

  it("worker entry still does not import the orchestrator directly", () => {
    const src = read("worker/index.ts");
    expect(src).not.toMatch(/candidate-orchestrator/);
  });

  it("unified-candidate-provider does not add scattered Binance HTTP calls", () => {
    const src = read("src/lib/engines/unified-candidate-provider.ts");
    expect(src).not.toMatch(/\bfetch\s*\(\s*["']https/);
    expect(src).not.toMatch(/\baxios\b/);
    expect(src).not.toMatch(/fapi\.binance\.com/);
    expect(src).not.toMatch(/fetchJson/);
  });

  it("Binance API guardrails doc still present", () => {
    const doc = read("docs/BINANCE_API_GUARDRAILS.md");
    expect(doc).toMatch(/Değişmez Ana Kural/);
    expect(doc).toMatch(/418/);
  });
});
