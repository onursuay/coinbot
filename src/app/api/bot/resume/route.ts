import { ok } from "@/lib/api-helpers";
import { setBotStatus } from "@/lib/engines/bot-orchestrator";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  await setBotStatus(getCurrentUserId(), "running", "manual_resume");
  return ok({ status: "running" });
}
