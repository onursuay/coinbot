// Live trading readiness assessment.
// The bot must complete a minimum number of paper trades with acceptable metrics
// before live trading is unlocked. This is a RECOMMENDATION — the human must
// still explicitly enable HARD_LIVE_TRADING_ALLOWED.

import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export interface LiveReadinessCheck {
  paperTradesCompleted: number;
  paperTradesRequired: number;
  profitFactor: number;
  profitFactorRequired: number;
  maxDrawdownPercent: number;
  maxDrawdownPercentAllowed: number;
  winRatePercent: number;
  winRatePercentRequired: number;
  strategyHealthScore: number;
  strategyHealthScoreRequired: number;
  checks: Array<{ name: string; passed: boolean; value: string; required: string }>;
  ready: boolean;
  blockers: string[];
}

export async function checkLiveReadiness(userId: string): Promise<LiveReadinessCheck> {
  const PAPER_REQUIRED = Number(process.env.MIN_PAPER_TRADES_BEFORE_LIVE ?? 100);
  const PF_REQUIRED = Number(process.env.MIN_PROFIT_FACTOR_FOR_LIVE ?? 1.3);
  const MAX_DD_PCT = Number(process.env.MAX_DRAWDOWN_FOR_LIVE_PERCENT ?? 10);
  const WIN_RATE_REQUIRED = Number(process.env.MIN_WIN_RATE_FOR_LIVE ?? 45);
  const HEALTH_REQUIRED = env.minStrategyHealthScoreToTrade;
  const PAPER_BALANCE = 1000;

  const notReady: LiveReadinessCheck = {
    paperTradesCompleted: 0, paperTradesRequired: PAPER_REQUIRED,
    profitFactor: 0, profitFactorRequired: PF_REQUIRED,
    maxDrawdownPercent: 0, maxDrawdownPercentAllowed: MAX_DD_PCT,
    winRatePercent: 0, winRatePercentRequired: WIN_RATE_REQUIRED,
    strategyHealthScore: 0, strategyHealthScoreRequired: HEALTH_REQUIRED,
    checks: [], ready: false, blockers: ["Supabase not configured"],
  };
  if (!supabaseConfigured()) return notReady;

  const sb = supabaseAdmin();
  const { data: trades } = await sb
    .from("paper_trades")
    .select("pnl, exit_reason, opened_at, closed_at, margin_used")
    .eq("user_id", userId)
    .not("closed_at", "is", null)
    .order("closed_at", { ascending: true })
    .limit(500);

  const closed = trades ?? [];
  const total = closed.length;

  let wins = 0, grossProfit = 0, grossLoss = 0;
  let peak = 0, equity = 0, maxDdUsd = 0;

  for (const t of closed) {
    const pnl = Number(t.pnl ?? 0);
    if (pnl > 0) { wins++; grossProfit += pnl; } else { grossLoss += Math.abs(pnl); }
    equity += pnl;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDdUsd) maxDdUsd = dd;
  }

  const winRate = total > 0 ? (wins / total) * 100 : 0;
  const pf = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;
  const ddPct = PAPER_BALANCE > 0 ? (maxDdUsd / PAPER_BALANCE) * 100 : 0;

  // Strategy health score (simplified inline — avoids circular import)
  let healthScore = 100;
  if (total >= 10) {
    const winScore = Math.min((winRate / 100) * 66.7, 40);
    const pfScore = Math.min((Math.min(pf, 3) / 3) * 30, 30);
    const ddPenalty = Math.min((maxDdUsd / 100) * 5, 20);
    healthScore = Math.max(0, Math.min(100, Math.round(winScore + pfScore - ddPenalty)));
  }

  const checks = [
    { name: "Paper Trades", passed: total >= PAPER_REQUIRED, value: `${total}`, required: `${PAPER_REQUIRED}` },
    { name: "Profit Factor", passed: pf >= PF_REQUIRED, value: pf.toFixed(2), required: PF_REQUIRED.toFixed(2) },
    { name: "Max Drawdown", passed: ddPct <= MAX_DD_PCT, value: `${ddPct.toFixed(1)}%`, required: `≤${MAX_DD_PCT}%` },
    { name: "Win Rate", passed: winRate >= WIN_RATE_REQUIRED, value: `${winRate.toFixed(1)}%`, required: `≥${WIN_RATE_REQUIRED}%` },
    { name: "Health Score", passed: healthScore >= HEALTH_REQUIRED, value: `${healthScore}/100`, required: `≥${HEALTH_REQUIRED}` },
  ];

  const blockers = checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.value} (gerekli ${c.required})`);

  return {
    paperTradesCompleted: total, paperTradesRequired: PAPER_REQUIRED,
    profitFactor: pf, profitFactorRequired: PF_REQUIRED,
    maxDrawdownPercent: ddPct, maxDrawdownPercentAllowed: MAX_DD_PCT,
    winRatePercent: winRate, winRatePercentRequired: WIN_RATE_REQUIRED,
    strategyHealthScore: healthScore, strategyHealthScoreRequired: HEALTH_REQUIRED,
    checks, ready: blockers.length === 0, blockers,
  };
}
