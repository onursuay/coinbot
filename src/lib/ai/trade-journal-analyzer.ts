// Trade journal analyzer — pulls last N closed trades, asks LLM to find patterns.
// Analysis only. No execution capability.

import { runLlmAnalysis } from "./llm-analyzer";
import { PROMPT_TRADE_JOURNAL } from "./prompt-templates";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";

export async function analyzeTradeJournal(userId: string, limit = 50) {
  if (!supabaseConfigured()) return { ok: false, error: "Supabase not configured" };
  const sb = supabaseAdmin();
  const { data: trades } = await sb
    .from("paper_trades")
    .select("symbol, direction, entry_price, exit_price, pnl_usd, pnl_percent, leverage, status, opened_at, closed_at, close_reason, signal_score, entry_reason")
    .eq("user_id", userId)
    .eq("status", "closed")
    .order("closed_at", { ascending: false })
    .limit(limit);

  const summary = {
    tradeCount: trades?.length ?? 0,
    trades: trades ?? [],
  };

  return runLlmAnalysis({
    userId,
    runType: "trade_journal",
    promptTemplate: "trade_journal_v1",
    inputSummary: summary,
    prompt: PROMPT_TRADE_JOURNAL(summary),
  });
}
