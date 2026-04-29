// Faz 19 — Effective risk execution config (read-only).
// Returns the binding state for paper/live shared risk lifecycle.
// liveExecutionBound and leverageExecutionBound remain false in this phase.

import { ok } from "@/lib/api-helpers";
import {
  buildRiskExecutionConfig,
  validateRiskExecutionConfig,
  getRiskExecutionStatus,
  ensureHydrated,
} from "@/lib/risk-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureHydrated();
  const config = buildRiskExecutionConfig();
  const validation = validateRiskExecutionConfig(config);
  const status = getRiskExecutionStatus();
  return ok({ config, validation, status });
}
