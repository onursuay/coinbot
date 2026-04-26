import { ok } from "@/lib/api-helpers";
import { env, SYSTEM_HARD_LEVERAGE_CAP } from "@/lib/env";
import { getDailyStatus } from "@/lib/engines/daily-target";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAPER_BALANCE = 1000;

export async function GET() {
  const userId = getCurrentUserId();
  const daily = await getDailyStatus(userId, PAPER_BALANCE);
  return ok({
    policy: {
      maxLeverage: env.maxLeverage,
      maxAllowedLeverage: env.maxAllowedLeverage,
      systemHardLeverageCap: SYSTEM_HARD_LEVERAGE_CAP,
      riskPerTradePercent: env.maxRiskPerTradePercent,
      maxDailyLossPercent: env.maxDailyLossPercent,
      maxWeeklyLossPercent: env.maxWeeklyLossPercent,
      dailyProfitTargetUsd: env.dailyProfitTargetUsd,
      maxDailyProfitTargetUsd: env.maxDailyProfitTargetUsd,
      maxOpenPositions: env.maxOpenPositions,
      minRiskRewardRatio: env.minRiskRewardRatio,
      defaultMarginMode: env.defaultMarginMode,
    },
    daily,
  });
}
