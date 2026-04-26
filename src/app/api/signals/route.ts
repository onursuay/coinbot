import { fail, ok } from "@/lib/api-helpers";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!supabaseConfigured()) return ok([]);
  const url = new URL(req.url);
  const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 50) || 50);
  const userId = getCurrentUserId();
  const { data, error } = await supabaseAdmin().from("signals")
    .select("*").eq("user_id", userId)
    .order("created_at", { ascending: false }).limit(limit);
  if (error) return fail(error.message, 500);
  return ok(data ?? []);
}
