// AI Aksiyon Merkezi — Faz 2 generator testleri.
//
// Doğrulanan invaryantlar:
//   • Generator yalnızca ALLOWED_ACTION_TYPES içinden plan üretir.
//   • Yasak tip (live/leverage/risk-up/learning bypass) HİÇBİR koşulda
//     üretilmez.
//   • Veri yetersizken SET_OBSERVATION_MODE üretir.
//   • Profit factor < 1 ve yeterli veri varsa UPDATE_RISK_PER_TRADE_DOWN.
//   • Performance decision REVIEW_RISK_SETTINGS sürdürürse risk düşürme.
//   • Aynı tip için duplicate plan üretmez.

import { describe, expect, it } from "vitest";
import {
  ALLOWED_ACTION_TYPES,
  FORBIDDEN_ACTION_TYPES,
  generateActionPlans,
  type ActionPlanGeneratorInput,
} from "@/lib/ai-actions";

const FROZEN = "2026-05-03T13:00:00.000Z";

function baseInput(): ActionPlanGeneratorInput {
  return {
    closedTradeCount: 50,
    openTradeCount: 0,
    totalPnl: 100,
    dailyPnl: 5,
    winRate: 55,
    profitFactor: 1.5,
    maxDrawdownPercent: 5,
    riskSettings: {
      riskPerTradePercent: 3,
      dailyMaxLossPercent: 6,
      defaultMaxOpenPositions: 5,
      dynamicMaxOpenPositions: 5,
      maxDailyTrades: 10,
    },
    performanceDecision: null,
    aiInterpretation: null,
    generatedAt: FROZEN,
  };
}

describe("ai-actions/generator", () => {
  it("üretilen tüm planlar ALLOWED_ACTION_TYPES içindedir", () => {
    const variants: ActionPlanGeneratorInput[] = [
      baseInput(),
      { ...baseInput(), closedTradeCount: 0 },
      { ...baseInput(), closedTradeCount: 30, profitFactor: 0.7 },
      { ...baseInput(), maxDrawdownPercent: 15, riskSettings: { ...baseInput().riskSettings, dailyMaxLossPercent: 6 } },
      { ...baseInput(), winRate: 25, closedTradeCount: 50 },
      { ...baseInput(), openTradeCount: 5, closedTradeCount: 30 },
      {
        ...baseInput(),
        performanceDecision: {
          status: "ATTENTION_NEEDED",
          actionType: "REVIEW_RISK_SETTINGS",
          mainFinding: "Yüksek zarar serisi",
          systemInterpretation: "",
          recommendation: "",
          confidence: 70,
        },
      },
      {
        ...baseInput(),
        aiInterpretation: {
          status: "REVIEW_REQUIRED",
          actionType: "PROMPT",
          riskLevel: "HIGH",
          mainFinding: "Strateji incelemesi öner",
          recommendation: "",
          confidence: 70,
          blockedBy: [],
        },
      },
    ];

    for (const v of variants) {
      const plans = generateActionPlans(v);
      for (const p of plans) {
        expect(ALLOWED_ACTION_TYPES).toContain(p.type);
        expect(p.allowed).toBe(true);
        expect(p.requiresApproval).toBe(true);
      }
    }
  });

  it("hiçbir koşulda yasak action type üretmez", () => {
    const variants: ActionPlanGeneratorInput[] = [
      baseInput(),
      { ...baseInput(), winRate: 90, profitFactor: 5, closedTradeCount: 200 },
      {
        ...baseInput(),
        aiInterpretation: {
          status: "CRITICAL_BLOCKER",
          actionType: "LIVE_READINESS_BLOCKED",
          riskLevel: "CRITICAL",
          mainFinding: "Live readiness blocked",
          recommendation: "",
          confidence: 90,
          blockedBy: ["paper_trades_below_100"],
        },
      },
    ];

    for (const v of variants) {
      const plans = generateActionPlans(v);
      for (const p of plans) {
        expect(FORBIDDEN_ACTION_TYPES as readonly string[]).not.toContain(p.type);
      }
    }
  });

  it("closedTradeCount < 5 → SET_OBSERVATION_MODE", () => {
    const plans = generateActionPlans({ ...baseInput(), closedTradeCount: 2 });
    expect(plans).toHaveLength(1);
    expect(plans[0].type).toBe("SET_OBSERVATION_MODE");
    expect(plans[0].allowed).toBe(true);
    expect(plans[0].riskLevel).toBe("low");
  });

  it("profitFactor < 1 ve yeterli veri → UPDATE_RISK_PER_TRADE_DOWN", () => {
    const plans = generateActionPlans({
      ...baseInput(),
      closedTradeCount: 30,
      profitFactor: 0.7,
    });
    const types = plans.map((p) => p.type);
    expect(types).toContain("UPDATE_RISK_PER_TRADE_DOWN");
    const risk = plans.find((p) => p.type === "UPDATE_RISK_PER_TRADE_DOWN")!;
    expect(risk.currentValue).toBe("%3.0");
    expect(risk.recommendedValue).toBe("%2.0");
    expect(risk.requiresApproval).toBe(true);
  });

  it("drawdown daily limit 1.5x'inden büyükse → UPDATE_MAX_DAILY_LOSS_DOWN", () => {
    const plans = generateActionPlans({
      ...baseInput(),
      maxDrawdownPercent: 12, // 1.5 * 6 = 9 → 12 > 9
    });
    const types = plans.map((p) => p.type);
    expect(types).toContain("UPDATE_MAX_DAILY_LOSS_DOWN");
  });

  it("açık pozisyon dinamik limite ulaştıysa → UPDATE_MAX_OPEN_POSITIONS_DOWN", () => {
    const plans = generateActionPlans({
      ...baseInput(),
      closedTradeCount: 20,
      openTradeCount: 5,
      riskSettings: { ...baseInput().riskSettings, dynamicMaxOpenPositions: 5 },
    });
    const types = plans.map((p) => p.type);
    expect(types).toContain("UPDATE_MAX_OPEN_POSITIONS_DOWN");
    const cap = plans.find((p) => p.type === "UPDATE_MAX_OPEN_POSITIONS_DOWN")!;
    expect(cap.currentValue).toBe("5");
    expect(cap.recommendedValue).toBe("4");
  });

  it("açık pozisyon limit minimumundaysa → REQUEST_MANUAL_REVIEW", () => {
    const plans = generateActionPlans({
      ...baseInput(),
      closedTradeCount: 20,
      openTradeCount: 1,
      riskSettings: { ...baseInput().riskSettings, dynamicMaxOpenPositions: 1 },
    });
    const types = plans.map((p) => p.type);
    expect(types).toContain("REQUEST_MANUAL_REVIEW");
    expect(types).not.toContain("UPDATE_MAX_OPEN_POSITIONS_DOWN");
  });

  it("performance decision REVIEW_RISK_SETTINGS → UPDATE_RISK_PER_TRADE_DOWN", () => {
    const plans = generateActionPlans({
      ...baseInput(),
      performanceDecision: {
        status: "ATTENTION_NEEDED",
        actionType: "REVIEW_RISK_SETTINGS",
        mainFinding: "Risk inceleme gerekli",
        systemInterpretation: "",
        recommendation: "",
        confidence: 65,
      },
    });
    const types = plans.map((p) => p.type);
    expect(types).toContain("UPDATE_RISK_PER_TRADE_DOWN");
  });

  it("performance decision REVIEW_RISK_SETTINGS + risk taban → REQUEST_MANUAL_REVIEW", () => {
    const plans = generateActionPlans({
      ...baseInput(),
      riskSettings: { ...baseInput().riskSettings, riskPerTradePercent: 1 },
      performanceDecision: {
        status: "ATTENTION_NEEDED",
        actionType: "REVIEW_RISK_SETTINGS",
        mainFinding: "Risk inceleme gerekli (zaten taban)",
        systemInterpretation: "",
        recommendation: "",
        confidence: 65,
      },
    });
    const types = plans.map((p) => p.type);
    expect(types).toContain("REQUEST_MANUAL_REVIEW");
    expect(types).not.toContain("UPDATE_RISK_PER_TRADE_DOWN");
  });

  it("AI interpreter PROMPT öneriyorsa → CREATE_IMPLEMENTATION_PROMPT", () => {
    const plans = generateActionPlans({
      ...baseInput(),
      aiInterpretation: {
        status: "REVIEW_REQUIRED",
        actionType: "PROMPT",
        riskLevel: "MEDIUM",
        mainFinding: "Stratejiyi gözden geçirmek için prompt öner",
        recommendation: "",
        confidence: 70,
        blockedBy: [],
      },
    });
    const types = plans.map((p) => p.type);
    expect(types).toContain("CREATE_IMPLEMENTATION_PROMPT");
  });

  it("aynı tip için duplicate plan üretmez", () => {
    const plans = generateActionPlans({
      ...baseInput(),
      closedTradeCount: 30,
      profitFactor: 0.5,
      winRate: 25,
      // Hem R2 (pf<1) hem R5 (winRate<35) UPDATE_RISK_PER_TRADE_DOWN tetikler;
      // generator de-duplike etmeli.
      performanceDecision: {
        status: "ATTENTION_NEEDED",
        actionType: "REVIEW_RISK_SETTINGS",
        mainFinding: "Risk yüksek",
        systemInterpretation: "",
        recommendation: "",
        confidence: 60,
      },
    });
    const riskDownCount = plans.filter(
      (p) => p.type === "UPDATE_RISK_PER_TRADE_DOWN",
    ).length;
    expect(riskDownCount).toBe(1);
  });

  it("sağlıklı durumda + düşük veri → SET_OBSERVATION_MODE fallback", () => {
    const plans = generateActionPlans({
      ...baseInput(),
      closedTradeCount: 10, // < 25 ama >= 5
      profitFactor: 1.2,
      winRate: 55,
      maxDrawdownPercent: 4,
    });
    expect(plans.length).toBeGreaterThanOrEqual(1);
    const types = plans.map((p) => p.type);
    expect(types).toContain("SET_OBSERVATION_MODE");
  });

  it("sağlıklı durumda + yeterli veri → boş plan listesi (false-positive üretmez)", () => {
    const plans = generateActionPlans({
      ...baseInput(),
      closedTradeCount: 100,
      profitFactor: 1.8,
      winRate: 60,
      maxDrawdownPercent: 4,
      openTradeCount: 1,
    });
    expect(plans).toHaveLength(0);
  });

  it("createdAt deterministik (generatedAt injection)", () => {
    const plans = generateActionPlans({
      ...baseInput(),
      closedTradeCount: 0,
    });
    for (const p of plans) {
      expect(p.createdAt).toBe(FROZEN);
    }
  });

  it("requiresApproval daima true", () => {
    const variants: ActionPlanGeneratorInput[] = [
      { ...baseInput(), closedTradeCount: 0 },
      { ...baseInput(), profitFactor: 0.5, closedTradeCount: 30 },
      {
        ...baseInput(),
        aiInterpretation: {
          status: "REVIEW_REQUIRED",
          actionType: "PROMPT",
          riskLevel: "HIGH",
          mainFinding: "x",
          recommendation: "",
          confidence: 70,
          blockedBy: [],
        },
      },
    ];
    for (const v of variants) {
      const plans = generateActionPlans(v);
      for (const p of plans) {
        expect(p.requiresApproval).toBe(true);
      }
    }
  });
});
