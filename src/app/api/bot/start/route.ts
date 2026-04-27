// Bot start endpoint — supports paper/live mode via JSON body { mode: 'paper' | 'live' }.
// Live mode requires the TRIPLE GATE to be satisfied:
//   1. env.HARD_LIVE_TRADING_ALLOWED=true
//   2. body.mode='live' → DB.trading_mode='live'
//   3. body.enableLive=true → DB.enable_live_trading=true
//
// Default (no body): paper mode, enable_live_trading=false (safe default).

import { ok, fail } from "@/lib/api-helpers";
import { getCurrentUserId } from "@/lib/auth";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { botLog } from "@/lib/logger";
import { env, SYSTEM_HARD_LEVERAGE_CAP, isHardLiveAllowed } from "@/lib/env";
import { checkEnv } from "@/lib/env-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StartBody {
  mode?: "paper" | "live";
  enableLive?: boolean;
}

export async function POST(req: Request) {
  const envCheck = checkEnv();
  const body = (await req.json().catch(() => ({}))) as StartBody;
  const requestedMode = body.mode === "live" ? "live" : "paper";
  const requestedEnableLive = body.enableLive === true;

  // Reject live request at API layer if env hard gate is closed.
  if (requestedMode === "live" && !isHardLiveAllowed()) {
    return fail(
      "Live trading reddedildi: HARD_LIVE_TRADING_ALLOWED=false. Önce env'de hard gate'i aç.",
      403,
      { hardLiveTradingAllowed: false, requestedMode, requestedEnableLive: false }
    );
  }
  if (requestedEnableLive && !isHardLiveAllowed()) {
    return fail(
      "enable_live_trading reddedildi: HARD_LIVE_TRADING_ALLOWED=false.",
      403,
      { hardLiveTradingAllowed: false }
    );
  }

  if (!supabaseConfigured()) {
    return fail("Supabase env missing. Configure Vercel environment variables first.", 500, {
      missing: envCheck.missing, empty: envCheck.empty,
    });
  }

  const userId = getCurrentUserId();
  const sb = supabaseAdmin();

  const maxAllowed = Math.min(env.maxAllowedLeverage, SYSTEM_HARD_LEVERAGE_CAP);
  const maxLev = Math.min(env.maxLeverage, maxAllowed);

  // bot_status reflects the active operating mode for clarity.
  const botStatus =
    requestedMode === "live" && requestedEnableLive ? "running_live" : "running_paper";

  const payload = {
    user_id: userId,
    bot_status: botStatus,
    trading_mode: requestedMode,
    enable_live_trading: requestedEnableLive && isHardLiveAllowed(),
    market_type: "futures",
    margin_mode: "isolated",
    active_exchange: env.defaultActiveExchange || "binance",
    kill_switch_active: false,
    kill_switch_reason: null,
    max_leverage: maxLev,
    max_allowed_leverage: maxAllowed,
    risk_per_trade_percent: env.maxRiskPerTradePercent,
    max_daily_loss_percent: env.maxDailyLossPercent,
    max_weekly_loss_percent: env.maxWeeklyLossPercent,
    daily_profit_target_usd: env.dailyProfitTargetUsd,
    max_open_positions: env.maxOpenPositions,
    min_risk_reward_ratio: env.minRiskRewardRatio,
    max_consecutive_losses: env.maxConsecutiveLosses,
    min_strategy_health_score_to_trade: env.minStrategyHealthScoreToTrade,
    updated_by: "dashboard_start",
  };

  const { data: upserted, error } = await sb
    .from("bot_settings")
    .upsert(payload, { onConflict: "user_id" })
    .select()
    .single();

  if (error) return fail(`bot_settings upsert hatası: ${error.message}`, 500);

  // Verify (single-tenant: limit(1))
  const { data: rows, error: verifyErr } = await sb
    .from("bot_settings")
    .select("bot_status,trading_mode,enable_live_trading,active_exchange,kill_switch_active,max_leverage,max_allowed_leverage")
    .limit(1);
  if (verifyErr) return fail(`bot_settings verify hatası: ${verifyErr.message}`, 500);
  const verified = rows?.[0];

  await botLog({
    userId,
    eventType: requestedMode === "live" ? "bot_running_live" : "bot_running_paper",
    message: `Bot status -> ${botStatus}: manual_start (mode=${requestedMode}, enable_live=${requestedEnableLive})`,
  });

  return ok({
    status: verified?.bot_status ? String(verified.bot_status).toUpperCase() : botStatus.toUpperCase(),
    mode: requestedMode,
    enableLiveTrading: payload.enable_live_trading,
    hardLiveTradingAllowed: isHardLiveAllowed(),
    hasSettingsRow: true,
    settings: upserted,
    verified,
  });
}
