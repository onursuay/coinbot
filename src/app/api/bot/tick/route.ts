import { ok } from "@/lib/api-helpers";
import { tickBot } from "@/lib/engines/bot-orchestrator";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Manual single-tick endpoint (suitable for cron / external scheduler).
export async function POST() {
  const result = await tickBot(getCurrentUserId());
  return ok(result);
}
