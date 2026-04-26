import { ok } from "@/lib/api-helpers";
import { getCurrentUserId } from "@/lib/auth";
import { getBotState } from "@/lib/engines/bot-orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getBotState(getCurrentUserId());
  return ok(data);
}
