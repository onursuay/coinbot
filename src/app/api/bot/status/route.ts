import { ok, fail } from "@/lib/api-helpers";
import { getBotState } from "@/lib/engines/bot-orchestrator";
import { getDailyStatus } from "@/lib/engines/daily-target";
import { liveTradingEnabled } from "@/lib/engines/live-trading-guard";
import { getCurrentUserId } from "@/lib/auth";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { env, SYSTEM_HARD_LEVERAGE_CAP, isHardLiveAllowed } from "@/lib/env";
import { checkEnv } from "@/lib/env-validation";
import { resolveActiveExchange } from "@/lib/exchanges/resolve-active-exchange";

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
        defaultExchange: env.defaultActiveExchange || "binance",
      },
    });
  }

  try {
    const [state, daily, posResult, activeExchange] = await Promise.all([
      getBotState(userId),
      getDailyStatus(userId, PAPER_BALANCE),
      supabaseAdmin().from("paper_trades")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId).eq("status", "open"),
      resolveActiveExchange(userId),
    ]);
    const count = posResult.count;

    // Normalize bot row's active_exchange to match the credential-based source of truth.
    if (state && activeExchange) state.active_exchange = activeExchange;

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
        activeExchange,
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
        defaultExchange: activeExchange,
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
