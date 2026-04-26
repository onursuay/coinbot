import { fail, ok } from "@/lib/api-helpers";
import { scanMarket } from "@/lib/engines/scanner";
import { getCurrentUserId } from "@/lib/auth";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import type { ExchangeName } from "@/lib/exchanges/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SYMBOLS = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT"];

async function loadSymbols(userId: string, exchange: ExchangeName): Promise<string[]> {
  if (!supabaseConfigured()) return DEFAULT_SYMBOLS;
  const { data } = await supabaseAdmin().from("watched_symbols")
    .select("symbol")
    .eq("user_id", userId).eq("exchange_name", exchange).eq("market_type", "futures").eq("is_active", true);
  const list = (data ?? []).map((r) => r.symbol);
  return list.length ? list : DEFAULT_SYMBOLS;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const exchange = (url.searchParams.get("exchange") ?? "mexc").toLowerCase() as ExchangeName;
  const userId = getCurrentUserId();
  try {
    const symbols = await loadSymbols(userId, exchange);
    const rows = await scanMarket({ exchange, symbols });
    return ok(rows);
  } catch (e: any) {
    return fail(e?.message ?? "Tarama başarısız", 502);
  }
}

export async function POST(req: Request) {
  return GET(req);
}
