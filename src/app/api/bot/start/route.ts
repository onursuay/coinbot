import { ok, fail } from "@/lib/api-helpers";
import { getBotState, setBotStatus } from "@/lib/engines/bot-orchestrator";
import { getCurrentUserId } from "@/lib/auth";
import { supabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (!supabaseConfigured()) {
    return fail("Supabase yapılandırılmamış — env değişkenlerini kontrol et", 500);
  }
  try {
    const userId = getCurrentUserId();
    await setBotStatus(userId, "running", "manual_start");
    const state = await getBotState(userId);
    return ok({
      status: state?.bot_status ?? "running",
      hasSettingsRow: Boolean(state),
      settings: state,
    });
  } catch (e: any) {
    return fail(e?.message ?? "Bot başlatılamadı", 500);
  }
}
