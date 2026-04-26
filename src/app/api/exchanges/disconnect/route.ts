import { z } from "zod";
import { fail, ok } from "@/lib/api-helpers";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({ exchange: z.enum(["mexc", "binance", "okx", "bybit"]) });

export async function DELETE(req: Request) {
  if (!supabaseConfigured()) return fail("Supabase yapılandırılmamış", 500);
  const url = new URL(req.url);
  const exchange = url.searchParams.get("exchange");
  const parsed = Schema.safeParse({ exchange });
  if (!parsed.success) return fail("Geçersiz exchange", 400);
  const userId = getCurrentUserId();
  await supabaseAdmin().from("exchange_credentials")
    .delete().eq("user_id", userId).eq("exchange_name", parsed.data.exchange);
  return ok({ removed: parsed.data.exchange });
}
