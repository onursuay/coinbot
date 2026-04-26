import { ok } from "@/lib/api-helpers";
import { setBotStatus } from "@/lib/engines/bot-orchestrator";
import { getCurrentUserId } from "@/lib/auth";
import { evaluateOpenTrades } from "@/lib/engines/paper-trading-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const userId = getCurrentUserId();
  await setBotStatus(userId, "kill_switch", "kill_switch_triggered");
  // Best-effort: sweep open paper trades against current price (closes any that hit SL/TP).
  await evaluateOpenTrades(userId);
  return ok({ status: "kill_switch" });
}
