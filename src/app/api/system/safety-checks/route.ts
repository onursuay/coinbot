// Diagnostic endpoint — runs safety invariant checks and reports status.
import { ok, fail } from "@/lib/api-helpers";
import { runSafetyChecks, SAFETY_INVARIANTS } from "@/lib/safety-checks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = runSafetyChecks();
    return ok({
      passed: result.ok,
      failed: result.failed,
      invariants: SAFETY_INVARIANTS,
    });
  } catch (e: any) {
    return fail(e?.message ?? "safety check failed", 500);
  }
}
