import { ok } from "@/lib/api-helpers";
import { getBotState } from "@/lib/engines/bot-orchestrator";
import { getDailyStatus } from "@/lib/engines/daily-target";
import { liveTradingEnabled } from "@/lib/engines/live-trading-guard";
import { getCurrentUserId } from "@/lib/auth";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAPER_BALANCE = 1000;

export async function GET() {
  const userId = getCurrentUserId();
  const state = await getBotState(userId);
  const daily = await getDailyStatus(userId, PAPER_BALANCE);
  let openCount = 0;
  if (supabaseConfigured()) {
    const { count } = await supabaseAdmin().from("paper_trades")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("status", "open");
    openCount = count ?? 0;
  }
  return ok({
    bot: state,
    daily,
    liveTrading: liveTradingEnabled(),
    openPositions: openCount,
    config: {
      maxLeverage: env.maxLeverage,
      maxAllowedLeverage: env.maxAllowedLeverage,
      systemHardCap: 5,
      defaultMarketType: env.defaultMarketType,
      defaultMarginMode: env.defaultMarginMode,
      defaultExchange: env.defaultActiveExchange,
    },
  });
}
