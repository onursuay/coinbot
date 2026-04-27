import { ok, fail } from "@/lib/api-helpers";
import { getCurrentUserId } from "@/lib/auth";
import { calculateStrategyHealth, persistStrategyHealth } from "@/lib/engines/strategy-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = getCurrentUserId();
    const metrics = await calculateStrategyHealth(userId);
    await persistStrategyHealth(userId, metrics);
    return ok(metrics);
  } catch (e: any) {
    return fail(e?.message ?? "strategy health calc failed", 500);
  }
}
