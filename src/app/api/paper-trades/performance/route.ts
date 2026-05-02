import { ok } from "@/lib/api-helpers";
import { getCurrentUserId } from "@/lib/auth";
import { getPaperTradeStats } from "@/lib/dashboard/paper-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const stats = await getPaperTradeStats(getCurrentUserId());
  return ok({
    totalTrades: stats.totalTrades,
    openTrades: stats.openTrades,
    winningTrades: stats.winningTrades,
    losingTrades: stats.losingTrades,
    breakEvenTrades: stats.breakEvenTrades,
    winRate: stats.winRate,
    totalPnl: stats.totalPnl,
    dailyPnl: stats.dailyPnl,
    closedToday: stats.closedToday,
    profitFactor: stats.profitFactor,
    maxDrawdown: stats.maxDrawdown,
    maxDrawdownPercent: stats.maxDrawdownPercent,
  });
}
