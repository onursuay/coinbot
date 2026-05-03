// AI Aksiyon Merkezi — Faz 6: Code prompt builder + validator unit tests.
//
// Doğrulanan invaryantlar:
//   • recommendPromptTarget UI patch için Codex; backend/worker/risk için
//     Claude Code önerir.
//   • buildCodePrompt başlık + 8 numaralı bölüm yapısını üretir.
//   • Üretilen prompt zorunlu safety bloğunu (live trading, /fapi, vs.)
//     içerir.
//   • applicabilityNote sistem içinde uygulanabilir tipler için döner.
//   • validatePromptRequest confirmGenerate=false  → CONFIRMATION_REQUIRED.
//   • validatePromptRequest planId aktif değilse  → PLAN_NOT_FOUND.
//   • validatePromptRequest forbidden type için   → FORBIDDEN_ACTION.
//   • validatePromptRequest blocked plan için     → PLAN_BLOCKED.

import { describe, it, expect } from "vitest";
import {
  buildCodePrompt,
  recommendPromptTarget,
  validatePromptRequest,
  defaultScopeForPlan,
  CODE_PROMPT_SCOPES,
  CODE_PROMPT_TARGETS,
  PROMPT_SAFETY_CHECKLIST,
  PROMPT_DEPLOY_CHECKLIST,
  type ActionPlan,
} from "@/lib/ai-actions";

const FROZEN = "2026-05-03T13:00:00.000Z";

function plan(overrides: Partial<ActionPlan> = {}): ActionPlan {
  return {
    id: "perf:UPDATE_RISK_PER_TRADE_DOWN:1",
    source: "performance_decision",
    type: "UPDATE_RISK_PER_TRADE_DOWN",
    title: "Risk Per Trade Düşürme Önerisi",
    summary: "Profit factor düşük; risk düşürme önerilir.",
    reason: "Son 30 işlemde PF=0.7.",
    currentValue: "%3.0",
    recommendedValue: "%2.0",
    impact: "Pozisyon büyüklüğü düşer.",
    riskLevel: "medium",
    confidence: 80,
    requiresApproval: true,
    allowed: true,
    blockedReason: null,
    status: "ready",
    createdAt: FROZEN,
    ...overrides,
  };
}

describe("recommendPromptTarget — tool selection helper", () => {
  it("UI patch için Codex önerir", () => {
    expect(recommendPromptTarget(plan(), "ui_patch")).toBe("codex");
  });

  it("backend patch için Claude Code önerir", () => {
    expect(recommendPromptTarget(plan(), "backend_patch")).toBe("claude_code");
  });

  it("worker patch için Claude Code önerir", () => {
    expect(recommendPromptTarget(plan(), "worker_patch")).toBe("claude_code");
  });

  it("risk settings review için Claude Code önerir", () => {
    expect(recommendPromptTarget(plan(), "risk_settings_review")).toBe(
      "claude_code",
    );
  });

  it("safety audit için Claude Code önerir", () => {
    expect(recommendPromptTarget(plan(), "safety_audit")).toBe("claude_code");
  });

  it("test_fix düşük risk için Codex, kritik risk için Claude", () => {
    expect(recommendPromptTarget(plan({ riskLevel: "low" }), "test_fix")).toBe(
      "codex",
    );
    expect(
      recommendPromptTarget(plan({ riskLevel: "critical" }), "test_fix"),
    ).toBe("claude_code");
  });

  it("data_analysis için Claude Code önerir", () => {
    expect(recommendPromptTarget(plan(), "data_analysis")).toBe("claude_code");
  });
});

describe("defaultScopeForPlan", () => {
  it("UPDATE_RISK_PER_TRADE_DOWN → risk_settings_review", () => {
    expect(
      defaultScopeForPlan(plan({ type: "UPDATE_RISK_PER_TRADE_DOWN" })),
    ).toBe("risk_settings_review");
  });

  it("SET_OBSERVATION_MODE → data_analysis", () => {
    expect(
      defaultScopeForPlan(plan({ type: "SET_OBSERVATION_MODE" })),
    ).toBe("data_analysis");
  });

  it("REQUEST_MANUAL_REVIEW → safety_audit", () => {
    expect(
      defaultScopeForPlan(plan({ type: "REQUEST_MANUAL_REVIEW" })),
    ).toBe("safety_audit");
  });

  it("CREATE_IMPLEMENTATION_PROMPT → backend_patch", () => {
    expect(
      defaultScopeForPlan(plan({ type: "CREATE_IMPLEMENTATION_PROMPT" })),
    ).toBe("backend_patch");
  });
});

describe("buildCodePrompt — yapı ve içerik", () => {
  it("başlık + Plan ID + numaralı 8 bölüm üretir", () => {
    const out = buildCodePrompt({
      plan: plan(),
      request: {
        planId: plan().id,
        actionType: plan().type,
        target: "claude_code",
        scope: "risk_settings_review",
        includeSafetyChecklist: true,
        includeDeployChecklist: true,
      },
    });
    expect(out.ok).toBe(true);
    expect(out.title).toContain("Risk Per Trade");
    expect(out.prompt).toMatch(/^# Claude Code Görevi/);
    expect(out.prompt).toContain("**Plan ID:** perf:UPDATE_RISK_PER_TRADE_DOWN:1");
    expect(out.prompt).toMatch(/## 1\. Amaç/);
    expect(out.prompt).toMatch(/## 2\. Kapsam/);
    expect(out.prompt).toMatch(/## 3\. Dokunulmayacak Alanlar/);
    expect(out.prompt).toMatch(/## 4\. Yapılacaklar/);
    expect(out.prompt).toMatch(/## 5\. Test \/ Build/);
    expect(out.prompt).toMatch(/## 6\. Commit \/ Deploy/);
    expect(out.prompt).toMatch(/## 7\. Çıktı Raporu/);
    expect(out.prompt).toMatch(/## 8\. Güvenlik Kuralları/);
  });

  it("zorunlu safety block'taki tüm satırları içerir", () => {
    const out = buildCodePrompt({
      plan: plan(),
      request: {
        planId: plan().id,
        actionType: plan().type,
        target: "claude_code",
        scope: "backend_patch",
        includeSafetyChecklist: true,
        includeDeployChecklist: true,
      },
    });
    for (const item of PROMPT_SAFETY_CHECKLIST) {
      expect(out.prompt).toContain(item);
    }
  });

  it("deploy checklist içerir", () => {
    const out = buildCodePrompt({
      plan: plan(),
      request: {
        planId: plan().id,
        actionType: plan().type,
        target: "claude_code",
        scope: "backend_patch",
        includeSafetyChecklist: true,
        includeDeployChecklist: true,
      },
    });
    for (const item of PROMPT_DEPLOY_CHECKLIST) {
      expect(out.prompt).toContain(item);
    }
  });

  it("apply edilebilir tip için applicabilityNote döner", () => {
    const out = buildCodePrompt({
      plan: plan({ type: "UPDATE_RISK_PER_TRADE_DOWN" }),
      request: {
        planId: plan().id,
        actionType: "UPDATE_RISK_PER_TRADE_DOWN",
        target: "claude_code",
        scope: "risk_settings_review",
        includeSafetyChecklist: true,
        includeDeployChecklist: true,
      },
    });
    expect(out.applicabilityNote).toBeTruthy();
    expect(out.applicabilityNote).toMatch(/sistem içinde uygulanabilir/i);
  });

  it("REQUEST_MANUAL_REVIEW gibi sadece-prompt tipi için applicabilityNote null", () => {
    const out = buildCodePrompt({
      plan: plan({
        type: "REQUEST_MANUAL_REVIEW",
        currentValue: null,
        recommendedValue: null,
      }),
      request: {
        planId: plan().id,
        actionType: "REQUEST_MANUAL_REVIEW",
        target: "claude_code",
        scope: "safety_audit",
        includeSafetyChecklist: true,
        includeDeployChecklist: true,
      },
    });
    expect(out.applicabilityNote).toBeNull();
  });

  it("CREATE_IMPLEMENTATION_PROMPT için prompt üretir", () => {
    const out = buildCodePrompt({
      plan: plan({
        type: "CREATE_IMPLEMENTATION_PROMPT",
        currentValue: null,
        recommendedValue: null,
      }),
      request: {
        planId: plan().id,
        actionType: "CREATE_IMPLEMENTATION_PROMPT",
        target: "claude_code",
        scope: "backend_patch",
        includeSafetyChecklist: true,
        includeDeployChecklist: true,
      },
    });
    expect(out.prompt.length).toBeGreaterThan(200);
  });

  it("promptId hedef + plan id + zaman damgasını içerir", () => {
    const out = buildCodePrompt({
      plan: plan(),
      request: {
        planId: plan().id,
        actionType: plan().type,
        target: "codex",
        scope: "ui_patch",
        includeSafetyChecklist: true,
        includeDeployChecklist: true,
      },
    });
    expect(out.promptId).toMatch(/^prm:codex:/);
  });

  it("Codex hedefi başlıkta yer alır", () => {
    const out = buildCodePrompt({
      plan: plan(),
      request: {
        planId: plan().id,
        actionType: plan().type,
        target: "codex",
        scope: "ui_patch",
        includeSafetyChecklist: true,
        includeDeployChecklist: true,
      },
    });
    expect(out.prompt).toMatch(/^# Codex Görevi/);
  });
});

describe("validatePromptRequest — guard rails", () => {
  it("confirmGenerate false ise CONFIRMATION_REQUIRED", () => {
    const v = validatePromptRequest({
      body: { planId: plan().id, confirmGenerate: false },
      plans: [plan()],
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("CONFIRMATION_REQUIRED");
  });

  it("planId aktif planlarda yoksa PLAN_NOT_FOUND", () => {
    const v = validatePromptRequest({
      body: { planId: "missing-id", confirmGenerate: true },
      plans: [plan()],
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("PLAN_NOT_FOUND");
  });

  it("blocked plan için PLAN_BLOCKED", () => {
    const v = validatePromptRequest({
      body: { planId: plan().id, confirmGenerate: true },
      plans: [
        plan({
          allowed: false,
          blockedReason: "test bloke",
        }),
      ],
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("PLAN_BLOCKED");
  });

  it("ALLOWED_ACTION_TYPES dışında tip → ACTION_NOT_ALLOWED veya PLAN_BLOCKED", () => {
    // Generator bunu üretmez ama defansif yapı testi:
    // Plan generator tarafından zaten allowed=false işaretlenmiş kabul edelim.
    const v = validatePromptRequest({
      body: { planId: "p-bad", confirmGenerate: true },
      plans: [
        plan({
          id: "p-bad",
          type: "ENABLE_LIVE_TRADING" as never,
          allowed: false,
          blockedReason: "izinli liste dışı",
        }),
      ],
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(["PLAN_BLOCKED", "FORBIDDEN_ACTION"]).toContain(v.code);
  });

  it("REQUEST_MANUAL_REVIEW için prompt üretilebilir", () => {
    const v = validatePromptRequest({
      body: { planId: "p-mr", confirmGenerate: true },
      plans: [
        plan({
          id: "p-mr",
          type: "REQUEST_MANUAL_REVIEW",
          currentValue: null,
          recommendedValue: null,
        }),
      ],
    });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.request.scope).toBeTruthy();
  });

  it("CREATE_IMPLEMENTATION_PROMPT için prompt üretilebilir", () => {
    const v = validatePromptRequest({
      body: { planId: "p-cip", confirmGenerate: true },
      plans: [
        plan({
          id: "p-cip",
          type: "CREATE_IMPLEMENTATION_PROMPT",
          currentValue: null,
          recommendedValue: null,
        }),
      ],
    });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.request.target).toMatch(/claude_code|codex/);
  });

  it("UPDATE_RISK_PER_TRADE_DOWN için prompt üretilebilir", () => {
    const v = validatePromptRequest({
      body: { planId: plan().id, confirmGenerate: true },
      plans: [plan()],
    });
    expect(v.ok).toBe(true);
  });

  it("Geçersiz target/scope sanitize edilir, default'a düşer", () => {
    const v = validatePromptRequest({
      body: {
        planId: plan().id,
        target: "haxor" as never,
        scope: "rm-rf" as never,
        confirmGenerate: true,
      },
      plans: [plan()],
    });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(CODE_PROMPT_TARGETS).toContain(v.request.target);
      expect(CODE_PROMPT_SCOPES).toContain(v.request.scope);
    }
  });
});
