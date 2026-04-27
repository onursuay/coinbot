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

  try {
    const { encryptSecret, decryptSecret } = await import("@/lib/crypto");
    const enc = encryptSecret("test-value-12345");
    const dec = decryptSecret(enc);
    checks.encryption = dec === "test-value-12345" ? "✓ çalışıyor" : "✗ şifre çözme hatalı";
  } catch (e: any) {
    checks.encryption = `✗ ${e?.message ?? "şifreleme hatası"}`;
  }

  const allOk = Object.values(checks).every((v) => v.startsWith("✓"));
  return NextResponse.json({ ok: allOk, checks });
}
