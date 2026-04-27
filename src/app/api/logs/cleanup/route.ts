import { ok, fail } from "@/lib/api-helpers";
import { supabaseConfigured } from "@/lib/supabase/server";
import { runLogCleanup } from "@/lib/logs/log-cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Manual log cleanup trigger — only deletes log rows, never trade data.
export async function POST(_req: Request) {
  if (!supabaseConfigured()) {
    return fail("Supabase yapılandırılmamış", 503);
  }
  try {
    const result = await runLogCleanup();
    if (!result.ok) {
      return fail(result.error ?? "Cleanup başarısız", 500);
    }
    return ok({ deleted_total: result.deleted_total, details: result.details, ran_at: result.ran_at });
  } catch (e: any) {
    return fail(e?.message ?? "Cleanup hatası", 500);
  }
}
