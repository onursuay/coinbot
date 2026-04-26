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

  const sb = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Query A: all rows, no filter
  const { data: allRows, error: errA } = await sb
    .from("bot_settings")
    .select("user_id, bot_status, kill_switch_active, updated_at")
    .limit(10);

  // Query B: filter with .eq(), no maybeSingle
  const { data: filteredRows, error: errB } = await sb
    .from("bot_settings")
    .select("user_id, bot_status")
    .eq("user_id", SYSTEM_USER_ID);

  // Query C: filter with .eq() + maybeSingle
  const { data: singleRow, error: errC } = await sb
    .from("bot_settings")
    .select("user_id, bot_status")
    .eq("user_id", SYSTEM_USER_ID)
    .maybeSingle();

  // Query D: raw SQL via rpc if available
  let rpcRow: any = null;
  let errD: any = null;
  try {
    const res = await sb.rpc("get_bot_settings_debug", { p_user_id: SYSTEM_USER_ID }).maybeSingle();
    rpcRow = res.data;
    errD = res.error;
  } catch (e: any) {
    errD = { message: e?.message ?? "rpc not available" };
  }

  // Query E: filter by text cast (in case of type mismatch)
  const { data: textFilter, error: errE } = await sb
    .from("bot_settings")
    .select("user_id, bot_status")
    .filter("user_id::text", "eq", SYSTEM_USER_ID);

  // Inspect what user_id values look like (char codes of first row)
  const firstRow = allRows?.[0];
  const firstUserId = firstRow?.user_id ?? "";
  const charCodes = (firstUserId as string).split("").map((c) => c.charCodeAt(0));

  const serviceKeyHint = serviceKey.length > 20
    ? `${serviceKey.slice(0, 12)}...${serviceKey.slice(-8)} (len=${serviceKey.length})`
    : "(too short — likely wrong)";

  return ok({
    userId: SYSTEM_USER_ID,
    userIdCharCodes: Array.from(SYSTEM_USER_ID).map((c) => c.charCodeAt(0)),
    serviceKeyHint,
    anonKeyPresent: Boolean(anonKey),
    queryA_allRows: { data: allRows, error: errA?.message ?? null },
    queryB_filtered: { data: filteredRows, error: errB?.message ?? null },
    queryC_maybeSingle: { data: singleRow, error: errC?.message ?? null },
    queryD_rpc: { data: rpcRow, error: errD?.message ?? null },
    queryE_textFilter: { data: textFilter, error: errE?.message ?? null },
    firstRowUserIdRaw: firstUserId,
    firstRowCharCodes: charCodes,
    charCodeMatch: charCodes.join(",") === Array.from(SYSTEM_USER_ID).map((c) => c.charCodeAt(0)).join(","),
  });
}
