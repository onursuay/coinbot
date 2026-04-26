import { ok, fail } from "@/lib/api-helpers";
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

  if (!supabaseConfigured()) {
    return ok({
      bot: null,
      daily: null,
      liveTrading: liveTradingEnabled(),
      openPositions: 0,
      debug: {
        source: "fallback",
        hasSettingsRow: false,
        botStatus: "stopped",
        reason: "supabase_not_configured",
      },
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

  try {
    const state = await getBotState(userId);
    const daily = await getDailyStatus(userId, PAPER_BALANCE);
    const { count } = await supabaseAdmin().from("paper_trades")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("status", "open");
    return ok({
      bot: state,
      daily,
      liveTrading: liveTradingEnabled(),
      openPositions: count ?? 0,
      debug: {
        source: "supabase",
        hasSettingsRow: Boolean(state),
        botStatus: state?.bot_status ?? "stopped",
      },
      config: {
        maxLeverage: env.maxLeverage,
        maxAllowedLeverage: env.maxAllowedLeverage,
        systemHardCap: 5,
        defaultMarketType: env.defaultMarketType,
        defaultMarginMode: env.defaultMarginMode,
        defaultExchange: env.defaultActiveExchange,
      },
    });
  } catch (e: any) {
    return fail(e?.message ?? "Status okunamadı", 500, {
      debug: { source: "supabase", error: e?.message ?? String(e) },
    });
  }
}
