import { ok } from "@/lib/api-helpers";
import { setBotStatus, tickBot } from "@/lib/engines/bot-orchestrator";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const userId = getCurrentUserId();
  await setBotStatus(userId, "running", "manual_start");
  const result = await tickBot(userId);
  return ok({ status: "running", tick: result });
}
