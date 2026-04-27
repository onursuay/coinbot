import { ok, fail } from "@/lib/api-helpers";
import { getBotState } from "@/lib/engines/bot-orchestrator";
import { getDailyStatus } from "@/lib/engines/daily-target";
import { liveTradingEnabled } from "@/lib/engines/live-trading-guard";
import { getCurrentUserId } from "@/lib/auth";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { env, SYSTEM_HARD_LEVERAGE_CAP, isHardLiveAllowed } from "@/lib/env";
import { checkEnv } from "@/lib/env-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAPER_BALANCE = 1000;

export async function GET() {
  const userId = getCurrentUserId();
  const envCheck = checkEnv();

  if (!supabaseConfigured()) {
    return ok({
      bot: null,
      daily: { realizedPnlUsd: 0, dailyTargetUsd: env.dailyProfitTargetUsd, targetHit: false, lossLimitHit: false },
      liveTrading: liveTradingEnabled(),
      hardLiveTradingAllowed: isHardLiveAllowed(),
      openPositions: 0,
      debug: {
        botStatus: "STOPPED",
        tradingMode: env.defaultTradingMode,
        marketType: env.defaultMarketType,
        marginMode: env.defaultMarginMode,
        activeExchange: env.defaultActiveExchange,
        maxLeverage: env.maxLeverage,
        maxAllowedLeverage: env.maxAllowedLeverage,
        killSwitchActive: false,
        source: "fallback",
        hasSettingsRow: false,
        envOk: envCheck.ok,
        missingEnv: envCheck.missing,
        emptyEnv: envCheck.empty,
      },
      config: {
        maxLeverage: env.maxLeverage,
        maxAllowedLeverage: env.maxAllowedLeverage,
        systemHardCap: SYSTEM_HARD_LEVERAGE_CAP,
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
      hardLiveTradingAllowed: isHardLiveAllowed(),
      openPositions: count ?? 0,
      debug: {
        botStatus: (state?.bot_status ?? "stopped").toString().toUpperCase(),
        tradingMode: state?.trading_mode ?? env.defaultTradingMode,
        marketType: state?.market_type ?? env.defaultMarketType,
        marginMode: state?.margin_mode ?? env.defaultMarginMode,
        activeExchange: state?.active_exchange ?? env.defaultActiveExchange,
        maxLeverage: state?.max_leverage ?? env.maxLeverage,
        maxAllowedLeverage: state?.max_allowed_leverage ?? env.maxAllowedLeverage,
        killSwitchActive: Boolean(state?.kill_switch_active),
        source: "supabase",
        hasSettingsRow: Boolean(state),
        envOk: envCheck.ok,
        missingEnv: envCheck.missing,
        emptyEnv: envCheck.empty,
      },
      config: {
        maxLeverage: env.maxLeverage,
        maxAllowedLeverage: env.maxAllowedLeverage,
        systemHardCap: SYSTEM_HARD_LEVERAGE_CAP,
        defaultMarketType: env.defaultMarketType,
        defaultMarginMode: env.defaultMarginMode,
        defaultExchange: env.defaultActiveExchange,
      },
    });
  } catch (e: any) {
    return fail(e?.message ?? "Status okunamadı", 500, {
      debug: {
        source: "supabase",
        error: e?.message ?? String(e),
        envOk: envCheck.ok,
        missingEnv: envCheck.missing,
        emptyEnv: envCheck.empty,
      },
    });
  }
}
