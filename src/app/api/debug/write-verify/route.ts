import { ok, fail } from "@/lib/api-helpers";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const TEST_CAP = 7777;

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!url || !serviceKey) return fail("Missing env vars", 500);

  const sb = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1) Aynı transaction içinde yaz+oku (debug_write_verify fonksiyonu)
  const roundTrip = await sb.rpc("debug_write_verify", {
    p_user_id: USER_ID,
    p_cap: TEST_CAP,
  });

  // 2) Ayrı çağrıda read_risk_settings ile oku
  const afterGet = await sb.rpc("read_risk_settings", { p_user_id: USER_ID });
  const afterGetCap = (afterGet.data as any)?.capital?.totalCapitalUsdt ?? null;

  // 3) Ayrı çağrıda direct SELECT ile oku
  const afterDirect = await sb
    .from("bot_settings")
    .select("risk_settings")
    .eq("user_id", USER_ID)
    .maybeSingle();
  const afterDirectCap =
    (afterDirect.data as any)?.risk_settings?.capital?.totalCapitalUsdt ?? null;

  return ok({
    testCap: TEST_CAP,
    roundTrip: roundTrip.data,
    roundTripError: roundTrip.error?.message ?? null,
    afterGetRpc: afterGetCap,
    afterDirectSelect: afterDirectCap,
    // Eğer match=true ama afterGetRpc ≠ TEST_CAP → get_risk_settings caching sorunu
    // Eğer match=false → yazma DB'de çalışmıyor
    dbWriteWorks: (roundTrip.data as any)?.match ?? false,
    getRpcStale: (roundTrip.data as any)?.match === true && afterGetCap !== TEST_CAP,
  });
}
