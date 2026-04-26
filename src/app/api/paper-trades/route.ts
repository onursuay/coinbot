import { ok } from "@/lib/api-helpers";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth";
import { evaluateOpenTrades } from "@/lib/engines/paper-trading-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!supabaseConfigured()) return ok({ open: [], closed: [] });
  const userId = getCurrentUserId();
  // Refresh open trades against current price each fetch
  await evaluateOpenTrades(userId);
  const sb = supabaseAdmin();
  const { data: open } = await sb.from("paper_trades")
    .select("*").eq("user_id", userId).eq("status", "open").order("opened_at", { ascending: false });
  const url = new URL(req.url);
  const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 100) || 100);
  const { data: closed } = await sb.from("paper_trades")
    .select("*").eq("user_id", userId).eq("status", "closed").order("closed_at", { ascending: false }).limit(limit);
  return ok({ open: open ?? [], closed: closed ?? [] });
}
