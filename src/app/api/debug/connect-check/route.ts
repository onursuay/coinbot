import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, string> = {};

  checks.SUPABASE_URL = env.supabaseUrl ? "✓ set" : "✗ EKSİK";
  checks.SUPABASE_SERVICE_ROLE_KEY = env.supabaseServiceRoleKey ? "✓ set" : "✗ EKSİK";
  checks.CREDENTIAL_ENCRYPTION_KEY = env.credentialEncryptionKey ? "✓ set" : "✗ EKSİK";

  try {
    const { data, error } = await supabaseAdmin()
      .from("exchange_credentials")
      .select("id, exchange_name, is_active")
      .order("created_at", { ascending: false });
    if (error) {
      checks.exchange_credentials_table = `✗ ${error.message}`;
    } else {
      checks.exchange_credentials_table = `✓ ${data?.length ?? 0} kayıt`;
      if (data && data.length > 0) {
        checks.kayitlar = data.map((r: any) => `${r.exchange_name}(active=${r.is_active})`).join(", ");
      }
    }
  } catch (e: any) {
    checks.exchange_credentials_table = `✗ ${e?.message ?? "bağlanamadı"}`;
  }

  // Test set-active update directly
  try {
    const { error: e1, count: c1 } = await supabaseAdmin()
      .from("exchange_credentials")
      .update({ is_active: false })
      .neq("exchange_name", "")
      .select();
    checks.update_deactivate = e1 ? `✗ ${e1.message}` : `✓ çalıştı`;
  } catch (e: any) {
    checks.update_deactivate = `✗ ${e?.message}`;
  }

  try {
    const { error } = await supabaseAdmin()
      .from("exchange_credentials")
      .select("id")
      .limit(1);
    checks.encryption = error ? `✗ ${error.message}` : "✓ çalışıyor";
  } catch (e: any) {
    checks.encryption = `✗ ${e?.message ?? "şifreleme hatası"}`;
  }

  const allOk = Object.values(checks).every((v) => v.startsWith("✓"));
  return NextResponse.json({ ok: allOk, checks });
}
