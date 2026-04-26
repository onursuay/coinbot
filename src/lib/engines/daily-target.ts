// Günlük kâr hedefi yardımcıları.

import { env } from "@/lib/env";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";

export interface DailyStatus {
  dailyTargetUsd: number;
  realizedPnlUsd: number;
  remainingToTargetUsd: number;
  targetHit: boolean;
  conservativeMode: boolean;
  dailyLossLimitUsd: number;
  lossLimitHit: boolean;
}

export async function getDailyStatus(userId: string, accountBalanceUsd: number): Promise<DailyStatus> {
  const dailyTargetUsd = env.dailyProfitTargetUsd;
  const dailyLossLimitUsd = -(accountBalanceUsd * env.maxDailyLossPercent) / 100;
  let realized = 0;
  if (supabaseConfigured()) {
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    const { data } = await supabaseAdmin()
      .from("paper_trades")
      .select("pnl, status, closed_at")
      .eq("user_id", userId)
      .eq("status", "closed")
      .gte("closed_at", start.toISOString());
    realized = (data ?? []).reduce((s, r) => s + Number(r.pnl ?? 0), 0);
  }
  const remaining = Math.max(0, dailyTargetUsd - realized);
  return {
    dailyTargetUsd,
    realizedPnlUsd: realized,
    remainingToTargetUsd: remaining,
    targetHit: realized >= dailyTargetUsd,
    conservativeMode: false,
    dailyLossLimitUsd,
    lossLimitHit: realized <= dailyLossLimitUsd,
  };
}
