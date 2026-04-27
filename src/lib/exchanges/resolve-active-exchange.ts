// resolveActiveExchange — single source of truth for which exchange is active.
// Priority:
//   1. exchange_credentials.is_active=true  (explicit DB credential, most authoritative)
//   2. env.defaultActiveExchange            (env override — prevents stale DB value from winning)
//   3. bot_settings.active_exchange         (DB fallback — may hold stale value after credential changes)
//   4. "binance"                             (hard default)
//
// env is placed above bot_settings deliberately: DEFAULT_ACTIVE_EXCHANGE=binance in .env
// should override an old "mexc" value that may linger in bot_settings after credential changes.

import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export async function resolveActiveExchange(_userId: string): Promise<string> {
  if (!supabaseConfigured()) {
    return env.defaultActiveExchange || "binance";
  }

  const sb = supabaseAdmin();

  // Priority 1: exchange_credentials.is_active=true
  const { data: credRows } = await sb
    .from("exchange_credentials")
    .select("exchange_name")
    .eq("is_active", true)
    .limit(1);

  const activeCred = credRows?.[0]?.exchange_name;
  if (activeCred) return (activeCred as string).toLowerCase();

  // Priority 2: env.defaultActiveExchange
  // Sits above bot_settings so an explicit DEFAULT_ACTIVE_EXCHANGE=binance wins over a
  // stale "mexc" that may remain in bot_settings after switching exchange credentials.
  if (env.defaultActiveExchange) return env.defaultActiveExchange;

  // Priority 3: bot_settings.active_exchange (last-resort DB value)
  const { data: settingsRows } = await sb
    .from("bot_settings")
    .select("active_exchange")
    .limit(1);

  const settingsExchange = settingsRows?.[0]?.active_exchange;
  if (settingsExchange) return (settingsExchange as string).toLowerCase();

  // Priority 4: hard default
  return "binance";
}
