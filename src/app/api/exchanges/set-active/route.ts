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
    .update({ is_active: false });
  await supabaseAdmin().from("exchange_credentials")
    .update({ is_active: true })
    .eq("exchange_name", parsed.exchange);
  await supabaseAdmin().from("bot_settings").upsert(
    { user_id: userId, active_exchange: parsed.exchange },
    { onConflict: "user_id" },
  );
  return ok({ active: parsed.exchange });
}
