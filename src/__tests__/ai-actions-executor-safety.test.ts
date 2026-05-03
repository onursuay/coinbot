// AI Aksiyon Merkezi — Faz 3: SafeActionExecutor güvenlik testleri.
//
// Doğrulanan invaryantlar:
//   • confirmApply false ise apply reddedilir (CONFIRMATION_REQUIRED).
//   • Forbidden type açıkça reddedilir (FORBIDDEN_ACTION).
//   • Faz 3'te APPLICABLE olmayan ALLOWED tipler reddedilir
//     (REQUEST_MANUAL_REVIEW, CREATE_IMPLEMENTATION_PROMPT).
//   • UI manipülasyonu (planId yok / değer mismatch) reddedilir.
//   • Aşağı yönlü olmayan değişiklik (yeni >= eski) reddedilir.
//   • SET_OBSERVATION_MODE risk settings'e dokunmaz, observed döner.
//   • Persistence verify hatası PERSISTENCE_VERIFY_FAILED döner.
//
// Bu testler stub'lı bir buildAIActionsResult ile çalışır.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActionPlan, ActionPlanResult } from "@/lib/ai-actions";

// Mock chains:
//   1. snapshot.buildAIActionsResult → testin kontrol ettiği plan listesi.
//   2. risk-settings/store.updateAndPersistRiskSettings → testin başarı/fail
//      seçimine göre döner.
//   3. risk-settings/apply.buildRiskExecutionConfig → mevcut değerler.
const planListRef: { value: ActionPlan[] } = { value: [] };
const persistResultRef: {
  value:
    | { ok: true; data: any; savedAt: number; via: "direct_update" | "direct_insert" }
    | { ok: false; stage: "validation"; errors: string[] }
    | { ok: false; stage: "persistence"; errorSafe: string; data: any };
} = {
  value: { ok: true, data: {}, savedAt: 0, via: "direct_update" },
};
const persistCalls: any[] = [];

vi.mock("@/lib/ai-actions/snapshot", async () => {
  const actual = await vi.importActual<any>("@/lib/ai-actions/snapshot");
  return {
    ...actual,
    buildAIActionsResult: async (): Promise<ActionPlanResult> => ({
      plans: planListRef.value,
      generatedAt: "2026-05-03T13:00:00.000Z",
      sourceSnapshot: {
        closedTrades: 0,
        openPositions: 0,
        totalPnl: 0,
        dailyPnl: 0,
        winRate: 0,
        profitFactor: 0,
        maxDrawdownPercent: 0,
        riskSettingsSummary: {
          riskPerTradePercent: 3,
          dailyMaxLossPercent: 10,
          defaultMaxOpenPositions: 3,
          dynamicMaxOpenPositions: 5,
          maxDailyTrades: 10,
        },
        performanceDecisionStatus: null,
        aiInterpreterStatus: null,
      },
      phaseBanner: "test-phase-banner",
    }),
  };
});

vi.mock("@/lib/risk-settings/store", () => {
  return {
    updateAndPersistRiskSettings: async (patch: any) => {
      persistCalls.push(patch);
      return persistResultRef.value;
    },
  };
});

vi.mock("@/lib/risk-settings/apply", () => {
  return {
    getEffectiveRiskSettings: () => ({}),
    buildRiskExecutionConfig: () => ({
      riskPerTradePercent: 3,
      dailyMaxLossPercent: 10,
      defaultMaxOpenPositions: 3,
      dynamicMaxOpenPositions: 5,
      maxDailyTrades: 10,
    }),
  };
});

import { executeAction } from "@/lib/ai-actions";

function plan(p: Partial<ActionPlan> & { id: string; type: ActionPlan["type"] }): ActionPlan {
  return {
    id: p.id,
    source: p.source ?? "performance_decision",
    type: p.type,
    title: p.title ?? "test",
    summary: p.summary ?? "test",
    reason: p.reason ?? "",
    currentValue: p.currentValue ?? null,
    recommendedValue: p.recommendedValue ?? null,
    impact: p.impact ?? "",
    riskLevel: p.riskLevel ?? "medium",
    confidence: p.confidence ?? 70,
    requiresApproval: true,
    allowed: p.allowed ?? true,
    blockedReason: p.blockedReason ?? null,
    status: p.status ?? "ready",
    createdAt: p.createdAt ?? "2026-05-03T13:00:00.000Z",
  };
}

beforeEach(() => {
  planListRef.value = [];
  persistCalls.length = 0;
  persistResultRef.value = { ok: true, data: {}, savedAt: Date.now(), via: "direct_update" };
});

describe("Executor — confirmation gate", () => {
  it("confirmApply=false → CONFIRMATION_REQUIRED", async () => {
    planListRef.value = [
      plan({
        id: "p1",
        type: "UPDATE_RISK_PER_TRADE_DOWN",
        currentValue: "%3.0",
        recommendedValue: "%2.0",
      }),
    ];
    const r = await executeAction(
      {
        planId: "p1",
        actionType: "UPDATE_RISK_PER_TRADE_DOWN",
        recommendedValue: "%2.0",
        confirmApply: false,
      },
      { userId: "u1" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CONFIRMATION_REQUIRED");
    expect(persistCalls).toHaveLength(0);
  });
});

describe("Executor — forbidden + non-applicable types", () => {
  it("FORBIDDEN_ACTION_TYPES açıkça reddedilir", async () => {
    const r = await executeAction(
      {
        planId: "x",
        actionType: "ENABLE_LIVE_TRADING",
        recommendedValue: "true",
        confirmApply: true,
      },
      { userId: "u1" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FORBIDDEN_ACTION");
  });

  it("REQUEST_MANUAL_REVIEW apply reddedilir", async () => {
    planListRef.value = [
      plan({
        id: "p1",
        type: "REQUEST_MANUAL_REVIEW",
        currentValue: null,
        recommendedValue: null,
      }),
    ];
    const r = await executeAction(
      {
        planId: "p1",
        actionType: "REQUEST_MANUAL_REVIEW",
        recommendedValue: "",
        confirmApply: true,
      },
      { userId: "u1" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("ACTION_NOT_ALLOWED");
    expect(persistCalls).toHaveLength(0);
  });

  it("CREATE_IMPLEMENTATION_PROMPT apply reddedilir", async () => {
    planListRef.value = [
      plan({
        id: "p1",
        type: "CREATE_IMPLEMENTATION_PROMPT",
      }),
    ];
    const r = await executeAction(
      {
        planId: "p1",
        actionType: "CREATE_IMPLEMENTATION_PROMPT",
        recommendedValue: "",
        confirmApply: true,
      },
      { userId: "u1" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("ACTION_NOT_ALLOWED");
    expect(persistCalls).toHaveLength(0);
  });
});

describe("Executor — UI manipulation defense", () => {
  it("planId aktif planlar arasında yoksa reddedilir", async () => {
    planListRef.value = [];
    const r = await executeAction(
      {
        planId: "ghost",
        actionType: "UPDATE_RISK_PER_TRADE_DOWN",
        recommendedValue: "%2.0",
        confirmApply: true,
      },
      { userId: "u1" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PLAN_NOT_FOUND");
    expect(persistCalls).toHaveLength(0);
  });

  it("recommendedValue plan ile uyuşmazsa reddedilir", async () => {
    planListRef.value = [
      plan({
        id: "p1",
        type: "UPDATE_RISK_PER_TRADE_DOWN",
        currentValue: "%3.0",
        recommendedValue: "%2.0",
      }),
    ];
    const r = await executeAction(
      {
        planId: "p1",
        actionType: "UPDATE_RISK_PER_TRADE_DOWN",
        recommendedValue: "%0.5", // UI'dan manipüle edilmiş
        confirmApply: true,
      },
      { userId: "u1" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PLAN_VALUE_MISMATCH");
    expect(persistCalls).toHaveLength(0);
  });

  it("plan allowed=false ise reddedilir", async () => {
    planListRef.value = [
      plan({
        id: "p1",
        type: "UPDATE_RISK_PER_TRADE_DOWN",
        currentValue: "%3.0",
        recommendedValue: "%2.0",
        allowed: false,
        blockedReason: "test bloke",
      }),
    ];
    const r = await executeAction(
      {
        planId: "p1",
        actionType: "UPDATE_RISK_PER_TRADE_DOWN",
        recommendedValue: "%2.0",
        confirmApply: true,
      },
      { userId: "u1" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PLAN_BLOCKED");
    expect(persistCalls).toHaveLength(0);
  });
});

describe("Executor — UPDATE_*_DOWN happy + downward guards", () => {
  it("UPDATE_RISK_PER_TRADE_DOWN %3 → %2 uygulanır", async () => {
    planListRef.value = [
      plan({
        id: "p1",
        type: "UPDATE_RISK_PER_TRADE_DOWN",
        currentValue: "%3.0",
        recommendedValue: "%2.0",
      }),
    ];
    const r = await executeAction(
      {
        planId: "p1",
        actionType: "UPDATE_RISK_PER_TRADE_DOWN",
        recommendedValue: "%2.0",
        confirmApply: true,
      },
      { userId: "u1" },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.code).toBe("ACTION_APPLIED");
      expect(r.newValue).toBe("%2");
    }
    expect(persistCalls).toHaveLength(1);
    expect(persistCalls[0]).toEqual({ capital: { riskPerTradePercent: 2 } });
  });

  it("UPDATE_RISK_PER_TRADE_DOWN aşağı değil (yukarı) reddedilir", async () => {
    planListRef.value = [
      plan({
        id: "p1",
        type: "UPDATE_RISK_PER_TRADE_DOWN",
        currentValue: "%3.0",
        recommendedValue: "%4.0",
      }),
    ];
    const r = await executeAction(
      {
        planId: "p1",
        actionType: "UPDATE_RISK_PER_TRADE_DOWN",
        recommendedValue: "%4.0",
        confirmApply: true,
      },
      { userId: "u1" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_A_DOWNWARD_CHANGE");
    expect(persistCalls).toHaveLength(0);
  });

  it("UPDATE_MAX_DAILY_LOSS_DOWN %10 → %8 uygulanır", async () => {
    planListRef.value = [
      plan({
        id: "p1",
        type: "UPDATE_MAX_DAILY_LOSS_DOWN",
        currentValue: "%10.0",
        recommendedValue: "%8.0",
      }),
    ];
    const r = await executeAction(
      {
        planId: "p1",
        actionType: "UPDATE_MAX_DAILY_LOSS_DOWN",
        recommendedValue: "%8.0",
        confirmApply: true,
      },
      { userId: "u1" },
    );
    expect(r.ok).toBe(true);
    expect(persistCalls[0]).toEqual({ capital: { maxDailyLossPercent: 8 } });
  });

  it("UPDATE_MAX_OPEN_POSITIONS_DOWN 5 → 4 uygulanır", async () => {
    planListRef.value = [
      plan({
        id: "p1",
        type: "UPDATE_MAX_OPEN_POSITIONS_DOWN",
        currentValue: "5",
        recommendedValue: "4",
      }),
    ];
    const r = await executeAction(
      {
        planId: "p1",
        actionType: "UPDATE_MAX_OPEN_POSITIONS_DOWN",
        recommendedValue: "4",
        confirmApply: true,
      },
      { userId: "u1" },
    );
    expect(r.ok).toBe(true);
    expect(persistCalls[0]).toEqual({
      positions: { dynamicMaxOpenPositionsCap: 4 },
    });
  });

  it("UPDATE_MAX_DAILY_TRADES_DOWN 10 → 8 uygulanır", async () => {
    planListRef.value = [
      plan({
        id: "p1",
        type: "UPDATE_MAX_DAILY_TRADES_DOWN",
        currentValue: "10",
        recommendedValue: "8",
      }),
    ];
    const r = await executeAction(
      {
        planId: "p1",
        actionType: "UPDATE_MAX_DAILY_TRADES_DOWN",
        recommendedValue: "8",
        confirmApply: true,
      },
      { userId: "u1" },
    );
    expect(r.ok).toBe(true);
    expect(persistCalls[0]).toEqual({ positions: { maxDailyTrades: 8 } });
  });
});

describe("Executor — SET_OBSERVATION_MODE", () => {
  it("risk settings'e dokunmaz, observed döner", async () => {
    planListRef.value = [
      plan({
        id: "p1",
        type: "SET_OBSERVATION_MODE",
        currentValue: null,
        recommendedValue: null,
      }),
    ];
    const r = await executeAction(
      {
        planId: "p1",
        actionType: "SET_OBSERVATION_MODE",
        recommendedValue: "",
        confirmApply: true,
      },
      { userId: "u1" },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.status).toBe("observed");
      expect(r.code).toBe("OBSERVATION_RECORDED");
    }
    // updateAndPersistRiskSettings ÇAĞRILMAMALI.
    expect(persistCalls).toHaveLength(0);
  });
});

describe("Executor — persistence verify failures surface", () => {
  it("persistence verify mismatch → PERSISTENCE_VERIFY_FAILED", async () => {
    planListRef.value = [
      plan({
        id: "p1",
        type: "UPDATE_RISK_PER_TRADE_DOWN",
        currentValue: "%3.0",
        recommendedValue: "%2.0",
      }),
    ];
    persistResultRef.value = {
      ok: false,
      stage: "persistence",
      errorSafe: "DB verify mismatch (via=direct_update): sent X got Y",
      data: {},
    };
    const r = await executeAction(
      {
        planId: "p1",
        actionType: "UPDATE_RISK_PER_TRADE_DOWN",
        recommendedValue: "%2.0",
        confirmApply: true,
      },
      { userId: "u1" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("PERSISTENCE_VERIFY_FAILED");
      expect(r.status).toBe("failed");
    }
  });
});
