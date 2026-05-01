// AI Karar Asistanı Patch — test paketi.
//
// Doğrulanan invariantlar:
//   • OPENAI_API_KEY yoksa fallback güvenli dönüyor
//   • AI context içinde secret pattern'ı yok
//   • Structured output schema validasyonu çalışıyor
//   • confidence 0–100 clamp ediliyor; observeDays default 14
//   • suggestedPrompt sadece PROMPT actionType için dolu
//   • Endpoint dosyasında /fapi/v1/order ve /fapi/v1/leverage YOK
//   • Endpoint trade açmaz / ayar değiştirmez (update sentinels)
//   • Dashboard kartında ONAYLA / canlı açma butonu yok
//   • Live readiness blockedBy ile uyumlu

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  AI_DECISION_JSON_SCHEMA,
  AI_DECISION_SYSTEM_PROMPT,
  buildAIDecisionContext,
  buildFallbackOutput,
  buildUserPrompt,
  callAIDecision,
  DEFAULT_OBSERVE_DAYS,
  normalizeAIDecisionOutput,
  readOpenAIConfigFromEnv,
  stripSecrets,
  type AIDecisionContext,
} from "@/lib/ai-decision";

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

// ── stripSecrets ─────────────────────────────────────────────────────────────

describe("AI Context — stripSecrets", () => {
  it("OpenAI sk- key'i redacts eder", () => {
    const out = stripSecrets({ note: "sk-proj-abcdef1234567890ABCDEFG" });
    expect(JSON.stringify(out)).not.toMatch(/sk-proj-abcdef/);
    expect((out as any).note).toContain("[REDACTED]");
  });

  it("apiKey alan adını redacts eder (değer ne olursa olsun)", () => {
    const out = stripSecrets({ apiKey: "abcdefghijk" }) as any;
    expect(out.apiKey).toBe("[REDACTED]");
  });

  it("apiSecret / passphrase / password / token alanları redacts edilir", () => {
    const out = stripSecrets({
      apiSecret: "x", passphrase: "y", password: "z", token: "t",
      service_role: "svc", privateKey: "pk", signature: "sig",
    }) as any;
    expect(out.apiSecret).toBe("[REDACTED]");
    expect(out.passphrase).toBe("[REDACTED]");
    expect(out.password).toBe("[REDACTED]");
    expect(out.token).toBe("[REDACTED]");
    expect(out.service_role).toBe("[REDACTED]");
    expect(out.privateKey).toBe("[REDACTED]");
    expect(out.signature).toBe("[REDACTED]");
  });

  it("JWT pattern redacts edilir", () => {
    const jwt = "eyJabcdefghijklmnopqrstuv.eyJabcdefghijklmnopqrstuv.signaturepartabcdefghijklmnopqrstuv";
    const out = stripSecrets({ payload: jwt }) as any;
    expect(out.payload).toContain("[REDACTED]");
  });

  it("Nested obje ve diziler içinde redacts uygular", () => {
    const out = stripSecrets({
      level: { deep: { apiKey: "abc", inner: ["sk-proj-xxxyyyy1234567890abcd"] } },
    }) as any;
    expect(out.level.deep.apiKey).toBe("[REDACTED]");
    expect(JSON.stringify(out)).not.toMatch(/sk-proj-xxxyyyy/);
  });

  it("Normal değerleri bozmaz", () => {
    const out = stripSecrets({ symbol: "BTCUSDT", price: 50000 }) as any;
    expect(out.symbol).toBe("BTCUSDT");
    expect(out.price).toBe(50000);
  });
});

// ── buildAIDecisionContext ────────────────────────────────────────────────────

describe("AI Context — buildAIDecisionContext", () => {
  it("Boş input ile güvenli minimum context üretir", () => {
    const ctx = buildAIDecisionContext({});
    expect(ctx.mode).toBe("paper");
    expect(ctx.scanRowsCount).toBe(0);
    expect(ctx.closedTradesRecent).toEqual([]);
    expect(ctx.openPositions).toEqual([]);
    expect(ctx.generatedAt).toBeTruthy();
  });

  it("closedTradesRecent en fazla 20 trade içerir", () => {
    const trades = Array.from({ length: 50 }, (_, i) => ({
      symbol: `T${i}`, direction: "LONG" as const, pnlPercent: 1,
      riskRewardRatio: 2, exitReason: null, signalScore: 75,
    }));
    const ctx = buildAIDecisionContext({ closedTradesRecent: trades });
    expect(ctx.closedTradesRecent).toHaveLength(20);
  });

  it("openPositions en fazla 10 pozisyon içerir", () => {
    const pos = Array.from({ length: 25 }, (_, i) => ({
      symbol: `P${i}`, direction: "LONG" as const, entryPrice: 1,
      stopLoss: 0.95, takeProfit: 1.1, unrealizedPnlUsd: 0, pmAction: null,
    }));
    const ctx = buildAIDecisionContext({ openPositions: pos });
    expect(ctx.openPositions).toHaveLength(10);
  });

  it("Context içine sızdırılan secret pattern temizlenir", () => {
    // Riskçonfig benzeri bir alana sızdırma denemesi
    const ctx = buildAIDecisionContext({
      diagnostics: {
        workerOnline: true,
        workerStatus: "running_paper",
        websocketStatus: "connected",
        binanceApiStatus: "ok",
        tickSkipped: false,
        skipReason: null,
        tradingMode: "paper",
        hardLiveTradingAllowed: false,
        enableLiveTrading: false,
      },
      // Geçersiz alan ama runtime'da serializasyon sırasında secret içerebilir
      // diye stripSecrets'in sonuna geçtiğini garantileyelim:
      ...({ apiKey: "leakedAttempt12345678" } as any),
    });
    const json = JSON.stringify(ctx);
    expect(json).not.toMatch(/leakedAttempt/);
  });
});

// ── normalizeAIDecisionOutput ─────────────────────────────────────────────────

describe("Schema — normalizeAIDecisionOutput", () => {
  it("Geçersiz input'u DATA_INSUFFICIENT'a düşürür", () => {
    const out = normalizeAIDecisionOutput(null);
    expect(out.status).toBe("DATA_INSUFFICIENT");
    expect(out.actionType).toBe("DATA_INSUFFICIENT");
    expect(out.confidence).toBe(0);
    expect(out.observeDays).toBe(DEFAULT_OBSERVE_DAYS);
    expect(out.appliedToTradeEngine).toBe(false);
  });

  it("confidence 0–100 dışı değerleri clamp'ler", () => {
    expect(normalizeAIDecisionOutput({ confidence: -50 }).confidence).toBe(0);
    expect(normalizeAIDecisionOutput({ confidence: 250 }).confidence).toBe(100);
    expect(normalizeAIDecisionOutput({ confidence: 75 }).confidence).toBe(75);
    expect(normalizeAIDecisionOutput({ confidence: NaN as any }).confidence).toBe(0);
  });

  it("observeDays default 14", () => {
    expect(normalizeAIDecisionOutput({}).observeDays).toBe(14);
    expect(normalizeAIDecisionOutput({ observeDays: 7 }).observeDays).toBe(7);
    expect(normalizeAIDecisionOutput({ observeDays: -5 }).observeDays).toBe(0);
    expect(normalizeAIDecisionOutput({ observeDays: 1000 }).observeDays).toBe(365);
  });

  it("suggestedPrompt sadece PROMPT actionType için dolu", () => {
    const promptCase = normalizeAIDecisionOutput({
      actionType: "PROMPT",
      suggestedPrompt: "Risk ayarını gözden geçir.",
    });
    expect(promptCase.suggestedPrompt).toBe("Risk ayarını gözden geçir.");

    const otherCase = normalizeAIDecisionOutput({
      actionType: "OBSERVE",
      suggestedPrompt: "Bu prompt görünmemeli.",
    });
    expect(otherCase.suggestedPrompt).toBeNull();
  });

  it("blockedBy sadece string array tutar, max 20", () => {
    const out = normalizeAIDecisionOutput({
      blockedBy: Array.from({ length: 50 }, (_, i) => `B${i}`),
    });
    expect(out.blockedBy).toHaveLength(20);
  });

  it("appliedToTradeEngine daima false", () => {
    const out = normalizeAIDecisionOutput({
      // false olmasını sağlayan literal — runtime'da yine false döner
      appliedToTradeEngine: true as any,
    });
    expect(out.appliedToTradeEngine).toBe(false);
  });

  it("Geçersiz status DATA_INSUFFICIENT'a düşer", () => {
    const out = normalizeAIDecisionOutput({ status: "INVALID_STATUS" as any });
    expect(out.status).toBe("DATA_INSUFFICIENT");
  });

  it("Geçersiz actionType DATA_INSUFFICIENT'a düşer", () => {
    const out = normalizeAIDecisionOutput({ actionType: "AUTO_EXECUTE" as any });
    expect(out.actionType).toBe("DATA_INSUFFICIENT");
  });
});

// ── Schema yapı kontrolleri ──────────────────────────────────────────────────

describe("Schema — JSON Schema yapı", () => {
  it("ai_decision schema strict ve required alanlar tam", () => {
    expect(AI_DECISION_JSON_SCHEMA.name).toBe("ai_decision");
    expect(AI_DECISION_JSON_SCHEMA.strict).toBe(true);
    const required = AI_DECISION_JSON_SCHEMA.schema.required;
    expect(required).toContain("status");
    expect(required).toContain("riskLevel");
    expect(required).toContain("confidence");
    expect(required).toContain("observeDays");
    expect(required).toContain("blockedBy");
    expect(required).toContain("suggestedPrompt");
    expect(required).toContain("safetyNotes");
  });

  it("confidence 0–100 minimum/maximum", () => {
    const conf = AI_DECISION_JSON_SCHEMA.schema.properties.confidence as any;
    expect(conf.minimum).toBe(0);
    expect(conf.maximum).toBe(100);
  });
});

// ── Fallback ──────────────────────────────────────────────────────────────────

describe("Fallback", () => {
  it("AI_UNCONFIGURED → recommendation OpenAI key yokunu söyler", () => {
    const out = buildFallbackOutput("AI_UNCONFIGURED");
    expect(out.status).toBe("DATA_INSUFFICIENT");
    expect(out.mainFinding).toContain("OpenAI API anahtarı");
    expect(out.appliedToTradeEngine).toBe(false);
    expect(out.actionType).toBe("DATA_INSUFFICIENT");
    expect(out.blockedBy).toContain("AI_UNCONFIGURED");
  });

  it("AI_TIMEOUT, AI_PARSE_ERROR, AI_HTTP_ERROR, AI_DISABLED tutarlı output üretir", () => {
    for (const r of ["AI_TIMEOUT", "AI_PARSE_ERROR", "AI_HTTP_ERROR", "AI_DISABLED"] as const) {
      const out = buildFallbackOutput(r);
      expect(out.status).toBe("DATA_INSUFFICIENT");
      expect(out.appliedToTradeEngine).toBe(false);
      expect(out.confidence).toBe(0);
    }
  });

  it("Fallback output tüm safety notes minimum 1 not içerir", () => {
    const out = buildFallbackOutput("AI_UNCONFIGURED");
    expect(out.safetyNotes.length).toBeGreaterThan(0);
  });
});

// ── Client (offline / fallback) ──────────────────────────────────────────────

describe("Client — callAIDecision", () => {
  const baseCtx: AIDecisionContext = buildAIDecisionContext({
    closedTradesRecent: [],
    openPositions: [],
  });

  it("apiKey yoksa AI_UNCONFIGURED fallback döner", async () => {
    const res = await callAIDecision(baseCtx, { apiKey: null, model: "gpt-4o-mini" });
    expect(res.ok).toBe(false);
    expect(res.fallback).toBe("AI_UNCONFIGURED");
    expect(res.data.status).toBe("DATA_INSUFFICIENT");
  });

  it("Boş apiKey (string) AI_UNCONFIGURED fallback döner", async () => {
    const res = await callAIDecision(baseCtx, { apiKey: "" as any, model: "gpt-4o-mini" });
    // Empty string → falsy → AI_UNCONFIGURED
    expect(res.fallback).toBe("AI_UNCONFIGURED");
  });

  it("HTTP 500 dönerse AI_HTTP_ERROR fallback", async () => {
    const fakeFetch = (async () => ({
      ok: false, status: 500, json: async () => ({}),
    })) as unknown as typeof fetch;
    const res = await callAIDecision(baseCtx, {
      apiKey: "sk-test", model: "gpt-4o-mini", fetchImpl: fakeFetch,
    });
    expect(res.fallback).toBe("AI_HTTP_ERROR");
  });

  it("Geçerli output_text JSON döndüğünde normalized output üretir", async () => {
    const aiPayload = {
      status: "OBSERVE",
      riskLevel: "MEDIUM",
      mainFinding: "Risk ayarını gözden geçirin.",
      systemInterpretation: "Yüksek risk + düşük win rate.",
      recommendation: "7 gün gözlem.",
      actionType: "OBSERVE",
      confidence: 65,
      requiresUserApproval: false,
      observeDays: 7,
      blockedBy: [],
      suggestedPrompt: null,
      safetyNotes: ["AI uygulamaz."],
    };
    const fakeFetch = (async () => ({
      ok: true, status: 200,
      json: async () => ({ output_text: JSON.stringify(aiPayload) }),
    })) as unknown as typeof fetch;
    const res = await callAIDecision(baseCtx, {
      apiKey: "sk-test", model: "gpt-4o-mini", fetchImpl: fakeFetch,
    });
    expect(res.ok).toBe(true);
    expect(res.data.status).toBe("OBSERVE");
    expect(res.data.confidence).toBe(65);
    expect(res.data.appliedToTradeEngine).toBe(false);
    expect(res.meta.binanceApiCalled).toBe(false);
  });

  it("Geçersiz JSON output_text → AI_PARSE_ERROR", async () => {
    const fakeFetch = (async () => ({
      ok: true, status: 200,
      json: async () => ({ output_text: "not-json {{{" }),
    })) as unknown as typeof fetch;
    const res = await callAIDecision(baseCtx, {
      apiKey: "sk-test", model: "gpt-4o-mini", fetchImpl: fakeFetch,
    });
    expect(res.fallback).toBe("AI_PARSE_ERROR");
  });

  it("output_text yoksa output[].content[].text alternatifinden okur", async () => {
    const aiPayload = {
      status: "NO_ACTION", riskLevel: "LOW",
      mainFinding: "Sağlıklı.", systemInterpretation: "—", recommendation: "Devam.",
      actionType: "NO_ACTION", confidence: 80, requiresUserApproval: false,
      observeDays: 7, blockedBy: [], suggestedPrompt: null, safetyNotes: ["AI uygulamaz."],
    };
    const fakeFetch = (async () => ({
      ok: true, status: 200,
      json: async () => ({
        output: [{ content: [{ type: "output_text", text: JSON.stringify(aiPayload) }] }],
      }),
    })) as unknown as typeof fetch;
    const res = await callAIDecision(baseCtx, {
      apiKey: "sk-test", model: "gpt-4o-mini", fetchImpl: fakeFetch,
    });
    expect(res.ok).toBe(true);
    expect(res.data.status).toBe("NO_ACTION");
  });
});

// ── readOpenAIConfigFromEnv ───────────────────────────────────────────────────

describe("Env config", () => {
  it("OPENAI_API_KEY yoksa apiKey null döner", () => {
    const orig = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const cfg = readOpenAIConfigFromEnv();
    expect(cfg.apiKey).toBeNull();
    if (orig !== undefined) process.env.OPENAI_API_KEY = orig;
  });

  it("OPENAI_MODEL yoksa default model gpt-4o-mini", () => {
    const orig = process.env.OPENAI_MODEL;
    delete process.env.OPENAI_MODEL;
    const cfg = readOpenAIConfigFromEnv();
    expect(cfg.model).toBe("gpt-4o-mini");
    if (orig !== undefined) process.env.OPENAI_MODEL = orig;
  });
});

// ── System prompt invariantları ──────────────────────────────────────────────

describe("System prompt", () => {
  it("Yorumlayıcı/uygulayıcı kuralı içerir", () => {
    expect(AI_DECISION_SYSTEM_PROMPT).toContain("yorumlayıcı");
    expect(AI_DECISION_SYSTEM_PROMPT).toContain("uygulayıcı");
  });

  it("100 paper trade kuralını içerir", () => {
    expect(AI_DECISION_SYSTEM_PROMPT).toContain("100");
    expect(AI_DECISION_SYSTEM_PROMPT.toLowerCase()).toContain("paper");
  });

  it("Live readiness blocker kuralını içerir", () => {
    expect(AI_DECISION_SYSTEM_PROMPT).toContain("LIVE_READINESS_BLOCKED");
  });

  it("Finansal garanti yasağını içerir", () => {
    expect(AI_DECISION_SYSTEM_PROMPT.toLowerCase()).toContain("garanti");
  });

  it("buildUserPrompt context'i çerçeveler", () => {
    const out = buildUserPrompt("{\"x\":1}");
    expect(out).toContain("ai_decision");
    expect(out).toContain("{\"x\":1}");
  });
});

// ── Endpoint dosyasında yasaklı path / ayar değişikliği YOK ──────────────────

describe("Endpoint Read-only Invariants", () => {
  const ENDPOINT_PATH = path.join(
    PROJECT_ROOT,
    "src/app/api/ai-decision/interpret/route.ts",
  );

  it("Endpoint dosyası mevcut", () => {
    expect(fs.existsSync(ENDPOINT_PATH)).toBe(true);
  });

  it("Endpoint /fapi/v1/order çağrısı içermez", () => {
    const content = fs.readFileSync(ENDPOINT_PATH, "utf-8");
    expect(content).not.toMatch(/\/fapi\/v1\/order/);
  });

  it("Endpoint /fapi/v1/leverage çağrısı içermez", () => {
    const content = fs.readFileSync(ENDPOINT_PATH, "utf-8");
    expect(content).not.toMatch(/\/fapi\/v1\/leverage/);
  });

  it("Endpoint openLiveOrder import / call içermez", () => {
    const content = fs.readFileSync(ENDPOINT_PATH, "utf-8");
    expect(content).not.toMatch(/openLiveOrder\s*\(/);
    expect(content).not.toMatch(/from\s+["']@\/lib\/live-execution/);
  });

  it("Endpoint trading_mode / enable_live_trading / hardLive update etmez", () => {
    const content = fs.readFileSync(ENDPOINT_PATH, "utf-8");
    expect(content).not.toMatch(/\.update\([^)]*trading_mode/);
    expect(content).not.toMatch(/\.update\([^)]*enable_live_trading/);
    expect(content).not.toMatch(/\.update\([^)]*hardLiveTradingAllowed/);
    expect(content).not.toMatch(/\.update\([^)]*risk_settings/);
  });
});

// ── Dashboard kart güvenliği ─────────────────────────────────────────────────

describe("Dashboard Card Safety", () => {
  const CARDS_PATH = path.join(PROJECT_ROOT, "src/components/dashboard/Cards.tsx");

  it("AIDecisionAssistantCard dashboard'da export ediliyor", () => {
    const content = fs.readFileSync(CARDS_PATH, "utf-8");
    expect(content).toContain("export function AIDecisionAssistantCard");
  });

  it("AIDecisionAssistantCard ONAYLA butonu içermez (canlı açan UI yok)", () => {
    const content = fs.readFileSync(CARDS_PATH, "utf-8");
    const idx = content.indexOf("export function AIDecisionAssistantCard");
    expect(idx).toBeGreaterThan(-1);
    // AI kartından sonraki tüm bölüm — sonraki export ile sonlanır
    const after = content.slice(idx);
    const aiCardSection = after.split("\nexport ")[0];
    expect(aiCardSection).not.toMatch(/['"]ONAYLA['"]/);
  });

  it("AIDecisionAssistantCard PROMPT kopyalama butonu içeriyor (manuel)", () => {
    const content = fs.readFileSync(CARDS_PATH, "utf-8");
    const idx = content.indexOf("export function AIDecisionAssistantCard");
    const after = content.slice(idx);
    const aiCardSection = after.split("\nexport ")[0];
    // JSX'te &apos; ile yazıldığı için raw kaynakta `PROMPT&apos;U KOPYALA` olur.
    expect(aiCardSection).toMatch(/PROMPT(&apos;|')U KOPYALA/);
  });
});

// ── Genel invariant sentinels ─────────────────────────────────────────────────

describe("Invariant Sentinels", () => {
  it("Fallback output blockedBy içerir AI_UNCONFIGURED", () => {
    const f = buildFallbackOutput("AI_UNCONFIGURED");
    expect(f.blockedBy).toContain("AI_UNCONFIGURED");
  });

  it("normalizeAIDecisionOutput appliedToTradeEngine literal false", () => {
    const out = normalizeAIDecisionOutput({});
    const literal: false = out.appliedToTradeEngine;
    expect(literal).toBe(false);
  });

  it("Schema strict literal true", () => {
    const literal: true = AI_DECISION_JSON_SCHEMA.strict;
    expect(literal).toBe(true);
  });
});
