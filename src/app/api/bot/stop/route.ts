import { ok } from "@/lib/api-helpers";
import { setBotStatus } from "@/lib/engines/bot-orchestrator";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  await setBotStatus(getCurrentUserId(), "stopped", "manual_stop");
  return ok({ status: "stopped" });
}
