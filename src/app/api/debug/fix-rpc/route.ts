import { ok, fail } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One-shot migration endpoint: recreates set_risk_settings with correct body.
// Tries multiple approaches in order until one succeeds.
const FIX_SQL = `
CREATE OR REPLACE FUNCTION public.set_risk_settings(
  p_user_id uuid,
  p_settings jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  UPDATE public.bot_settings
     SET risk_settings = p_settings
   WHERE user_id = p_user_id
  RETURNING risk_settings INTO result;

  IF NOT FOUND THEN
    INSERT INTO public.bot_settings (user_id, risk_settings)
    VALUES (p_user_id, p_settings)
    RETURNING risk_settings INTO result;
  END IF;

  RETURN result;
END;
$$;
NOTIFY pgrst, 'reload schema';
`;

export async function GET() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const projectRef = supabaseUrl.replace("https://", "").replace(".supabase.co", "");

  if (!serviceKey || !projectRef) {
    return fail("Missing credentials", 500);
  }

  const results: Record<string, unknown> = {};

  // Attempt 1: Supabase Management API
  try {
    const mgmtResp = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ query: FIX_SQL }),
      }
    );
    const mgmtBody = await mgmtResp.text();
    results.mgmt = { status: mgmtResp.status, body: mgmtBody.slice(0, 300) };
    if (mgmtResp.ok) {
      return ok({ success: true, method: "management_api", results });
    }
  } catch (e: unknown) {
    results.mgmt = { error: (e as Error)?.message };
  }

  // Attempt 2: Direct PostgreSQL REST endpoint
  try {
    const restResp = await fetch(
      `${supabaseUrl}/rest/v1/rpc/exec_sql`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
          "apikey": serviceKey,
        },
        body: JSON.stringify({ sql: FIX_SQL }),
      }
    );
    const restBody = await restResp.text();
    results.exec_sql_rpc = { status: restResp.status, body: restBody.slice(0, 300) };
    if (restResp.ok) {
      return ok({ success: true, method: "exec_sql_rpc", results });
    }
  } catch (e: unknown) {
    results.exec_sql_rpc = { error: (e as Error)?.message };
  }

  // Attempt 3: Supabase pg endpoint
  try {
    const pgResp = await fetch(
      `${supabaseUrl}/pg/query`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
          "apikey": serviceKey,
        },
        body: JSON.stringify({ query: FIX_SQL }),
      }
    );
    const pgBody = await pgResp.text();
    results.pg_query = { status: pgResp.status, body: pgBody.slice(0, 300) };
    if (pgResp.ok) {
      return ok({ success: true, method: "pg_query", results });
    }
  } catch (e: unknown) {
    results.pg_query = { error: (e as Error)?.message };
  }

  return ok({ success: false, message: "Tüm yöntemler başarısız", results });
}
