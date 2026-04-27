import { ok, fail } from "@/lib/api-helpers";
import { setBotStatus } from "@/lib/engines/bot-orchestrator";
import { getCurrentUserId } from "@/lib/auth";
import { evaluateOpenTrades } from "@/lib/engines/paper-trading-engine";
import { supabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    if (!supabaseConfigured()) {
      return fail("Supabase env missing — kill switch cannot persist state", 503, {
        kill_switch_active: false,
        kill_switch_reason: null,
        supabase_configured: false,
      });
    }
    const userId = getCurrentUserId();
    const REASON = "Manual emergency stop";
    await setBotStatus(userId, "kill_switch", REASON);
    // Best-effort SL/TP sweep on open paper trades
    await evaluateOpenTrades(userId).catch(() => undefined);
    return ok({
      status: "kill_switch_triggered",
      kill_switch_active: true,
      kill_switch_reason: REASON,
    });
  } catch (e: any) {
    return fail(e?.message ?? "Kill switch başarısız", 500);
  }
}
