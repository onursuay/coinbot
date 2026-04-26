import { ok, fail } from "@/lib/api-helpers";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  if (!url || !serviceKey) {
    return fail("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", 500, {
      hasUrl: Boolean(url),
      hasServiceKey: Boolean(serviceKey),
      hasAnonKey: Boolean(anonKey),
    });
  }

  // Create a fresh client — no singleton, no cache
  const sb = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Raw select — all rows (no user_id filter first)
  const { data: allRows, error: allErr } = await sb
    .from("bot_settings")
    .select("user_id, bot_status, kill_switch_active, updated_at")
    .limit(10);

  // Specific user select
  const { data: userRow, error: userErr } = await sb
    .from("bot_settings")
    .select("*")
    .eq("user_id", SYSTEM_USER_ID)
    .maybeSingle();

  // Key type hints (never leak actual key)
  const serviceKeyHint = serviceKey.length > 20
    ? `${serviceKey.slice(0, 12)}...${serviceKey.slice(-8)} (len=${serviceKey.length})`
    : "(too short — likely wrong)";

  return ok({
    userId: SYSTEM_USER_ID,
    serviceKeyHint,
    anonKeyPresent: Boolean(anonKey),
    allRows: allErr ? null : allRows,
    allRowsError: allErr?.message ?? null,
    userRow: userErr ? null : userRow,
    userRowError: userErr?.message ?? null,
    hasRow: Boolean(userRow),
    botStatus: userRow?.bot_status ?? null,
  });
}
