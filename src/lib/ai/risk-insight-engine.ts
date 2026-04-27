// Risk insight engine — analyzes risk-adjusted performance per tier.
// Outputs recommendations as RECOMMENDATIONS only (human approval required).

import { runLlmAnalysis } from "./llm-analyzer";
import { PROMPT_RISK_INSIGHT } from "./prompt-templates";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { classifyTier } from "@/lib/risk-tiers";

export async function generateRiskInsight(userId: string) {
  if (!supabaseConfigured()) return { ok: false, error: "Supabase not configured" };
  const sb = supabaseAdmin();

  const { data: trades } = await sb
    .from("paper_trades")
    .select("symbol, pnl_usd, pnl_percent, status, close_reason")
    .eq("user_id", userId)
    .eq("status", "closed")
    .order("closed_at", { ascending: false })
    .limit(200);

  // Group by tier
  const byTier: Record<string, { count: number; wins: number; losses: number; pnl: number }> = {};
  for (const t of trades ?? []) {
    const tier = classifyTier(t.symbol);
    const key = tier;
    byTier[key] ??= { count: 0, wins: 0, losses: 0, pnl: 0 };
    byTier[key].count++;
    if (Number(t.pnl_usd) > 0) byTier[key].wins++;
    else if (Number(t.pnl_usd) < 0) byTier[key].losses++;
    byTier[key].pnl += Number(t.pnl_usd ?? 0);
  }

  const summary = { byTier, totalTrades: trades?.length ?? 0 };

  return runLlmAnalysis({
    userId,
    runType: "risk_insight",
    promptTemplate: "risk_insight_v1",
    inputSummary: summary,
    prompt: PROMPT_RISK_INSIGHT(summary),
  });
}
