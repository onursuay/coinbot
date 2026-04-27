// Strategy health score calculator — produces 0-100 score from closed paper trades.
// Score below minStrategyHealthScoreToTrade (default 60) blocks new trades.

import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export interface StrategyHealthMetrics {
  totalTrades: number;
  winRate: number;           // 0-1
  profitFactor: number;      // gross_profit / gross_loss, capped at 10
  maxDrawdown: number;       // USD, max consecutive loss streak value
  consecutiveLosses: number; // current streak of consecutive losses
  slHitRate: number;         // 0-1
  tpHitRate: number;         // 0-1
  avgRiskReward: number;
  score: number;             // 0-100
  blocked: boolean;          // score < threshold
  blockReason: string | null;
}

export async function calculateStrategyHealth(userId: string): Promise<StrategyHealthMetrics> {
  const empty: StrategyHealthMetrics = {
    totalTrades: 0, winRate: 0, profitFactor: 0, maxDrawdown: 0,
    consecutiveLosses: 0, slHitRate: 0, tpHitRate: 0, avgRiskReward: 0,
    score: 100, blocked: false, blockReason: null,
  };
  if (!supabaseConfigured()) return empty;

  const sb = supabaseAdmin();
  const { data: trades } = await sb
    .from("paper_trades")
    .select("pnl, exit_reason, risk_reward_ratio, entry_price, stop_loss, take_profit, direction, closed_at")
    .eq("user_id", userId)
    .not("closed_at", "is", null)
    .order("closed_at", { ascending: true })
    .limit(200);

  if (!trades || trades.length === 0) return empty;

  let wins = 0, grossProfit = 0, grossLoss = 0, slHits = 0, tpHits = 0, rrSum = 0, rrCount = 0;
  let maxDrawdown = 0, runningLoss = 0;
  let consecutiveLosses = 0, currentStreak = 0;

  for (const t of trades) {
    const pnl = Number(t.pnl ?? 0);
    if (pnl >= 0) {
      wins++;
      grossProfit += pnl;
      currentStreak = 0;
    } else {
      grossLoss += Math.abs(pnl);
      currentStreak++;
      if (currentStreak > consecutiveLosses) consecutiveLosses = currentStreak;
    }

    // Track drawdown as running sum of losses
    runningLoss = pnl < 0 ? runningLoss + Math.abs(pnl) : 0;
    if (runningLoss > maxDrawdown) maxDrawdown = runningLoss;

    const reason = (t.exit_reason ?? "").toLowerCase();
    if (reason.includes("stop") || reason.includes("sl")) slHits++;
    if (reason.includes("take") || reason.includes("tp")) tpHits++;

    const rr = Number(t.risk_reward_ratio ?? 0);
    if (rr > 0) { rrSum += rr; rrCount++; }
  }

  const totalTrades = trades.length;
  const winRate = wins / totalTrades;
  const profitFactor = grossLoss > 0 ? Math.min(grossProfit / grossLoss, 10) : grossProfit > 0 ? 10 : 0;
  const slHitRate = totalTrades > 0 ? slHits / totalTrades : 0;
  const tpHitRate = totalTrades > 0 ? tpHits / totalTrades : 0;
  const avgRiskReward = rrCount > 0 ? rrSum / rrCount : 0;

  // Score formula (0-100):
  // winRate contributes 40 pts (40% win = 16 pts, 60% = 24 pts)
  // profitFactor contributes 30 pts (1.5 PF = 15 pts, 3.0 PF = 30 pts capped)
  // drawdown penalty: -5 per $100 drawdown, capped at -20
  // consecutive losses penalty: -5 per loss beyond 2, capped at -20
  // tp/sl ratio bonus: tpHitRate > slHitRate → +5
  const winScore = Math.min(winRate * 66.7, 40);
  const pfScore = Math.min((profitFactor / 3) * 30, 30);
  const ddPenalty = Math.min((maxDrawdown / 100) * 5, 20);
  const streakPenalty = Math.min(Math.max(0, consecutiveLosses - 2) * 5, 20);
  const rrBonus = avgRiskReward >= 2 ? 10 : avgRiskReward >= 1.5 ? 5 : 0;
  const tpBonus = tpHitRate > slHitRate ? 5 : 0;

  const raw = winScore + pfScore - ddPenalty - streakPenalty + rrBonus + tpBonus;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  const threshold = env.minStrategyHealthScoreToTrade;
  const blocked = totalTrades >= 10 && score < threshold;
  const blockReason = blocked
    ? `Strateji sağlık skoru ${score}/100 (min ${threshold} gerekli)`
    : null;

  return {
    totalTrades, winRate, profitFactor, maxDrawdown, consecutiveLosses,
    slHitRate, tpHitRate, avgRiskReward, score, blocked, blockReason,
  };
}

export async function persistStrategyHealth(userId: string, metrics: StrategyHealthMetrics): Promise<void> {
  if (!supabaseConfigured()) return;
  const today = new Date().toISOString().slice(0, 10);
  await supabaseAdmin()
    .from("strategy_health")
    .upsert({
      user_id: userId,
      date: today,
      win_rate: metrics.winRate,
      profit_factor: metrics.profitFactor,
      max_drawdown_percent: metrics.maxDrawdown,
      consecutive_losses: metrics.consecutiveLosses,
      stop_loss_hit_rate: metrics.slHitRate,
      take_profit_hit_rate: metrics.tpHitRate,
      score: metrics.score,
      metrics_json: { winRate: metrics.winRate, profitFactor: metrics.profitFactor, avgRiskReward: metrics.avgRiskReward },
    }, { onConflict: "user_id,date" });
}
