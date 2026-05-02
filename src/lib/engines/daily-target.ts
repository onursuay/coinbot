// Günlük kâr hedefi yardımcıları.

import { env } from "@/lib/env";
import { getPaperTradeStats } from "@/lib/dashboard/paper-stats";

export interface DailyStatus {
  dailyTargetUsd: number;
  realizedPnlUsd: number;
  remainingToTargetUsd: number;
  targetHit: boolean;
  conservativeMode: boolean;
  dailyLossLimitUsd: number;
  lossLimitHit: boolean;
}

export interface DailyStatusOptions {
  /** Override daily max loss percent from risk settings (falls back to env when undefined). */
  dailyMaxLossPercent?: number;
}

export async function getDailyStatus(
  userId: string,
  accountBalanceUsd: number,
  opts?: DailyStatusOptions,
): Promise<DailyStatus> {
  const dailyTargetUsd = env.dailyProfitTargetUsd;
  // Faz 20: use risk settings dailyMaxLossPercent when provided; env is fallback.
  const effectiveDailyMaxLossPct = opts?.dailyMaxLossPercent ?? env.maxDailyLossPercent;
  const dailyLossLimitUsd = -(accountBalanceUsd * effectiveDailyMaxLossPct) / 100;
  // Canonical source — same aggregation that powers Panel Toplam K/Z and the
  // Sanal İşlemler closed-trades table. Keeps Günlük K/Z and Toplam K/Z
  // numerically consistent with the per-row pnl values shown to the user.
  const stats = await getPaperTradeStats(userId);
  const realized = stats.dailyPnl;
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
