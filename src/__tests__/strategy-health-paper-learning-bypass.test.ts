// Strategy health gate — universal soft-pass invariants.
//
// New behavior (this test file is the source of truth):
//   • Strategy health NEVER closes the scanner. Low score keeps tick running.
//   • Normal/live mode + low score → positionOpeningBlocked=true (per-symbol
//     gate just before openPaperTrade rejects each candidate with the
//     "Strateji sağlık düşük: işlem açılmadı" reason). scanDetails populated.
//   • Paper Learning Mode + low score → positionOpeningBlocked stays false;
//     learning trades still open with strategy_health in bypassed_risk_gates
//     and "Strateji sağlık skoru düşük" in risk_warnings.
//   • Helper-level: calculateStrategyHealth.blocked still flips on the same
//     thresholds (>=10 trades + score<min); only the orchestrator's reaction
//     changed, not the score itself.

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

  it("strategy health NEVER triggers writeSkipSummary or an early return", () => {
    // The legacy hard-block path used `writeSkipSummary('strategy_health_blocked:...')`
    // followed by `return result;`. Both are gone — the gate now keeps the tick alive.
    expect(ORCHESTRATOR).not.toMatch(/writeSkipSummary[^)]*strategy_health_blocked/);
    // Sanity: the only code path that still mentions strategy_health_blocked
    // in a return-style early-exit position is gone.
    const gateIdx = ORCHESTRATOR.indexOf("if (strategyHealth.blocked)");
    const next500 = ORCHESTRATOR.slice(gateIdx, gateIdx + 1500);
    expect(next500).not.toMatch(/return result;/);
  });

  it("learning soft-pass emits paper_learning_strategy_health_bypass event", () => {
    expect(ORCHESTRATOR).toMatch(/eventType:\s*"paper_learning_strategy_health_bypass"/);
  });

  it("normal mode emits position_open_blocked event (per-symbol)", () => {
    expect(ORCHESTRATOR).toMatch(/eventType:\s*"position_open_blocked"/);
  });

  it("orchestrator sets strategyHealthBlocked + scannerMode='monitoring_only' when score is low", () => {
    expect(ORCHESTRATOR).toMatch(/result\.strategyHealthBlocked\s*=\s*true/);
    expect(ORCHESTRATOR).toMatch(/result\.scannerMode\s*=\s*"monitoring_only"/);
  });

  it("normal mode flags positionOpeningBlocked + reason='strategy_health'", () => {
    expect(ORCHESTRATOR).toMatch(/result\.positionOpeningBlocked\s*=\s*true/);
    expect(ORCHESTRATOR).toMatch(/result\.positionOpeningBlockReason\s*=\s*"strategy_health"/);
  });

  it("per-symbol gate skips openPaperTrade with 'Strateji sağlık düşük' reason", () => {
    // Gate sits in the per-symbol loop and rejects with a localized reason
    // BEFORE the openPaperTrade call. Scanner row still gets pushed so the
    // table stays alive even when every candidate is gated.
    expect(ORCHESTRATOR).toMatch(/Strateji sağlık düşük: işlem açılmadı/);
    const gateIdx = ORCHESTRATOR.indexOf("if (result.positionOpeningBlocked && !learningModeActive)");
    expect(gateIdx).toBeGreaterThan(0);
    const window = ORCHESTRATOR.slice(gateIdx, gateIdx + 800);
    expect(window).toMatch(/result\.scanDetails\.push\(detail\)/);
    expect(window).toMatch(/continue;/);
  });

  it("trade-open metadata pushes 'strategy_health' onto bypassedGates when learning soft-passed", () => {
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

  it("lastTickSummary surfaces all strategy_health flags for the scanner UI", () => {
    expect(ORCHESTRATOR).toMatch(/strategyHealthBlocked:\s*result\.strategyHealthBlocked/);
    expect(ORCHESTRATOR).toMatch(/strategyHealthBypassedByLearning:\s*result\.strategyHealthBypassedByLearning/);
    expect(ORCHESTRATOR).toMatch(/positionOpeningBlocked:\s*result\.positionOpeningBlocked/);
    expect(ORCHESTRATOR).toMatch(/scannerMode:\s*result\.scannerMode/);
    expect(ORCHESTRATOR).toMatch(/tableStillGenerated:\s*result\.tableStillGenerated/);
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

// Scanner UI — banner removed (May 2026 stabilization, user request).
// The diagnostics shape still surfaces strategy_health.blocked, but the page
// MUST NOT render the warning banner. Tablo görünmeye devam eder; gerekçe
// sadece satır bazında "Karar Gerekçesi" kolonunda gösterilir.
describe("scanner UI — banner removed, table always shown", () => {
  const SCANNER = fs.readFileSync(
    path.join(REPO_ROOT, "src/app/scanner/page.tsx"),
    "utf8",
  );

  it("no JSX block reads data.strategy_health.blocked", () => {
    expect(SCANNER).not.toMatch(/data\?\.strategy_health\?\.blocked/);
  });

  it("no Turkish monitoring banner copy on the page", () => {
    expect(SCANNER).not.toMatch(/Tarama izleme modunda devam ediyor/);
    expect(SCANNER).not.toMatch(/Tarama izleme\/öğrenme modunda devam ediyor/);
  });

  it("table render condition stays intact", () => {
    expect(SCANNER).toMatch(/rows\.length > 0/);
  });
});

// Diagnostics endpoint — exposes the strategy_health block.
describe("diagnostics route — strategy_health surface", () => {
  const ROUTE = fs.readFileSync(
    path.join(REPO_ROOT, "src/app/api/bot/diagnostics/route.ts"),
    "utf8",
  );

  it("response surfaces blocked + scannerMode + positionOpeningBlocked + bypassedByLearning", () => {
    expect(ROUTE).toMatch(/strategy_health:\s*\{/);
    expect(ROUTE).toMatch(/blocked:\s*tickSummary\?\.strategyHealthBlocked/);
    expect(ROUTE).toMatch(/bypassedByLearning:\s*tickSummary\?\.strategyHealthBypassedByLearning/);
    expect(ROUTE).toMatch(/positionOpeningBlocked:\s*tickSummary\?\.positionOpeningBlocked/);
    expect(ROUTE).toMatch(/scannerMode:\s*tickSummary\?\.scannerMode/);
    expect(ROUTE).toMatch(/tableStillGenerated:\s*tickSummary\?\.tableStillGenerated/);
  });
});

// Labels — legacy mapping returns the new copy so any historical tick summary
// in DB renders with the new wording instead of the old "engelledi" message.
describe("labels — strategy_health legacy mapping", () => {
  it("mapTickSkipReasonTr returns the new monitoring-mode copy", () => {
    const LABELS = fs.readFileSync(
      path.join(REPO_ROOT, "src/lib/dashboard/labels.ts"),
      "utf8",
    );
    expect(LABELS).toMatch(/Strateji sağlık skoru düşük\. Tarama izleme modunda devam ediyor; yeni işlem açılmıyor\./);
    expect(LABELS).not.toMatch(/Strateji sağlık kontrolü engelledi/);
  });
});
