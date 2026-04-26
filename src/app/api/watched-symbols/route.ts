import { z } from "zod";
import { fail, ok, parseBody, isResponse } from "@/lib/api-helpers";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth";
import { toCanonical } from "@/lib/exchanges/symbol-normalizer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!supabaseConfigured()) return ok([]);
  const url = new URL(req.url);
  const exchange = (url.searchParams.get("exchange") ?? "mexc").toLowerCase();
  const userId = getCurrentUserId();
  const { data } = await supabaseAdmin().from("watched_symbols")
    .select("*").eq("user_id", userId).eq("exchange_name", exchange)
    .order("symbol", { ascending: true });
  return ok(data ?? []);
}

const Body = z.object({
  exchange: z.enum(["mexc", "binance", "okx", "bybit"]),
  symbol: z.string(),
  is_active: z.boolean().default(true),
  min_volume_usd: z.number().min(0).default(0),
});

export async function POST(req: Request) {
  if (!supabaseConfigured()) return fail("Supabase yapılandırılmamış", 500);
  const parsed = await parseBody(req, Body);
  if (isResponse(parsed)) return parsed;
  const userId = getCurrentUserId();
  const { data, error } = await supabaseAdmin().from("watched_symbols").upsert({
    user_id: userId, exchange_name: parsed.exchange, market_type: "futures",
    symbol: toCanonical(parsed.symbol), is_active: parsed.is_active, min_volume_usd: parsed.min_volume_usd,
  }, { onConflict: "user_id,exchange_name,market_type,symbol" }).select().single();
  if (error) return fail(error.message, 500);
  return ok(data);
}

export async function DELETE(req: Request) {
  if (!supabaseConfigured()) return fail("Supabase yapılandırılmamış", 500);
  const url = new URL(req.url);
  const exchange = url.searchParams.get("exchange");
  const symbol = url.searchParams.get("symbol");
  if (!exchange || !symbol) return fail("exchange ve symbol gerekli", 400);
  const userId = getCurrentUserId();
  await supabaseAdmin().from("watched_symbols")
    .delete().eq("user_id", userId).eq("exchange_name", exchange)
    .eq("symbol", toCanonical(symbol));
  return ok({ removed: symbol });
}
