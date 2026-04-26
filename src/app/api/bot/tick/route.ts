import { ok, fail } from "@/lib/api-helpers";
import { tickBot } from "@/lib/engines/bot-orchestrator";
import { getCurrentUserId } from "@/lib/auth";
import { supabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (!supabaseConfigured()) {
    return fail("Supabase env missing. Tick skipped.", 500);
  }
  try {
    const result = await tickBot(getCurrentUserId());
    return ok(result);
  } catch (e: any) {
    return fail(e?.message ?? "Tick başarısız", 500);
  }
}
