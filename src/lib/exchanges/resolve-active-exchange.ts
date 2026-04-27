// resolveActiveExchange — single source of truth for which exchange is active.
// Priority: exchange_credentials.is_active=true → bot_settings.active_exchange → env → "binance"

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

  // Priority 2: bot_settings.active_exchange
  const { data: settingsRows } = await sb
    .from("bot_settings")
    .select("active_exchange")
    .limit(1);

  const settingsExchange = settingsRows?.[0]?.active_exchange;
  if (settingsExchange) return (settingsExchange as string).toLowerCase();

  // Priority 3: env fallback → "binance"
  return env.defaultActiveExchange || "binance";
}
