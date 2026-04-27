// Strategy reviewer — wrapper around llm-analyzer for strategy health analysis.
// Analysis only. Cannot modify configs.

import { runLlmAnalysis } from "./llm-analyzer";
import { PROMPT_STRATEGY_REVIEW } from "./prompt-templates";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";

export async function reviewStrategy(userId: string) {
  if (!supabaseConfigured()) return { ok: false, error: "Supabase not configured" };

  const sb = supabaseAdmin();
  const { data: latestHealth } = await sb
    .from("strategy_health")
    .select("*")
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .limit(7);

  const summary = {
    last7Days: latestHealth ?? [],
  };

  return runLlmAnalysis({
    userId,
    runType: "strategy_review",
    promptTemplate: "strategy_review_v1",
    inputSummary: summary,
    prompt: PROMPT_STRATEGY_REVIEW(summary),
  });
}
