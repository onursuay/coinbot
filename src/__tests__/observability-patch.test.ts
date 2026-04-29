// Observability Patch — test paketi
//
// Doğrulanacak invariantlar:
//   • AI endpoint ai_decision_requested log satırı içeriyor
//   • OpenAI key/secret log metadata'da YOK
//   • AI output status/actionType/confidence loglanıyor
//   • callAIDecision onLog callback doğru eventleri tetikliyor
//   • Logs API q parametresi ile arama davranışı
//   • Logs API limit clamp 1–1000 arası çalışıyor
//   • Logs search case-insensitive (buildIlikePattern)
//   • AI event label mapping doğru
//   • Trade logic / live gate değerleri değişmemiş
//   • Binance order/leverage endpoint yok
//   • OpenAI API key response/log içinde yok

import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  callAIDecision,
  buildAIDecisionContext,
  type AIDecisionContext,
} from "@/lib/ai-decision";

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const readFile = (rel: string) =>
  fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf-8");

// ── AI endpoint log invariantları ───────────────────────────────────────────

describe("AI endpoint — log invariantları", () => {
  const ROUTE = "src/app/api/ai-decision/interpret/route.ts";

  it("botLog import içeriyor", () => {
    expect(readFile(ROUTE)).toMatch(/from\s+["']@\/lib\/logger["']/);
  });

  it("ai_decision_requested log event var", () => {
    expect(readFile(ROUTE)).toContain("ai_decision_requested");
  });

  it("ai_context_built log event var", () => {
    expect(readFile(ROUTE)).toContain("ai_context_built");
  });

  it("OPENAI_API_KEY değeri loglanmıyor (sadece hasOpenAiKey boolean)", () => {
    const content = readFile(ROUTE);
    // apiKey değeri hiçbir zaman metadata'ya konmaz
    expect(content).not.toMatch(/metadata[^}]*apiKey\s*:/);
    expect(content).not.toMatch(/OPENAI_API_KEY.*metadata/);
    // hasOpenAiKey boolean log var
    expect(content).toContain("hasOpenAiKey");
  });

  it("ai_fallback_returned log event var", () => {
    expect(readFile(ROUTE)).toContain("ai_fallback_returned");
  });

  it("ai_decision_completed log event var", () => {
    expect(readFile(ROUTE)).toContain("ai_decision_completed");
  });

  it("status/actionType/confidence loglanıyor", () => {
    const content = readFile(ROUTE);
    expect(content).toContain("status: response.data.status");
    expect(content).toContain("actionType: response.data.actionType");
    expect(content).toContain("confidence: response.data.confidence");
  });

  it("/fapi/v1/order endpoint yok", () => {
    expect(readFile(ROUTE)).not.toMatch(/\/fapi\/v1\/order/);
  });

  it("/fapi/v1/leverage endpoint yok", () => {
    expect(readFile(ROUTE)).not.toMatch(/\/fapi\/v1\/leverage/);
  });
});

// ── AI client — onLog callback ───────────────────────────────────────────────

describe("AI client — onLog callback", () => {
  const baseCtx: AIDecisionContext = buildAIDecisionContext({
    closedTradesRecent: [],
    openPositions: [],
  });

  it("apiKey yoksa ai_fallback_returned onLog tetikleniyor", async () => {
    const events: string[] = [];
    await callAIDecision(baseCtx, {
      apiKey: null,
      model: "gpt-4o-mini",
      onLog: (event) => { events.push(event); },
    });
    expect(events).toContain("ai_fallback_returned");
  });

  it("onLog metadata'da apiKey değeri YOK", async () => {
    const metas: Record<string, unknown>[] = [];
    await callAIDecision(baseCtx, {
      apiKey: null,
      model: "gpt-4o-mini",
      onLog: (_, meta) => { metas.push(meta); },
    });
    const allMeta = JSON.stringify(metas);
    // apiKey değeri kesinlikle loglanmıyor
    expect(allMeta).not.toMatch(/sk-/);
    expect(allMeta).not.toContain("OPENAI_API_KEY");
    // hasOpenAiKey boolean olarak var
    expect(allMeta).toContain("hasOpenAiKey");
  });

  it("başarılı yanıtta ai_openai_call_started tetikleniyor", async () => {
    const events: string[] = [];
    const aiPayload = {
      status: "OBSERVE", riskLevel: "MEDIUM",
      mainFinding: "Test.", systemInterpretation: "—", recommendation: "7 gün.",
      actionType: "OBSERVE", confidence: 70, requiresUserApproval: false,
      observeDays: 7, blockedBy: [], suggestedPrompt: null, safetyNotes: ["AI uygulamaz."],
    };
    const fakeFetch = (async () => ({
      ok: true, status: 200,
      json: async () => ({ output_text: JSON.stringify(aiPayload) }),
    })) as unknown as typeof fetch;

    await callAIDecision(baseCtx, {
      apiKey: "sk-test-key",
      model: "gpt-4o-mini",
      fetchImpl: fakeFetch,
      onLog: (event) => { events.push(event); },
    });

    expect(events).toContain("ai_openai_call_started");
    expect(events).toContain("ai_prompt_generated");
    expect(events).toContain("ai_openai_call_succeeded");
    expect(events).toContain("ai_decision_output_normalized");
  });

  it("başarılı yanıtta ai_openai_call_succeeded metadata status/actionType/confidence içeriyor", async () => {
    const metas: Array<[string, Record<string, unknown>]> = [];
    const aiPayload = {
      status: "NO_ACTION", riskLevel: "LOW",
      mainFinding: "Sağlıklı.", systemInterpretation: "—", recommendation: "Devam.",
      actionType: "NO_ACTION", confidence: 85, requiresUserApproval: false,
      observeDays: 7, blockedBy: [], suggestedPrompt: null, safetyNotes: ["AI uygulamaz."],
    };
    const fakeFetch = (async () => ({
      ok: true, status: 200,
      json: async () => ({ output_text: JSON.stringify(aiPayload) }),
    })) as unknown as typeof fetch;

    await callAIDecision(baseCtx, {
      apiKey: "sk-test-key",
      model: "gpt-4o-mini",
      fetchImpl: fakeFetch,
      onLog: (event, meta) => { metas.push([event, meta]); },
    });

    const succeeded = metas.find(([e]) => e === "ai_openai_call_succeeded");
    expect(succeeded).toBeDefined();
    expect(succeeded![1].status).toBe("NO_ACTION");
    expect(succeeded![1].actionType).toBe("NO_ACTION");
    expect(succeeded![1].confidence).toBe(85);
  });

  it("HTTP 500 → ai_openai_call_failed tetikleniyor", async () => {
    const events: string[] = [];
    const fakeFetch = (async () => ({
      ok: false, status: 500,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    await callAIDecision(baseCtx, {
      apiKey: "sk-test-key",
      model: "gpt-4o-mini",
      fetchImpl: fakeFetch,
      onLog: (event) => { events.push(event); },
    });

    expect(events).toContain("ai_openai_call_failed");
    expect(events).not.toContain("ai_openai_call_succeeded");
  });

  it("onLog callback API key değeri içeren string üretmiyor", async () => {
    const fakeKey = "sk-test-supersecret-12345";
    const allLogData: string[] = [];
    await callAIDecision(baseCtx, {
      apiKey: fakeKey,
      model: "gpt-4o-mini",
      fetchImpl: (async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch,
      onLog: (event, meta) => {
        allLogData.push(event);
        allLogData.push(JSON.stringify(meta));
      },
    });
    const combined = allLogData.join(" ");
    expect(combined).not.toContain(fakeKey);
    expect(combined).not.toMatch(/sk-test/);
  });
});

// ── Logs API — search & filter davranışı ────────────────────────────────────

describe("Logs API route — search & params", () => {
  const ROUTE = "src/app/api/logs/route.ts";

  it("buildIlikePattern helper var (q search)", () => {
    expect(readFile(ROUTE)).toContain("buildIlikePattern");
  });

  it("q parametresi ile ilike search uygulanıyor", () => {
    expect(readFile(ROUTE)).toContain("ilike");
    expect(readFile(ROUTE)).toMatch(/url\.searchParams\.get\(["']q["']\)/);
  });

  it("limit clamp MAX_LIMIT ile sınırlanıyor", () => {
    const content = readFile(ROUTE);
    expect(content).toContain("MAX_LIMIT");
    expect(content).toMatch(/Math\.min\(MAX_LIMIT/);
  });

  it("% ve _ karakterleri escape ediliyor (SQL injection koruması)", () => {
    const content = readFile(ROUTE);
    expect(content).toContain("\\\\%");
    expect(content).toContain("\\\\_");
  });

  it("level parametresi destekleniyor", () => {
    expect(readFile(ROUTE)).toContain("levelFilter");
  });

  it("event parametresi destekleniyor", () => {
    expect(readFile(ROUTE)).toContain("eventFilter");
  });

  it("errorsOnly parametresi destekleniyor", () => {
    expect(readFile(ROUTE)).toContain("errorsOnly");
  });
});

// ── Logs UI — search alanı ──────────────────────────────────────────────────

describe("Logs UI — search input & AI labels", () => {
  const PAGE = "src/app/logs/page.tsx";

  it("search input var (Loglarda ara placeholder)", () => {
    expect(readFile(PAGE)).toContain("Loglarda ara");
  });

  it("debounce 300ms uygulanıyor", () => {
    expect(readFile(PAGE)).toContain("300");
  });

  it("AI event label mapping tanımlı", () => {
    const content = readFile(PAGE);
    expect(content).toContain("ai_decision_requested");
    expect(content).toContain("AI yorum isteği");
    expect(content).toContain("ai_openai_call_succeeded");
    expect(content).toContain("OpenAI çağrısı başarılı");
    expect(content).toContain("ai_fallback_returned");
    expect(content).toContain("AI fallback döndü");
    expect(content).toContain("ai_openai_call_failed");
    expect(content).toContain("OpenAI çağrısı başarısız");
  });

  it("formatEventLabel fonksiyonu var", () => {
    expect(readFile(PAGE)).toContain("formatEventLabel");
  });

  it("URL searchParams ile q parametresi okunuyor", () => {
    expect(readFile(PAGE)).toContain("searchParams.get");
  });
});

// ── AI Card status bar ───────────────────────────────────────────────────────

describe("AI Card — status bar", () => {
  const CARDS = "src/components/dashboard/Cards.tsx";

  it("hasOpenAiKey field AIDecisionCardInput'ta var", () => {
    expect(readFile(CARDS)).toContain("hasOpenAiKey");
  });

  it("model field AIDecisionCardInput'ta var", () => {
    const content = readFile(CARDS);
    const idx = content.indexOf("export interface AIDecisionCardInput");
    const section = content.slice(idx, idx + 1000);
    expect(section).toContain("model?");
  });

  it("lastCallAt field AIDecisionCardInput'ta var", () => {
    expect(readFile(CARDS)).toContain("lastCallAt");
  });

  it("AI durum çubuğu AKTİF/API KEY YOK/FALLBACK/HATA gösteriyor", () => {
    const content = readFile(CARDS);
    expect(content).toContain("AKTİF");
    expect(content).toContain("API KEY YOK");
    expect(content).toContain("FALLBACK");
    expect(content).toContain("HATA");
  });

  it("'AI fallback çalıştı' mesajı var", () => {
    expect(readFile(CARDS)).toContain("AI fallback çalıştı");
  });

  it("ONAYLA butonu YOK (canlı açan UI yok)", () => {
    const content = readFile(CARDS);
    const idx = content.indexOf("export function AIDecisionAssistantCard");
    const section = content.slice(idx).split("\nexport ")[0];
    expect(section).not.toMatch(/['"]ONAYLA['"]/);
  });
});

// ── Trade logic / live gate değişmedi ───────────────────────────────────────

describe("Trade logic — değişmedi sentinel", () => {
  it("HARD_LIVE_TRADING_ALLOWED env var hâlâ false", () => {
    const envContent = readFile("src/lib/env.ts");
    expect(envContent).toContain("hardLiveTradingAllowed");
    expect(envContent).not.toMatch(/hardLiveTradingAllowed:\s*true/);
  });

  it("averageDownEnabled false kalıyor", () => {
    const route = readFile("src/app/api/ai-decision/interpret/route.ts");
    expect(route).toContain("averageDownEnabled: false");
  });

  it("openLiveOrder LIVE_EXECUTION_NOT_IMPLEMENTED", () => {
    const liveExec = fs.readdirSync(
      path.join(PROJECT_ROOT, "src/lib/live-execution"),
    ).map((f) =>
      readFile(`src/lib/live-execution/${f}`)
    ).join("\n");
    expect(liveExec).toContain("LIVE_EXECUTION_NOT_IMPLEMENTED");
  });
});
