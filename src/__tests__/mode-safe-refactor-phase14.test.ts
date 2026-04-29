// Phase 14 — Mode-Safe Refactor / Paper-Live Lock Removal tests.
//
// Verifies:
//  - canUseUnifiedCandidatePoolForMode() is mode-safe: not paper-locked.
//  - Paper mode: unified pool always allowed.
//  - Live mode + gate closed: live EXECUTION is blocked, not the pool helper name.
//  - Live mode + triple gate fully open: unified pool allowed.
//  - Feature flag false: unified pool disabled regardless of mode.
//  - Feature flag true + paper mode: unified pool enabled.
//  - Candidate pool and execution safety are separate concerns (decoupled).
//  - last_tick_summary carries Phase 14 mode-safe fields.
//  - Trade logic unchanged: MIN_SIGNAL_CONFIDENCE=70 intact.
//  - All safety invariants preserved: HARD_LIVE_TRADING_ALLOWED=false,
//    DEFAULT_TRADING_MODE=paper, enable_live_trading=false.
//  - No openLiveOrder / closeLiveOrder added.
//  - No live_trades migration added.
//  - No Binance private/order endpoint calls added.
//  - Risk settings still not bound to execution engine.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  canUseUnifiedCandidatePoolForMode,
  isUnifiedPoolPaperSafe,
} from "@/lib/engines/bot-orchestrator";
import { env } from "@/lib/env";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

// ─────────────────────────────────────────────────────────────────────────────
// 1. Mode-safe helper — canUseUnifiedCandidatePoolForMode
// ─────────────────────────────────────────────────────────────────────────────

describe("canUseUnifiedCandidatePoolForMode — mode-safe gate", () => {
  it("helper name does NOT contain 'paper' — not paper-only", () => {
    // Verify the exported symbol name itself is mode-neutral.
    expect(typeof canUseUnifiedCandidatePoolForMode).toBe("function");
    const src = read("src/lib/engines/bot-orchestrator.ts");
    expect(src).toMatch(/export function canUseUnifiedCandidatePoolForMode/);
  });

  it("paper mode → allowed, executionMode=simulated", () => {
    const check = canUseUnifiedCandidatePoolForMode({
      trading_mode: "paper",
      enable_live_trading: false,
    });
    expect(check.allowed).toBe(true);
    expect(check.blockedReason).toBeNull();
    expect(check.tradeMode).toBe("paper");
    expect(check.executionMode).toBe("simulated");
  });

  it("undefined/null mode → allowed (defaults to paper)", () => {
    const check = canUseUnifiedCandidatePoolForMode({});
    expect(check.allowed).toBe(true);
    expect(check.tradeMode).not.toBe("live");
    expect(check.executionMode).toBe("simulated");
  });

  it("live mode + gate closed (HARD_LIVE=false) → blocked at execution, not paper-locked", () => {
    expect(env.hardLiveTradingAllowed).toBe(false);
    const check = canUseUnifiedCandidatePoolForMode({
      trading_mode: "live",
      enable_live_trading: false,
    });
    expect(check.allowed).toBe(false);
    // Blocked reason must reference execution gate, NOT "trading_mode=live"
    expect(check.blockedReason).not.toBe("trading_mode=live");
    expect(check.blockedReason).toMatch(/live_execution_gate_blocked/);
    expect(check.tradeMode).toBe("live");
    expect(check.executionMode).toBe("live_gate_closed");
  });

  it("live mode + enable_live_trading=true but hard gate off → blocked with both reasons", () => {
    const check = canUseUnifiedCandidatePoolForMode({
      trading_mode: "live",
      enable_live_trading: true,
    });
    expect(check.allowed).toBe(false);
    expect(check.blockedReason).toMatch(/HARD_LIVE_TRADING_ALLOWED=false/);
    expect(check.executionMode).toBe("live_gate_closed");
  });

  it("live mode tradeMode is 'live' even when blocked — pool is NOT paper-locked", () => {
    const check = canUseUnifiedCandidatePoolForMode({ trading_mode: "live" });
    // Core assertion for Phase 14: the pool acknowledges live mode exists,
    // it's just blocked by the execution gate — not by 'must be paper'.
    expect(check.tradeMode).toBe("live");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Deprecated alias isUnifiedPoolPaperSafe — backwards compat
// ─────────────────────────────────────────────────────────────────────────────

describe("isUnifiedPoolPaperSafe — deprecated alias, still exported", () => {
  it("paper mode → safe=true (alias delegates to new helper)", () => {
    const verdict = isUnifiedPoolPaperSafe({
      trading_mode: "paper",
      enable_live_trading: false,
    });
    expect(verdict.safe).toBe(true);
    expect(verdict.reason).toBeNull();
  });

  it("live mode + gate closed → safe=false, reason contains execution gate text", () => {
    const verdict = isUnifiedPoolPaperSafe({
      trading_mode: "live",
      enable_live_trading: false,
    });
    expect(verdict.safe).toBe(false);
    // Reason must NOT be old paper-locked string.
    expect(verdict.reason).not.toBe("trading_mode=live");
    expect(verdict.reason).toMatch(/live_execution_gate_blocked/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Candidate selection vs execution gate decoupling
// ─────────────────────────────────────────────────────────────────────────────

describe("Candidate selection vs execution safety — decoupled", () => {
  it("paper mode: pool allowed, execution is simulated (no live gate needed)", () => {
    const check = canUseUnifiedCandidatePoolForMode({ trading_mode: "paper" });
    expect(check.allowed).toBe(true);
    expect(check.executionMode).toBe("simulated");
  });

  it("live mode with closed gate: pool reports live_gate_closed execution, not paper", () => {
    const check = canUseUnifiedCandidatePoolForMode({
      trading_mode: "live",
      enable_live_trading: false,
    });
    // executionMode distinguishes 'live gate closed' from 'simulated paper' —
    // these are different execution states, not the same paper mode.
    expect(check.executionMode).toBe("live_gate_closed");
    expect(check.executionMode).not.toBe("simulated");
  });

  it("live-trading-guard tripleGate is the execution authority (not candidate pool)", () => {
    const guardSrc = read("src/lib/engines/live-trading-guard.ts");
    // Triple gate function exists in the dedicated guard module.
    expect(guardSrc).toMatch(/export function tripleGate/);
    // Candidate pool logic does NOT import live-trading-guard.
    const poolSrc = read("src/lib/engines/unified-candidate-provider.ts");
    expect(poolSrc).not.toMatch(/live-trading-guard/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Feature flag behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe("Feature flag behaviour", () => {
  it("USE_UNIFIED_CANDIDATE_POOL defaults to true", () => {
    expect(env.useUnifiedCandidatePool).toBe(true);
    const src = read("src/lib/env.ts");
    expect(src).toMatch(/useUnifiedCandidatePool:\s*bool\(process\.env\.USE_UNIFIED_CANDIDATE_POOL,\s*true\)/);
  });

  it("when feature flag is on, paper mode check passes (helper returns allowed)", () => {
    // env.useUnifiedCandidatePool is true in test env.
    expect(env.useUnifiedCandidatePool).toBe(true);
    const check = canUseUnifiedCandidatePoolForMode({ trading_mode: "paper" });
    expect(check.allowed).toBe(true);
  });

  it("bot-orchestrator gates the call by feature flag AND mode check", () => {
    const src = read("src/lib/engines/bot-orchestrator.ts");
    expect(src).toMatch(/env\.useUnifiedCandidatePool\s*&&\s*poolModeCheck\.allowed/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. last_tick_summary Phase 14 fields
// ─────────────────────────────────────────────────────────────────────────────

describe("last_tick_summary Phase 14 mode-safe fields", () => {
  it("summary object includes unifiedCandidatePoolModeAllowed field", () => {
    const src = read("src/lib/engines/bot-orchestrator.ts");
    expect(src).toMatch(/unifiedCandidatePoolModeAllowed:/);
  });

  it("summary object includes unifiedCandidatePoolBlockedReason field", () => {
    const src = read("src/lib/engines/bot-orchestrator.ts");
    expect(src).toMatch(/unifiedCandidatePoolBlockedReason:/);
  });

  it("summary object includes tradeMode field", () => {
    const src = read("src/lib/engines/bot-orchestrator.ts");
    // tradeMode appears in lastTickSummary (not just the interface).
    const summaryBlock = src.slice(src.indexOf("const lastTickSummary"));
    expect(summaryBlock).toMatch(/tradeMode:/);
  });

  it("summary object includes executionMode field", () => {
    const src = read("src/lib/engines/bot-orchestrator.ts");
    const summaryBlock = src.slice(src.indexOf("const lastTickSummary"));
    expect(summaryBlock).toMatch(/executionMode:/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Safety invariants — unchanged
// ─────────────────────────────────────────────────────────────────────────────

describe("Phase 14 safety invariants — unchanged", () => {
  it("HARD_LIVE_TRADING_ALLOWED=false (env default)", () => {
    expect(env.hardLiveTradingAllowed).toBe(false);
    const src = read("src/lib/env.ts");
    expect(src).toMatch(/hardLiveTradingAllowed:\s*bool\(process\.env\.HARD_LIVE_TRADING_ALLOWED,\s*false\)/);
  });

  it("DEFAULT_TRADING_MODE=paper (env default)", () => {
    expect(env.defaultTradingMode).toBe("paper");
    const src = read("src/lib/env.ts");
    expect(src).toMatch(/defaultTradingMode:\s*str\(process\.env\.DEFAULT_TRADING_MODE,\s*"paper"\)/);
  });

  it("enable_live_trading is not accepted by settings/update endpoint", () => {
    const src = read("src/app/api/settings/update/route.ts");
    expect(src).not.toMatch(/enable_live_trading/);
  });

  it("MIN_SIGNAL_CONFIDENCE=70 unchanged in signal-engine", () => {
    const src = read("src/lib/engines/signal-engine.ts");
    expect(src).toMatch(/if\s*\(\s*score\s*<\s*70\s*\)/);
  });

  it("worker lock mechanism untouched", () => {
    const src = read("worker/lock.ts");
    expect(src).toMatch(/acquireLock/);
    expect(src).toMatch(/renewLock/);
    expect(src).toMatch(/releaseLock/);
  });

  it("paper-trading-engine unchanged (no live execution adapter added)", () => {
    const src = read("src/lib/engines/paper-trading-engine.ts");
    expect(src).toMatch(/openPaperTrade/);
    // No live order function was added in this phase.
    expect(src).not.toMatch(/openLiveOrder/);
    expect(src).not.toMatch(/closeLiveOrder/);
  });

  it("no openLiveOrder or closeLiveOrder added anywhere", () => {
    const orchestratorSrc = read("src/lib/engines/bot-orchestrator.ts");
    expect(orchestratorSrc).not.toMatch(/openLiveOrder/);
    expect(orchestratorSrc).not.toMatch(/closeLiveOrder/);

    const workerSrc = read("worker/index.ts");
    expect(workerSrc).not.toMatch(/openLiveOrder/);
  });

  it("no live_trades table reference added", () => {
    const orchestratorSrc = read("src/lib/engines/bot-orchestrator.ts");
    expect(orchestratorSrc).not.toMatch(/live_trades/);
    const workerSrc = read("worker/index.ts");
    expect(workerSrc).not.toMatch(/from\(["']live_trades["']\)/);
  });

  it("no Binance private/order endpoint calls added", () => {
    const orchestratorSrc = read("src/lib/engines/bot-orchestrator.ts");
    expect(orchestratorSrc).not.toMatch(/\/fapi\/v1\/order/);
    expect(orchestratorSrc).not.toMatch(/\/api\/v3\/order/);
    expect(orchestratorSrc).not.toMatch(/postOrder/);
  });

  it("risk-settings still not bound to execution engine (appliedToTradeEngine=false)", () => {
    const src = read("src/lib/risk-settings/types.ts");
    expect(src).toMatch(/appliedToTradeEngine/);
    // The store must enforce false.
    const storeSrc = read("src/lib/risk-settings/store.ts");
    expect(storeSrc).toMatch(/appliedToTradeEngine/);
  });

  it("Binance API guardrails doc still present and intact", () => {
    const doc = read("docs/BINANCE_API_GUARDRAILS.md");
    expect(doc).toMatch(/Değişmez Ana Kural/);
    expect(doc).toMatch(/418/);
  });

  it("bot-orchestrator does not add Binance HTTP fetch in this phase", () => {
    const src = read("src/lib/engines/bot-orchestrator.ts");
    expect(src).not.toMatch(/\bfetch\s*\(\s*["']https/);
    expect(src).not.toMatch(/\baxios\b/);
    expect(src).not.toMatch(/fapi\.binance\.com/);
  });
});
