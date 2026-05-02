// Stabilization invariants — May 2026.
//
// Source-level invariants that lock the new behavior:
//   • Universal min signal score for paper trade opening = 70
//   • Force/aggressive/learning modes can NOT lower the floor
//   • directionCandidate-based opening (no real LONG/SHORT signal) is disabled
//   • A defensive backstop right before openPaperTrade re-asserts the rule
//
// These invariants exist because the previous override paths produced trades
// at scores 29-69 with ~75% stop-loss rate, generating a net loss in paper.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ORCHESTRATOR = fs.readFileSync(
  path.join(REPO_ROOT, "src/lib/engines/bot-orchestrator.ts"),
  "utf8",
);

describe("stabilization — min signal score gate", () => {
  it("activeMinSignalScore is hard-coded to 70 (no mode-based reduction)", () => {
    expect(ORCHESTRATOR).toMatch(/const activeMinSignalScore = 70;/);
    // The previous mode-conditional ternary must be gone:
    expect(ORCHESTRATOR).not.toMatch(/activeMinSignalScore = forceMode\.active/);
    expect(ORCHESTRATOR).not.toMatch(/activeMinSignalScore = aggMode\.active/);
  });

  it("directionCandidate-based opening (force/learning override) is hard-disabled", () => {
    expect(ORCHESTRATOR).toMatch(/const directionOverrideAllowed = false;/);
    // The override branch must be guarded by the always-false sentinel.
    expect(ORCHESTRATOR).toMatch(/if \(directionOverrideAllowed && forceMode\.active && \(dcIsLong \|\| dcIsShort\)\)/);
  });

  it("backstop just before openPaperTrade rejects score<70 or non-LONG/SHORT signal", () => {
    expect(ORCHESTRATOR).toMatch(/eventType:\s*"stabilization_backstop_blocked"/);
    // Backstop conditions:
    expect(ORCHESTRATOR).toMatch(/sig\.score < 70/);
    expect(ORCHESTRATOR).toMatch(/sig\.signalType !== "LONG" && sig\.signalType !== "SHORT"/);
  });

  it("backstop is positioned BEFORE the openPaperTrade call", () => {
    const backstopIdx = ORCHESTRATOR.indexOf('eventType: "stabilization_backstop_blocked"');
    const openIdx = ORCHESTRATOR.indexOf("await openPaperTrade(");
    expect(backstopIdx).toBeGreaterThan(0);
    expect(openIdx).toBeGreaterThan(backstopIdx);
  });
});

describe("safety invariants (must never regress)", () => {
  it("HARD_LIVE_TRADING_ALLOWED env reference stays in env layer", () => {
    const ENV = fs.readFileSync(path.join(REPO_ROOT, "src/lib/env.ts"), "utf8");
    expect(ENV).toMatch(/HARD_LIVE_TRADING_ALLOWED/);
  });

  it("signal-engine min-score default 70 invariant preserved", () => {
    const SE = fs.readFileSync(
      path.join(REPO_ROOT, "src/lib/engines/signal-engine.ts"),
      "utf8",
    );
    // Default `aggressiveMinScore ?? 70` — default arm must stay 70.
    expect(SE).toMatch(/aggressiveMinScore\s*\?\?\s*70/);
  });
});

describe("scanner UI — banner removed (user request)", () => {
  it("scanner page does NOT render the strategy_health monitoring banner", () => {
    const SCANNER = fs.readFileSync(
      path.join(REPO_ROOT, "src/app/scanner/page.tsx"),
      "utf8",
    );
    expect(SCANNER).not.toMatch(/data\?\.strategy_health\?\.blocked/);
    expect(SCANNER).not.toMatch(/Tarama izleme modunda devam ediyor/);
    expect(SCANNER).not.toMatch(/Tarama izleme\/öğrenme modunda devam ediyor/);
  });
});

describe("paper-trades UI — PAPER LEARNING badge removed (user request)", () => {
  const PT = fs.readFileSync(
    path.join(REPO_ROOT, "src/app/paper-trades/page.tsx"),
    "utf8",
  );

  it("no PAPER LEARNING text anywhere on the paper-trades page", () => {
    expect(PT).not.toMatch(/PAPER LEARNING/);
  });

  it("no isPaperLearning helper / no learningHypothesis helper", () => {
    expect(PT).not.toMatch(/function isPaperLearning/);
    expect(PT).not.toMatch(/function learningHypothesis/);
  });

  it("no badge JSX referencing risk_metadata.paper_learning_mode", () => {
    expect(PT).not.toMatch(/paper_learning_mode/);
  });
});
