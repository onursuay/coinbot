import { ok, fail } from "@/lib/api-helpers";
import { setBotStatus } from "@/lib/engines/bot-orchestrator";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await setBotStatus(getCurrentUserId(), "paused", "manual_pause");
    return ok({ status: "paused" });
  } catch (e: any) {
    return fail(e?.message ?? "Pause başarısız", 500);
  }
}
