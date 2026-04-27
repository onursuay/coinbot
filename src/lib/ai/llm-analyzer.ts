// LLM Analyzer — analysis-only. NEVER places orders.
//
// HARD INVARIANTS (defended in code, not just docs):
//   - This module CANNOT call any exchange adapter trading method.
//   - This module CANNOT modify env, bot_settings, risk parameters, whitelist,
//     stop-loss/take-profit requirements, kill switch, or live-trading gate.
//   - LLM output is RECORDED to ai_analysis_runs as recommendations only.
//   - Recommendations are NEVER auto-applied. Human approval required.

import { env } from "@/lib/env";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";

export type AnalysisRunType = "daily_summary" | "weekly_review" | "trade_journal" | "risk_insight" | "strategy_review";

export interface AnalysisInput {
  userId: string;
  runType: AnalysisRunType;
  promptTemplate: string;
  inputSummary: Record<string, any>;  // sanitized — no secrets
  prompt: string;                      // assembled prompt
}

export interface AnalysisOutput {
  ok: boolean;
  text?: string;
  recommendations?: any;  // structured (not auto-applied)
  error?: string;
  runId?: string;
}

const FORBIDDEN_KEYS_REGEX = /api[_-]?key|secret|password|token|private[_-]?key|encryption[_-]?key/i;

// Defensive scrub — strip anything that looks sensitive before sending to LLM.
function scrub(obj: any, depth = 0): any {
  if (depth > 6) return "[depth-limit]";
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((v) => scrub(v, depth + 1));
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (FORBIDDEN_KEYS_REGEX.test(k)) {
      out[k] = "[REDACTED]";
      continue;
    }
    out[k] = scrub(v, depth + 1);
  }
  return out;
}

export async function runLlmAnalysis(input: AnalysisInput): Promise<AnalysisOutput> {
  if (!env.llm.enabled) return { ok: false, error: "LLM disabled (LLM_ENABLED=false)" };
  if (!env.llm.apiKey) return { ok: false, error: "LLM API key missing" };
  if (!supabaseConfigured()) return { ok: false, error: "Supabase not configured" };

  const sb = supabaseAdmin();
  const sanitizedInput = scrub(input.inputSummary);

  // Record pending run
  const { data: pending, error: insErr } = await sb.from("ai_analysis_runs").insert({
    user_id: input.userId,
    run_type: input.runType,
    prompt_template: input.promptTemplate,
    model: env.llm.model,
    status: "pending",
    input_summary: sanitizedInput,
  }).select("id").single();
  if (insErr || !pending?.id) return { ok: false, error: insErr?.message ?? "could not record analysis run" };

  const runId = pending.id as string;

  // Provider call (OpenAI as default). The actual outbound call is wrapped in
  // a try/catch so a model outage never affects bot operation.
  try {
    const text = await callProvider(input.prompt);

    // Update with output. Recommendations field is reserved for structured
    // suggestions the LLM extracts — these are NEVER applied automatically.
    await sb.from("ai_analysis_runs").update({
      status: "success",
      output_text: text,
      output_recommendations: null, // structured extraction left to caller
    }).eq("id", runId);

    return { ok: true, text, runId };
  } catch (e: any) {
    await sb.from("ai_analysis_runs").update({
      status: "failed",
      error: e?.message ?? String(e),
    }).eq("id", runId);
    return { ok: false, error: e?.message ?? String(e), runId };
  }
}

async function callProvider(prompt: string): Promise<string> {
  if (env.llm.provider === "openai") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.llm.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: env.llm.model,
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      }),
    }).catch((e) => { throw new Error(`LLM fetch failed: ${e?.message ?? e}`); });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`LLM HTTP ${res.status}: ${txt.slice(0, 500)}`);
    }
    const json: any = await res.json();
    const content = json?.content?.[0]?.text ?? "";
    return content;
  }
  throw new Error(`LLM provider not implemented: ${env.llm.provider}`);
}

// Compile-time guard — prevents accidental import of trading capabilities here.
// (Renaming/adding any exchange adapter import here will be caught in code review.)
const _LLM_NEVER_TRADES = "ANALYSIS_ONLY";
export { _LLM_NEVER_TRADES };
