import { ok, fail } from "@/lib/api-helpers";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const TEST_CAP = 9999;

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!url || !serviceKey) {
    return fail("Missing env vars", 500);
  }

  const sb = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1) Read BEFORE via read_risk_settings RPC
  const before = await sb.rpc("read_risk_settings", { p_user_id: USER_ID });

  // 2) Read BEFORE via direct SELECT
  const beforeDirect = await sb
    .from("bot_settings")
    .select("risk_settings")
    .eq("user_id", USER_ID)
    .maybeSingle();

  // 3) Write via write_risk_settings RPC with TEST_CAP
  const testPayload = {
    ...(before.data ?? {}),
    capital: { totalCapitalUsdt: TEST_CAP, riskPerTradePercent: 5, maxDailyLossPercent: 15 },
    profile: "CUSTOM",
    updatedAt: Date.now(),
  };
  const writeResult = await sb.rpc("write_risk_settings", {
    p_user_id: USER_ID,
    p_settings: testPayload,
  });

  // 4) Read AFTER via read_risk_settings RPC
  const after = await sb.rpc("read_risk_settings", { p_user_id: USER_ID });

  // 5) Read AFTER via direct SELECT
  const afterDirect = await sb
    .from("bot_settings")
    .select("risk_settings")
    .eq("user_id", USER_ID)
    .maybeSingle();

  const beforeCapRpc = (before.data as any)?.capital?.totalCapitalUsdt ?? null;
  const afterCapRpc = (after.data as any)?.capital?.totalCapitalUsdt ?? null;
  const beforeCapDirect = (beforeDirect.data as any)?.risk_settings?.capital?.totalCapitalUsdt ?? null;
  const afterCapDirect = (afterDirect.data as any)?.risk_settings?.capital?.totalCapitalUsdt ?? null;

  return ok({
    testCap: TEST_CAP,
    before: { rpc: beforeCapRpc, direct: beforeCapDirect },
    writeError: writeResult.error?.message ?? null,
    writeReturnedData: (writeResult.data as any)?.capital?.totalCapitalUsdt ?? null,
    after: { rpc: afterCapRpc, direct: afterCapDirect },
    writeWorked: afterCapRpc === TEST_CAP,
    rpcVsDirectConsistent: afterCapRpc === afterCapDirect,
  });
}
