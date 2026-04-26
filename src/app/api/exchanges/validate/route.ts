import { z } from "zod";
import { fail, ok, parseBody, isResponse } from "@/lib/api-helpers";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth";
import { getAdapter } from "@/lib/exchanges/exchange-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ exchange: z.enum(["mexc", "binance", "okx", "bybit"]) });

export async function POST(req: Request) {
  const parsed = await parseBody(req, Body);
  if (isResponse(parsed)) return parsed;
  const adapter = getAdapter(parsed.exchange);
  // Public market reachability is the first signal of healthy connection.
  try {
    await adapter.getFuturesSymbols();
  } catch (e: any) {
    return fail(`Borsa erişilemedi: ${e?.message ?? e}`, 502);
  }
  // Authenticated check is intentionally not performed here in PAPER mode;
  // when LIVE_TRADING is enabled, route this through a dedicated authenticated probe.
  if (supabaseConfigured()) {
    const userId = getCurrentUserId();
    await supabaseAdmin().from("exchange_credentials")
      .update({ last_validated_at: new Date().toISOString() })
      .eq("user_id", userId).eq("exchange_name", parsed.exchange);
  }
  return ok({ ok: true, validated: true, exchange: parsed.exchange });
}
