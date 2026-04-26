import { z } from "zod";
import { fail, ok, parseBody, isResponse } from "@/lib/api-helpers";
import { getCurrentUserId } from "@/lib/auth";
import { closePaperTrade } from "@/lib/engines/paper-trading-engine";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getAdapter } from "@/lib/exchanges/exchange-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  tradeId: z.string().uuid(),
  reason: z.string().default("manual"),
});

export async function POST(req: Request) {
  if (!supabaseConfigured()) return fail("Supabase yapılandırılmamış", 500);
  const parsed = await parseBody(req, Body);
  if (isResponse(parsed)) return parsed;
  const userId = getCurrentUserId();
  const { data: trade } = await supabaseAdmin().from("paper_trades")
    .select("*").eq("id", parsed.tradeId).eq("user_id", userId).single();
  if (!trade) return fail("Trade bulunamadı", 404);
  const ticker = await getAdapter(trade.exchange_name).getTicker(trade.symbol);
  const updated = await closePaperTrade({
    userId, tradeId: parsed.tradeId, exitPrice: ticker.lastPrice, exitReason: parsed.reason,
  });
  return ok(updated);
}
