// Hard signal-score gate — regression suite.
//
// Bug context: LAB/USDT açılış (Skor 0/70, Karar: İŞLEM AÇILDI). Force paper
// direction-override kolu, sig.score=0 ile pozisyon açtırıyordu çünkü min
// signal score gate yalnızca metadata'ya log basılıyor, gerçek kontrol
// orchestrator'da yoktu. Bu suite hard gate'in bütün modlarda devrede
// olduğunu doğrular.

import { describe, it, expect } from "vitest";
import { validateSignalScoreGate } from "@/lib/engines/signal-score-gate";

const baseInput = {
  signalType: "LONG" as const,
  effectiveSignalType: "LONG" as const,
  directionCandidate: "LONG_CANDIDATE" as const,
  minSignalScore: 45,
  modeLabel: "force_paper" as const,
};

describe("validateSignalScoreGate — score numeric/positive checks", () => {
  it("score=0 → SIGNAL_SCORE_ZERO (LAB/USDT bugfix)", () => {
    const r = validateSignalScoreGate({ ...baseInput, tradeSignalScore: 0 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("SIGNAL_SCORE_ZERO");
    expect(r.reason).toContain("SIGNAL_SCORE_ZERO");
  });

  it("score=NaN → SCORE_NOT_NUMERIC", () => {
    const r = validateSignalScoreGate({ ...baseInput, tradeSignalScore: NaN });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("SCORE_NOT_NUMERIC");
  });

  it("score=undefined → SCORE_NOT_NUMERIC", () => {
    const r = validateSignalScoreGate({ ...baseInput, tradeSignalScore: undefined });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("SCORE_NOT_NUMERIC");
  });

  it("score=null → SCORE_NOT_NUMERIC", () => {
    const r = validateSignalScoreGate({ ...baseInput, tradeSignalScore: null });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("SCORE_NOT_NUMERIC");
  });

  it("score=Infinity → SCORE_NOT_NUMERIC", () => {
    const r = validateSignalScoreGate({ ...baseInput, tradeSignalScore: Infinity });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("SCORE_NOT_NUMERIC");
  });

  it("score=-5 → NO_VALID_SIGNAL_SCORE", () => {
    const r = validateSignalScoreGate({ ...baseInput, tradeSignalScore: -5 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("NO_VALID_SIGNAL_SCORE");
  });

  it("score='44' (string) → SCORE_NOT_NUMERIC", () => {
    const r = validateSignalScoreGate({ ...baseInput, tradeSignalScore: "44" });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("SCORE_NOT_NUMERIC");
  });
});

describe("validateSignalScoreGate — minSignalScore threshold", () => {
  it("score=44, min=45 → açmamalı (NO_VALID_SIGNAL_SCORE)", () => {
    const r = validateSignalScoreGate({ ...baseInput, tradeSignalScore: 44, minSignalScore: 45 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("NO_VALID_SIGNAL_SCORE");
    expect(r.reason).toContain("min=45");
  });

  it("score=45, min=45 → ok (paper learning sınır kabul)", () => {
    const r = validateSignalScoreGate({
      ...baseInput,
      tradeSignalScore: 45,
      minSignalScore: 45,
      signalType: "LONG",
      effectiveSignalType: "LONG",
    });
    expect(r.ok).toBe(true);
    expect(r.code).toBeNull();
  });

  it("score=70, min=70, normal mod → ok", () => {
    const r = validateSignalScoreGate({
      ...baseInput,
      tradeSignalScore: 70,
      minSignalScore: 70,
      modeLabel: "normal",
      signalType: "LONG",
      effectiveSignalType: "LONG",
    });
    expect(r.ok).toBe(true);
  });

  it("score=69, min=70, normal mod → reddet", () => {
    const r = validateSignalScoreGate({
      ...baseInput,
      tradeSignalScore: 69,
      minSignalScore: 70,
      modeLabel: "normal",
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("NO_VALID_SIGNAL_SCORE");
  });
});

describe("validateSignalScoreGate — direction checks", () => {
  it("effectiveSignalType=NO_TRADE → SIGNAL_TYPE_MISSING", () => {
    const r = validateSignalScoreGate({
      ...baseInput,
      tradeSignalScore: 60,
      effectiveSignalType: "NO_TRADE",
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("SIGNAL_TYPE_MISSING");
  });

  it("effectiveSignalType=null → SIGNAL_TYPE_MISSING", () => {
    const r = validateSignalScoreGate({
      ...baseInput,
      tradeSignalScore: 60,
      effectiveSignalType: null,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("SIGNAL_TYPE_MISSING");
  });

  it("directionCandidate=LONG_CANDIDATE, signalType=NO_TRADE, score=30, min=45 → DIRECTION_CANDIDATE_ONLY", () => {
    const r = validateSignalScoreGate({
      tradeSignalScore: 30,
      signalType: "NO_TRADE",
      effectiveSignalType: "LONG",  // override applied by orchestrator
      directionCandidate: "LONG_CANDIDATE",
      minSignalScore: 45,
      modeLabel: "force_paper",
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("DIRECTION_CANDIDATE_ONLY");
    expect(r.reason).toContain("yön sadece aday");
  });

  it("directionCandidate=LONG_CANDIDATE, signalType=NO_TRADE, score=50, min=45 → açabilir (override yeterli)", () => {
    const r = validateSignalScoreGate({
      tradeSignalScore: 50,
      signalType: "NO_TRADE",
      effectiveSignalType: "LONG",
      directionCandidate: "LONG_CANDIDATE",
      minSignalScore: 45,
      modeLabel: "force_paper",
    });
    expect(r.ok).toBe(true);
  });

  it("real signalType=LONG (no override), score=60, min=45 → açabilir", () => {
    const r = validateSignalScoreGate({
      tradeSignalScore: 60,
      signalType: "LONG",
      effectiveSignalType: "LONG",
      directionCandidate: "LONG_CANDIDATE",
      minSignalScore: 45,
      modeLabel: "force_paper",
    });
    expect(r.ok).toBe(true);
  });
});

describe("validateSignalScoreGate — LAB/USDT smoke", () => {
  it("score=0, signalType=NO_TRADE, effective=LONG (override), directionCandidate=LONG_CANDIDATE → SIGNAL_SCORE_ZERO", () => {
    // Reproduces the exact LAB/USDT bug: score 0, force-paper direction override.
    const r = validateSignalScoreGate({
      tradeSignalScore: 0,
      signalType: "NO_TRADE",
      effectiveSignalType: "LONG",
      directionCandidate: "LONG_CANDIDATE",
      minSignalScore: 1, // forcePaperMinSignalScore default
      modeLabel: "force_paper",
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("SIGNAL_SCORE_ZERO");
  });
});

describe("openPaperTrade — invariant checks (defense-in-depth)", () => {
  it("openPaperTrade signalScore=0 ile çağrıldığında throw atar (caller bypass'a karşı)", async () => {
    const { openPaperTrade } = await import("@/lib/engines/paper-trading-engine");
    await expect(
      openPaperTrade({
        userId: "test",
        exchange: "binance" as const,
        symbol: "LAB/USDT",
        direction: "LONG" as const,
        entryPrice: 100,
        stopLoss: 98,
        takeProfit: 104,
        leverage: 1,
        positionSize: 1,
        marginUsed: 100,
        riskAmount: 2,
        riskRewardRatio: 2,
        signalScore: 0,
      }),
    ).rejects.toThrow(/NO_VALID_SIGNAL_SCORE/);
  });

  it("openPaperTrade signalScore=undefined ile çağrıldığında throw atar", async () => {
    const { openPaperTrade } = await import("@/lib/engines/paper-trading-engine");
    await expect(
      openPaperTrade({
        userId: "test",
        exchange: "binance" as const,
        symbol: "LAB/USDT",
        direction: "LONG" as const,
        entryPrice: 100,
        stopLoss: 98,
        takeProfit: 104,
        leverage: 1,
        positionSize: 1,
        marginUsed: 100,
        riskAmount: 2,
        riskRewardRatio: 2,
        // signalScore omitted
      }),
    ).rejects.toThrow(/NO_VALID_SIGNAL_SCORE/);
  });
});
