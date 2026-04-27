import { z } from "zod";
import { fail, ok, parseBody, isResponse } from "@/lib/api-helpers";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ exchange: z.enum(["mexc", "binance", "okx", "bybit"]) });

export async function POST(req: Request) {
  if (!supabaseConfigured()) return fail("Supabase yapılandırılmamış", 500);
  const parsed = await parseBody(req, Body);
  if (isResponse(parsed)) return parsed;
  const userId = getCurrentUserId();
  await supabaseAdmin().from("exchange_credentials")
    .update({ is_active: false }).neq("exchange_name", "");
  const { error: e1 } = await supabaseAdmin().from("exchange_credentials")
    .update({ is_active: true }).eq("exchange_name", parsed.exchange);
  if (e1) return fail(e1.message, 500);

  await supabaseAdmin().from("bot_settings")
    .update({ active_exchange: parsed.exchange }).neq("id", "00000000-0000-0000-0000-000000000000");

  return ok({ is_active: true });
}
