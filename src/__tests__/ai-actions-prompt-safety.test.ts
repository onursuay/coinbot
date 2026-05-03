// AI Aksiyon Merkezi — Faz 6: Prompt center safety invariants.
//
// Source-level testler. Disk'teki dosyalar üzerinde regex doğrulaması yapar.
// Doğrulanan invaryantlar:
//   • /api/ai-actions/prompt route yalnızca POST handler tanımlar.
//   • Risk settings DB write yok (insert/update/upsert/delete/rpc set_).
//   • Binance private endpoint (/fapi/v1/order, /fapi/v1/leverage) yok.
//   • HARD_LIVE_TRADING_ALLOWED=true / enable_live_trading=true ataması yok.
//   • Prompt safety bloğu kaynakta açıkça pin'lenir (test-time string match).
//   • Prompt tam içeriği bot_logs metadata'sına yazılmaz —
//     log message/metadata içinde "prompt: " veya tam prompt body yok.
//   • UI Prompt modal mevcut ve confirmGenerate=true literal POST yapıyor.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  buildCodePrompt,
  PROMPT_SAFETY_CHECKLIST,
  type ActionPlan,
} from "@/lib/ai-actions";

const ROOT = path.resolve(__dirname, "../..");
function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf-8");
}

/**
 * `metadata: { ... }` bloklarını brace-counter ile çıkarır. Source-level
 * audit testleri için yeterince güvenli; nested objelerle başa çıkar.
 */
function extractMetadataBlocks(src: string): string[] {
  const out: string[] = [];
  const needle = "metadata:";
  let idx = 0;
  while ((idx = src.indexOf(needle, idx)) !== -1) {
    const open = src.indexOf("{", idx);
    if (open === -1) break;
    let depth = 1;
    let i = open + 1;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      i += 1;
    }
    if (depth === 0) out.push(src.slice(open, i));
    idx = i;
  }
  return out;
}

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

describe("/api/ai-actions/prompt route — safety invariants", () => {
  const route = read("src/app/api/ai-actions/prompt/route.ts");

  it("yalnızca POST handler tanımlar", () => {
    expect(route).toMatch(/export\s+async\s+function\s+POST\s*\(/);
    expect(route).not.toMatch(/export\s+async\s+function\s+GET\s*\(/);
    expect(route).not.toMatch(/export\s+async\s+function\s+PUT\s*\(/);
    expect(route).not.toMatch(/export\s+async\s+function\s+PATCH\s*\(/);
    expect(route).not.toMatch(/export\s+async\s+function\s+DELETE\s*\(/);
  });

  it("risk settings DB write yapmaz (insert/update/upsert/delete/rpc set_)", () => {
    expect(route).not.toMatch(/risk_settings/);
    expect(route).not.toMatch(/\.update\s*\(/);
    expect(route).not.toMatch(/\.upsert\s*\(/);
    expect(route).not.toMatch(/\.delete\s*\(/);
    expect(route).not.toMatch(/\.rpc\s*\(\s*['"`]set_/);
    // bot_logs INSERT (audit) botLog helper üzerinden yapılır; doğrudan
    // .insert(...) çağrısı YOKTUR.
    expect(route).not.toMatch(/\.insert\s*\(/);
  });

  it("Binance private endpoint referansı yok", () => {
    expect(route).not.toMatch(/\/fapi\/v1\/order/);
    expect(route).not.toMatch(/\/fapi\/v1\/leverage/);
  });

  it("HARD_LIVE_TRADING_ALLOWED=true / enable_live_trading=true / live mode ataması yok", () => {
    expect(route).not.toMatch(/HARD_LIVE_TRADING_ALLOWED\s*=\s*true/);
    expect(route).not.toMatch(/enable_live_trading\s*=\s*true/);
    expect(route).not.toMatch(/trading_mode\s*=\s*['"]live['"]/);
  });

  it("audit eventleri kod gövdesinde geçer", () => {
    expect(route).toMatch(/ai_action_prompt_requested/);
    expect(route).toMatch(/ai_action_prompt_generated/);
    expect(route).toMatch(/ai_action_prompt_blocked/);
    expect(route).toMatch(/ai_action_prompt_failed/);
  });

  it("CONFIRMATION_REQUIRED guard var", () => {
    // validatePromptRequest yoluyla; route içinde validation çağrısı + code kullanımı.
    expect(route).toMatch(/validatePromptRequest\(/);
  });

  it("audit log metadata'sına TAM prompt body yazılmaz", () => {
    // Güvenlik invaryantı: bot_logs audit metadata içinde
    // result.prompt referansı YOKTUR. Sadece UI response gövdesinde
    // (return ok({ prompt: ... })) prompt geri verilebilir.
    // Güvenlik invaryantı: bot_logs audit metadata içinde tam prompt body
    // taşıyan bir alan YOKTUR. Sadece UI response gövdesinde
    // (return ok({ prompt: ... })) prompt geri verilebilir.
    // Bunun için kaynağı manuel olarak metadata bloklarına ayırıyoruz.
    const metadataBlocks = extractMetadataBlocks(route);
    expect(metadataBlocks.length).toBeGreaterThan(0);
    for (const block of metadataBlocks) {
      // result.prompt → tam body değer. result.prompt.length / result.promptId
      // GÜVENLİDİR (derive metric / id). Bu yüzden lookahead ile özel tipler
      // hariç tutulur; sadece "result.prompt" + (delimiter) yakalanır.
      expect(block).not.toMatch(/result\.prompt(?![A-Za-z]|\.length)/);
    }
    // promptLength gibi güvenli metadata alanı vardır.
    expect(route).toMatch(/promptLength/);
  });
});

describe("/lib/ai-actions/code-prompt — safety invariants", () => {
  const src = read("src/lib/ai-actions/code-prompt.ts");

  it("Binance API çağrısı yapan kod yok (fetch /fapi)", () => {
    // PROMPT_SAFETY_CHECKLIST içinde /fapi/v1/order ve /fapi/v1/leverage
    // string'leri DOKUMAN amaçlı geçer ("eklenmeyecek" şeklinde).
    // Asıl kontrol: bu string'ler bir fetch / axios çağrısı içinde GEÇMEZ.
    expect(src).not.toMatch(/fetch\s*\(\s*['"`][^'"`]*\/fapi\/v1\//);
    expect(src).not.toMatch(/axios[\s\S]{0,40}\/fapi\/v1\//);
    expect(src).not.toMatch(/binance[\s\S]{0,40}\/fapi\/v1\//i);
  });

  it("HARD_LIVE_TRADING_ALLOWED=true ataması yok", () => {
    expect(src).not.toMatch(/HARD_LIVE_TRADING_ALLOWED\s*=\s*true/);
  });

  it("PROMPT_SAFETY_CHECKLIST canlı emir/leverage/forbidden tipleri kapsar", () => {
    // canlı emir
    expect(
      PROMPT_SAFETY_CHECKLIST.some((s) => /Live trading açma/i.test(s)),
    ).toBe(true);
    // /fapi
    expect(
      PROMPT_SAFETY_CHECKLIST.some((s) => /\/fapi\/v1\/order/.test(s)),
    ).toBe(true);
    expect(
      PROMPT_SAFETY_CHECKLIST.some((s) => /\/fapi\/v1\/leverage/.test(s)),
    ).toBe(true);
    // env / mode
    expect(
      PROMPT_SAFETY_CHECKLIST.some((s) =>
        /HARD_LIVE_TRADING_ALLOWED=false/.test(s),
      ),
    ).toBe(true);
    expect(
      PROMPT_SAFETY_CHECKLIST.some((s) => /DEFAULT_TRADING_MODE=paper/.test(s)),
    ).toBe(true);
    expect(
      PROMPT_SAFETY_CHECKLIST.some((s) => /enable_live_trading=false/.test(s)),
    ).toBe(true);
    expect(
      PROMPT_SAFETY_CHECKLIST.some((s) =>
        /openLiveOrder.*LIVE_EXECUTION_NOT_IMPLEMENTED/i.test(s),
      ),
    ).toBe(true);
    // bypass / signal / btc trend
    expect(
      PROMPT_SAFETY_CHECKLIST.some((s) =>
        /Force.*aggressive.*learning bypass/i.test(s),
      ),
    ).toBe(true);
    expect(
      PROMPT_SAFETY_CHECKLIST.some((s) =>
        /MIN_SIGNAL_CONFIDENCE=70/.test(s),
      ),
    ).toBe(true);
    expect(
      PROMPT_SAFETY_CHECKLIST.some((s) => /BTC trend filtresi/i.test(s)),
    ).toBe(true);
  });
});

describe("Üretilen prompt içeriği — live safety invariants", () => {
  it("üretilen prompt her zaman zorunlu safety satırlarını içerir", () => {
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

  it("prompt içinde 'HARD_LIVE_TRADING_ALLOWED=true' talimatı YOK", () => {
    const out = buildCodePrompt({
      plan: plan(),
      request: {
        planId: plan().id,
        actionType: plan().type,
        target: "claude_code",
        scope: "safety_audit",
        includeSafetyChecklist: true,
        includeDeployChecklist: true,
      },
    });
    expect(out.prompt).not.toMatch(/HARD_LIVE_TRADING_ALLOWED\s*=\s*true/);
    expect(out.prompt).not.toMatch(/enable_live_trading\s*=\s*true/);
  });

  it("prompt içinde /fapi/v1/order veya /fapi/v1/leverage 'ekle' talimatı YOK", () => {
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
    // safety bloğunda "eklenmeyecek" geçer; "ekle/add" şeklinde aksiyon talimatı geçmez.
    expect(out.prompt).not.toMatch(/(ekle|add|implement)\s+\/fapi\/v1\//i);
  });

  it("prompt içinde MIN_SIGNAL_CONFIDENCE düşürme talimatı YOK", () => {
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
    expect(out.prompt).not.toMatch(
      /MIN_SIGNAL_CONFIDENCE\s*=\s*[0-6]\d?\b/,
    );
  });
});

describe("UI — /ai-actions Prompt modal", () => {
  const page = read("src/app/ai-actions/page.tsx");

  it("PromptModal bileşeni tanımlı", () => {
    expect(page).toMatch(/function\s+PromptModal\s*\(/);
  });

  it("/api/ai-actions/prompt endpoint'ine POST yapar", () => {
    expect(page).toMatch(/\/api\/ai-actions\/prompt/);
    expect(page).toMatch(/method:\s*['"`]POST['"`]/);
  });

  it("confirmGenerate: true literal POST gövdesinde geçer", () => {
    expect(page).toMatch(/confirmGenerate:\s*true/);
  });

  it("hedef araç (Claude Code / Codex) ve kapsam seçimi var", () => {
    expect(page).toMatch(/CODE_PROMPT_TARGETS/);
    expect(page).toMatch(/CODE_PROMPT_SCOPES/);
    expect(page).toMatch(/recommendPromptTarget/);
  });

  it("ESC ile kapatma listener tanımlı", () => {
    expect(page).toMatch(/key === ['"]Escape['"]/);
  });

  it("'Prompt' filtresi history UI'da yer alır", () => {
    expect(page).toMatch(/{ key: "prompt", label: "Prompt" }/);
  });

  it("Binance private endpoint referansı yok", () => {
    expect(page).not.toMatch(/\/fapi\/v1\/order/);
    expect(page).not.toMatch(/\/fapi\/v1\/leverage/);
  });

  it("HARD_LIVE_TRADING_ALLOWED=true ataması yok", () => {
    expect(page).not.toMatch(/HARD_LIVE_TRADING_ALLOWED\s*=\s*true/);
  });
});

describe("history mapping — Faz 6 prompt event tipleri", () => {
  it("AI_ACTION_EVENT_TYPES prompt eventlerini içerir", async () => {
    const { AI_ACTION_EVENT_TYPES } = await import("@/lib/ai-actions");
    expect(AI_ACTION_EVENT_TYPES).toContain("ai_action_prompt_requested");
    expect(AI_ACTION_EVENT_TYPES).toContain("ai_action_prompt_generated");
    expect(AI_ACTION_EVENT_TYPES).toContain("ai_action_prompt_blocked");
    expect(AI_ACTION_EVENT_TYPES).toContain("ai_action_prompt_failed");
  });

  it("history mapper prompt eventlerini doğru kategoriye yerleştirir", async () => {
    const { mapHistoryItem } = await import("@/lib/ai-actions");
    const a = mapHistoryItem({
      id: "1",
      event_type: "ai_action_prompt_generated",
      message: "x",
      metadata: { promptId: "prm:claude_code:abc" },
      created_at: FROZEN,
    });
    expect(a?.category).toBe("prompt");
    expect(a?.status).toBe("prompt_generated");

    const b = mapHistoryItem({
      id: "2",
      event_type: "ai_action_prompt_blocked",
      message: "x",
      metadata: { code: "FORBIDDEN_ACTION" },
      created_at: FROZEN,
    });
    expect(b?.category).toBe("prompt");
    expect(b?.status).toBe("prompt_blocked");

    const c = mapHistoryItem({
      id: "3",
      event_type: "ai_action_prompt_failed",
      message: "x",
      metadata: {},
      created_at: FROZEN,
    });
    expect(c?.category).toBe("prompt");
    expect(c?.status).toBe("prompt_failed");
  });
});

describe("history endpoint — prompt category/status whitelist", () => {
  const route = read("src/app/api/ai-actions/history/route.ts");

  it("VALID_CATEGORIES prompt'u içerir", () => {
    expect(route).toMatch(/"prompt"/);
  });

  it("VALID_STATUSES prompt status'larını içerir", () => {
    expect(route).toMatch(/"prompt_generated"/);
    expect(route).toMatch(/"prompt_blocked"/);
    expect(route).toMatch(/"prompt_failed"/);
  });
});

describe("Secret-like metadata — prompt event'leri için sanitize çalışır", () => {
  it("prompt metadata içinde apiKey redact edilir", async () => {
    const { sanitizeMetadata } = await import("@/lib/ai-actions");
    const out = sanitizeMetadata({
      planId: "p1",
      target: "claude_code",
      apiKey: "sk-leak",
      authorization: "Bearer abc",
      promptLength: 1234,
    });
    expect(out.apiKey).toBe("[REDACTED]");
    expect(out.authorization).toBe("[REDACTED]");
    expect(out.promptLength).toBe(1234);
    expect(out.target).toBe("claude_code");
  });
});
