import { ok, fail } from "@/lib/api-helpers";
import { getCurrentUserId } from "@/lib/auth";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { botLog } from "@/lib/logger";
import { env, SYSTEM_HARD_LEVERAGE_CAP } from "@/lib/env";
import { checkEnv } from "@/lib/env-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const envCheck = checkEnv();
  if (!supabaseConfigured()) {
    return fail("Supabase env missing. Configure Vercel environment variables first.", 500, {
      missing: envCheck.missing,
      empty: envCheck.empty,
    });
  }

  const userId = getCurrentUserId();
  const sb = supabaseAdmin();

  // Comprehensive defaults — written on every Start so the row is always sane.
  // bot_status stays lowercase to match orchestrator/type system; UI uppercases for display.
  const maxAllowed = Math.min(env.maxAllowedLeverage, SYSTEM_HARD_LEVERAGE_CAP);
  const maxLev = Math.min(env.maxLeverage, maxAllowed);

  const payload = {
    user_id: userId,
    bot_status: "running",
    trading_mode: "paper",
    market_type: "futures",
    margin_mode: "isolated",
    active_exchange: env.defaultActiveExchange || "mexc",
    kill_switch_active: false,
    max_leverage: maxLev,
    max_allowed_leverage: maxAllowed,
    risk_per_trade_percent: env.maxRiskPerTradePercent,
    max_daily_loss_percent: env.maxDailyLossPercent,
    max_weekly_loss_percent: env.maxWeeklyLossPercent,
    daily_profit_target_usd: env.dailyProfitTargetUsd,
    max_open_positions: env.maxOpenPositions,
    min_risk_reward_ratio: env.minRiskRewardRatio,
  };

  const { data: upserted, error } = await sb
    .from("bot_settings")
    .upsert(payload, { onConflict: "user_id" })
    .select()
    .single();

  if (error) {
    return fail(`bot_settings upsert hatası: ${error.message}`, 500);
  }

  // Verify by re-reading the row (defensive: catches read-after-write edge cases).
  const { data: verified, error: verifyErr } = await sb
    .from("bot_settings")
    .select("bot_status,trading_mode,active_exchange,kill_switch_active,max_leverage,max_allowed_leverage")
    .eq("user_id", userId)
    .single();

  if (verifyErr) {
    return fail(`bot_settings verify hatası: ${verifyErr.message}`, 500);
  }

  if (verified?.bot_status !== "running") {
    return fail(
      `Upsert sonrası bot_status='${verified?.bot_status}' bekleniyordu='running'. Olası RLS/trigger.`,
      500,
      { upserted, verified }
    );
  }

  await botLog({
    userId,
    eventType: "bot_running",
    message: "Bot status -> running: manual_start",
  });

  return ok({
    status: verified.bot_status.toUpperCase(),
    hasSettingsRow: true,
    settings: upserted,
    verified,
  });
}
