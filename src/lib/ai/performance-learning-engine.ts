// Performance learning engine — daily/weekly summary generator.
// LLM produces narrative; the bot does NOT auto-apply suggestions.

import { runLlmAnalysis } from "./llm-analyzer";
import { PROMPT_DAILY_SUMMARY, PROMPT_WEEKLY_REVIEW } from "./prompt-templates";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";

export async function generateDailySummary(userId: string) {
  if (!supabaseConfigured()) return { ok: false, error: "Supabase not configured" };
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: trades } = await sb
    .from("paper_trades")
    .select("symbol, direction, pnl_usd, pnl_percent, leverage, status, close_reason")
    .eq("user_id", userId)
    .gte("opened_at", since);

  const { data: rejected } = await sb
    .from("signals")
    .select("symbol, signal_type, rejected_reason")
    .eq("user_id", userId)
    .gte("created_at", since)
    .not("rejected_reason", "is", null)
    .limit(100);

  const summary = {
    tradesOpened: trades?.length ?? 0,
    closed: trades?.filter((t) => t.status === "closed") ?? [],
    rejectedSignals: rejected ?? [],
  };

  return runLlmAnalysis({
    userId,
    runType: "daily_summary",
    promptTemplate: "daily_summary_v1",
    inputSummary: summary,
    prompt: PROMPT_DAILY_SUMMARY(summary),
  });
}

export async function generateWeeklyReview(userId: string) {
  if (!supabaseConfigured()) return { ok: false, error: "Supabase not configured" };
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: trades } = await sb
    .from("paper_trades")
    .select("symbol, pnl_usd, pnl_percent, status, opened_at, closed_at")
    .eq("user_id", userId)
    .gte("opened_at", since);

  const summary = { weekTrades: trades ?? [] };
  return runLlmAnalysis({
    userId,
    runType: "weekly_review",
    promptTemplate: "weekly_review_v1",
    inputSummary: summary,
    prompt: PROMPT_WEEKLY_REVIEW(summary),
  });
}
