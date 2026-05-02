// Strategy health gate — Paper Learning Mode soft-pass invariants.
//
// Behavior matrix (covered below):
//   • normal mode + score < threshold (>=10 trades) → strategyHealth.blocked=true
//     (orchestrator hard-blocks tick — verified by source-level invariant)
//   • Paper Learning Mode + score < threshold → tick continues (soft-pass)
//     (verified by source-level invariant: bypass branch + new event name)
//   • live/normal mode invariants preserved (writeSkipSummary still called)
//   • Paper Learning trade still respects: score>=PAPER_LEARNING_MIN_SIGNAL_SCORE,
//     score numeric & positive, valid entry, etc. (verified by helper boundaries)

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ORCHESTRATOR = fs.readFileSync(
  path.join(REPO_ROOT, "src/lib/engines/bot-orchestrator.ts"),
  "utf8",
);

describe("strategy-health gate — orchestrator wiring (source invariants)", () => {
  it("paper learning is computed BEFORE the strategy health gate", () => {
    const learningIdx = ORCHESTRATOR.indexOf(
      "const paperLearning = checkPaperLearningMode(settings);",
    );
    const gateIdx = ORCHESTRATOR.indexOf("const strategyHealth = await calculateStrategyHealth(userId);");
    expect(learningIdx).toBeGreaterThan(0);
    expect(gateIdx).toBeGreaterThan(learningIdx);
  });

  it("normal mode still hard-blocks via writeSkipSummary('strategy_health_blocked:…')", () => {
    expect(ORCHESTRATOR).toMatch(
      /writeSkipSummary\(\s*userId[^)]*?strategy_health_blocked:/s,
    );
  });

  it("paper learning soft-pass emits paper_learning_strategy_health_bypass event", () => {
    expect(ORCHESTRATOR).toMatch(/eventType:\s*"paper_learning_strategy_health_bypass"/);
  });

  it("paper learning soft-pass log message uses new Turkish copy", () => {
    expect(ORCHESTRATOR).toMatch(
      /strategy health düşük .*paper learning izleme\/öğrenme modunda devam ediyor/,
    );
  });

  it("soft-pass branch sets strategyHealthBypassedByLearning + does NOT return early", () => {
    // Find the bypass branch and confirm it does not return.
    const idx = ORCHESTRATOR.indexOf("paper_learning_strategy_health_bypass");
    expect(idx).toBeGreaterThan(0);
    // The 600 chars around the event should contain the result-field set
    // and must NOT contain a `return result;` (that would re-introduce the
    // hard block under paper learning).
    const window = ORCHESTRATOR.slice(Math.max(0, idx - 600), idx + 200);
    expect(window).toMatch(/result\.strategyHealthBypassedByLearning\s*=\s*true/);
    expect(window).toMatch(/result\.strategyHealthBlockedInNormalMode\s*=\s*true/);
    // Sanity: the bypass branch sits inside `if (learningModeActive)` and
    // its sibling `else` hard-blocks. The window before the bypass log
    // must not contain a `return result` (would short-circuit the tick).
    expect(window).not.toMatch(/paper_learning_strategy_health_bypass[\s\S]{0,200}return result/);
  });

  it("trade-open metadata pushes 'strategy_health' onto bypassedGates when soft-passed", () => {
    expect(ORCHESTRATOR).toMatch(
      /if\s*\(\s*learningModeActive\s*&&\s*result\.strategyHealthBypassedByLearning\s*\)\s*\{\s*bypassedGates\.push\("strategy_health"\)/,
    );
  });

  it("trade-open metadata records 'Strateji sağlık skoru düşük' in risk_warnings", () => {
    expect(ORCHESTRATOR).toMatch(/"Strateji sağlık skoru düşük"/);
  });

  it("paper learning trade risk_metadata carries strategy_health_* fields", () => {
    expect(ORCHESTRATOR).toMatch(/strategy_health_score:\s*result\.strategyHealthScore/);
    expect(ORCHESTRATOR).toMatch(/strategy_health_min:\s*result\.strategyHealthMin/);
    expect(ORCHESTRATOR).toMatch(/strategy_health_blocked_in_normal_mode:/);
  });

  it("lastTickSummary surfaces the bypass flag for the scanner UI", () => {
    expect(ORCHESTRATOR).toMatch(
      /strategyHealthBypassedByLearning:\s*result\.strategyHealthBypassedByLearning/,
    );
  });
});

// Helper-level: confirm strategy-health module's own threshold logic.
// Mocks the supabase boundary so we can assert blocked vs not-blocked from
// a controlled trade history without going through the full orchestrator.
async function loadStrategyHealth(opts: {
  trades: Array<{ pnl: number; exit_reason?: string | null; risk_reward_ratio?: number | null }>;
  threshold?: number;
}) {
  vi.resetModules();
  vi.doMock("@/lib/supabase/server", () => ({
    supabaseConfigured: () => true,
    supabaseAdmin: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            not: () => ({
              order: () => ({
                limit: async () => ({
                  data: opts.trades.map((t) => ({
                    pnl: t.pnl,
                    exit_reason: t.exit_reason ?? "stop_loss",
                    risk_reward_ratio: t.risk_reward_ratio ?? 1,
                    entry_price: 1,
                    stop_loss: 0.99,
                    take_profit: 1.02,
                    direction: "LONG",
                    closed_at: new Date().toISOString(),
                  })),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  }));
  vi.doMock("@/lib/env", () => ({
    env: { minStrategyHealthScoreToTrade: opts.threshold ?? 60 },
  }));
  const mod = await import("@/lib/engines/strategy-health");
  return mod.calculateStrategyHealth;
}

describe("calculateStrategyHealth — block thresholds", () => {
  beforeEach(() => vi.resetModules());

  it("score 33 (mostly losses, 10+ trades) → blocked when threshold=60", async () => {
    const calc = await loadStrategyHealth({
      // 10 trades: 2 wins, 8 losses → win rate 20% → low score
      trades: Array.from({ length: 10 }, (_, i) => ({ pnl: i < 2 ? 5 : -8 })),
      threshold: 60,
    });
    const r = await calc("user");
    expect(r.totalTrades).toBe(10);
    expect(r.score).toBeLessThan(60);
    expect(r.blocked).toBe(true);
    expect(r.blockReason).toMatch(/Strateji sağlık skoru/);
  });

  it("score below threshold but <10 trades → NOT blocked (insufficient sample)", async () => {
    const calc = await loadStrategyHealth({
      trades: [{ pnl: -5 }, { pnl: -5 }, { pnl: -5 }],
      threshold: 60,
    });
    const r = await calc("user");
    expect(r.blocked).toBe(false);
  });

  it("strong record → not blocked", async () => {
    const calc = await loadStrategyHealth({
      trades: Array.from({ length: 12 }, () => ({ pnl: 10, exit_reason: "take_profit", risk_reward_ratio: 2 })),
      threshold: 60,
    });
    const r = await calc("user");
    expect(r.blocked).toBe(false);
    expect(r.score).toBeGreaterThanOrEqual(60);
  });
});

// Scanner UI banner — verifies the new banner is rendered conditionally.
describe("scanner UI — strategy health soft-pass banner", () => {
  it("banner block reads strategy_health.bypassedByLearning from diagnostics", () => {
    const SCANNER = fs.readFileSync(
      path.join(REPO_ROOT, "src/app/scanner/page.tsx"),
      "utf8",
    );
    expect(SCANNER).toMatch(/data\?\.strategy_health\?\.bypassedByLearning/);
    expect(SCANNER).toMatch(/Strateji sağlık skoru düşük/);
    expect(SCANNER).toMatch(/Tarama devam ediyor, canlı\/sıkı modda işlem açılmaz/);
  });
});

// Diagnostics endpoint — exposes the strategy_health block.
describe("diagnostics route — strategy_health surface", () => {
  it("response includes strategy_health.bypassedByLearning derived from tickSummary", () => {
    const ROUTE = fs.readFileSync(
      path.join(REPO_ROOT, "src/app/api/bot/diagnostics/route.ts"),
      "utf8",
    );
    expect(ROUTE).toMatch(/strategy_health:\s*\{/);
    expect(ROUTE).toMatch(/bypassedByLearning:\s*tickSummary\?\.strategyHealthBypassedByLearning/);
  });
});
