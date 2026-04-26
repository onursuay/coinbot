import { ok } from "@/lib/api-helpers";
import { checkEnv } from "@/lib/env-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Returns presence/effective config only. Never echoes secret values.
  return ok(checkEnv());
}
