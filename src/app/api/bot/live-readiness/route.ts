import { ok, fail } from "@/lib/api-helpers";
import { getCurrentUserId } from "@/lib/auth";
import { checkLiveReadiness } from "@/lib/engines/live-readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await checkLiveReadiness(getCurrentUserId());
    return ok(result);
  } catch (e: any) {
    return fail(e?.message ?? "live readiness check failed", 500);
  }
}
