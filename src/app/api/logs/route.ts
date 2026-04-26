import { ok } from "@/lib/api-helpers";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!supabaseConfigured()) return ok({ logs: [], riskEvents: [] });
  const url = new URL(req.url);
  const limit = Math.min(500, Number(url.searchParams.get("limit") ?? 200) || 200);
  const userId = getCurrentUserId();
  const sb = supabaseAdmin();
  const [{ data: logs }, { data: riskEvents }] = await Promise.all([
    sb.from("bot_logs").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(limit),
    sb.from("risk_events").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(limit),
  ]);
  return ok({ logs: logs ?? [], riskEvents: riskEvents ?? [] });
}
