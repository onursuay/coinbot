import { z } from "zod";
import { fail, ok, parseBody, isResponse } from "@/lib/api-helpers";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth";
import { SYSTEM_HARD_LEVERAGE_CAP } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hard cap leverage at 5x. Reject anything higher even if persisted upstream.
const Body = z.object({
  active_exchange: z.enum(["mexc", "binance", "okx", "bybit"]).optional(),
  trading_mode: z.enum(["paper", "live"]).optional(),
  margin_mode: z.enum(["isolated", "cross"]).optional(),
  max_leverage: z.number().min(1).max(SYSTEM_HARD_LEVERAGE_CAP).optional(),
  max_allowed_leverage: z.number().min(1).max(SYSTEM_HARD_LEVERAGE_CAP).optional(),
  risk_per_trade_percent: z.number().min(0.1).max(2).optional(),
  max_daily_loss_percent: z.number().min(1).max(20).optional(),
  max_weekly_loss_percent: z.number().min(1).max(40).optional(),
  daily_profit_target_usd: z.number().min(1).max(50).optional(),
  max_open_positions: z.number().int().min(1).max(5).optional(),
  min_risk_reward_ratio: z.number().min(1).max(10).optional(),
  conservative_mode_enabled: z.boolean().optional(),
});

export async function POST(req: Request) {
  if (!supabaseConfigured()) return fail("Supabase yapılandırılmamış", 500);
  const parsed = await parseBody(req, Body);
  if (isResponse(parsed)) return parsed;
  const userId = getCurrentUserId();
  const { data, error } = await supabaseAdmin().from("bot_settings").upsert(
    { user_id: userId, ...parsed },
    { onConflict: "user_id" },
  ).select().single();
  if (error) return fail(error.message, 500);
  return ok(data);
}
