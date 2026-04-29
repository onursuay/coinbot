// AI Decision — OpenAI Responses API client.
//
// • Sadece yorum için kullanılır; hiçbir trade aksiyonu tetiklemez.
// • Binance API çağırmaz, ayar değiştirmez.
// • API key/secret response/log/error mesajı içine SIZINTI YAPMAZ.
// • Test edilebilirlik için fetch impl. injectable; default global fetch.

import {
  AI_DECISION_JSON_SCHEMA,
  normalizeAIDecisionOutput,
} from "./schema";
import {
  AI_REQUEST_TIMEOUT_MS,
  DEFAULT_OPENAI_MODEL,
  OPENAI_RESPONSES_ENDPOINT,
  type AIDecisionContext,
  type AIDecisionOutput,
  type AIDecisionResponse,
  type AIFallbackReason,
} from "./types";
import { AI_DECISION_SYSTEM_PROMPT, buildUserPrompt } from "./prompt";
import { buildFallbackOutput } from "./fallback";

export interface AIClientConfig {
  apiKey: string | null;
  model: string;
  timeoutMs?: number;
  /** Test edilebilirlik için injectable fetch impl. */
  fetchImpl?: typeof fetch;
  /** Observability: anahtar log olaylarını bildirir; asla throw etmez. */
  onLog?: (event: string, meta: Record<string, unknown>) => void;
}

export function readOpenAIConfigFromEnv(): { apiKey: string | null; model: string } {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = (process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL).trim();
  return {
    apiKey: apiKey && apiKey.length > 0 ? apiKey : null,
    model,
  };
}

/**
 * OpenAI Responses API çağrısı yapar; yapısal JSON çıktıyı normalize edip döner.
 * Hata durumunda asla throw etmez; fallback yanıt üretir.
 */
export async function callAIDecision(
  context: AIDecisionContext,
  config: AIClientConfig,
): Promise<AIDecisionResponse> {
  const startedAt = Date.now();
  const contextJson = JSON.stringify(context);
  const contextSizeChars = contextJson.length;
  const safeLog = config.onLog ?? (() => {});

  // 1. API key yok → fallback
  if (!config.apiKey) {
    safeLog("ai_fallback_returned", {
      model: config.model,
      hasOpenAiKey: false,
      fallbackReason: "AI_UNCONFIGURED",
      contextSizeApprox: contextSizeChars,
      durationMs: Date.now() - startedAt,
    });
    return wrapFallback("AI_UNCONFIGURED", config.model, contextSizeChars, startedAt);
  }

  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    safeLog("ai_fallback_returned", {
      model: config.model,
      hasOpenAiKey: true,
      fallbackReason: "AI_DISABLED",
      contextSizeApprox: contextSizeChars,
      durationMs: Date.now() - startedAt,
    });
    return wrapFallback("AI_DISABLED", config.model, contextSizeChars, startedAt);
  }

  const controller = new AbortController();
  const timeoutMs = config.timeoutMs ?? AI_REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    safeLog("ai_openai_call_started", {
      model: config.model,
      hasOpenAiKey: true,
      contextSizeApprox: contextSizeChars,
    });

    const userPrompt = buildUserPrompt(contextJson);
    safeLog("ai_prompt_generated", {
      model: config.model,
      promptSizeApprox: userPrompt.length,
    });

    const body = {
      model: config.model,
      input: [
        { role: "system" as const, content: AI_DECISION_SYSTEM_PROMPT },
        { role: "user" as const, content: userPrompt },
      ],
      text: {
        format: {
          type: "json_schema",
          name: AI_DECISION_JSON_SCHEMA.name,
          schema: AI_DECISION_JSON_SCHEMA.schema,
          strict: AI_DECISION_JSON_SCHEMA.strict,
        },
      },
    };

    const res = await fetchImpl(OPENAI_RESPONSES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      // HTTP hatası: secret sızıntısı önlemek için sadece status kodu loglanır.
      safeLog("ai_openai_call_failed", {
        model: config.model,
        hasOpenAiKey: true,
        fallbackReason: "AI_HTTP_ERROR",
        errorSafe: `HTTP ${res.status}`,
        durationMs: Date.now() - startedAt,
      });
      return wrapFallback("AI_HTTP_ERROR", config.model, contextSizeChars, startedAt);
    }

    const json: any = await res.json();

    // Responses API çıktı yapısı: output_text birleşik string ya da
    // output[0].content[0].text alanı. Önce output_text'e bakıyoruz.
    let textOut: string | null = null;
    if (typeof json?.output_text === "string" && json.output_text.length > 0) {
      textOut = json.output_text;
    } else if (Array.isArray(json?.output)) {
      // output: [{content:[{type:"output_text", text:"..."}]}]
      for (const item of json.output) {
        const contents = item?.content;
        if (Array.isArray(contents)) {
          for (const c of contents) {
            if (typeof c?.text === "string" && c.text.length > 0) {
              textOut = c.text;
              break;
            }
          }
        }
        if (textOut) break;
      }
    }

    if (!textOut) {
      safeLog("ai_openai_call_failed", {
        model: config.model,
        hasOpenAiKey: true,
        fallbackReason: "AI_PARSE_ERROR",
        errorSafe: "empty_output_text",
        durationMs: Date.now() - startedAt,
      });
      return wrapFallback("AI_PARSE_ERROR", config.model, contextSizeChars, startedAt);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(textOut);
    } catch {
      safeLog("ai_openai_call_failed", {
        model: config.model,
        hasOpenAiKey: true,
        fallbackReason: "AI_PARSE_ERROR",
        errorSafe: "json_parse_error",
        durationMs: Date.now() - startedAt,
      });
      return wrapFallback("AI_PARSE_ERROR", config.model, contextSizeChars, startedAt);
    }

    const data: AIDecisionOutput = normalizeAIDecisionOutput(parsed);

    safeLog("ai_decision_output_normalized", {
      model: config.model,
      status: data.status,
      actionType: data.actionType,
      riskLevel: data.riskLevel,
      confidence: data.confidence,
      blockedBy: data.blockedBy,
      durationMs: Date.now() - startedAt,
    });

    safeLog("ai_openai_call_succeeded", {
      model: config.model,
      status: data.status,
      actionType: data.actionType,
      confidence: data.confidence,
      durationMs: Date.now() - startedAt,
    });

    return {
      ok: true,
      data,
      fallback: null,
      meta: {
        model: config.model,
        durationMs: Date.now() - startedAt,
        contextSizeChars,
        appliedToTradeEngine: false,
        binanceApiCalled: false,
      },
    };
  } catch (err: any) {
    // AbortError → timeout; diğer her şey → AI_HTTP_ERROR
    const reason: AIFallbackReason = err?.name === "AbortError" ? "AI_TIMEOUT" : "AI_HTTP_ERROR";
    safeLog("ai_openai_call_failed", {
      model: config.model,
      hasOpenAiKey: true,
      fallbackReason: reason,
      errorSafe: reason === "AI_TIMEOUT" ? "request_timeout" : "fetch_error",
      durationMs: Date.now() - startedAt,
    });
    return wrapFallback(reason, config.model, contextSizeChars, startedAt);
  } finally {
    clearTimeout(timer);
  }
}

function wrapFallback(
  reason: AIFallbackReason,
  model: string | null,
  contextSizeChars: number,
  startedAt: number,
): AIDecisionResponse {
  return {
    ok: false,
    data: buildFallbackOutput(reason),
    fallback: reason,
    meta: {
      model,
      durationMs: Date.now() - startedAt,
      contextSizeChars,
      appliedToTradeEngine: false,
      binanceApiCalled: false,
    },
  };
}
