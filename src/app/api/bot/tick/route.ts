import { ok, fail } from "@/lib/api-helpers";
import { tickBot } from "@/lib/engines/bot-orchestrator";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await tickBot(getCurrentUserId());
    return ok(result);
  } catch (e: any) {
    return fail(e?.message ?? "Tick başarısız", 500);
  }
}
