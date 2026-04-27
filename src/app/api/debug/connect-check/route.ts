import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, string> = {};

  // 1. Env vars
  checks.SUPABASE_URL = env.supabaseUrl ? "✓ set" : "✗ EKSİK";
  checks.SUPABASE_SERVICE_ROLE_KEY = env.supabaseServiceRoleKey ? "✓ set" : "✗ EKSİK";
  checks.CREDENTIAL_ENCRYPTION_KEY = env.credentialEncryptionKey ? "✓ set" : "✗ EKSİK";

  // 2. Supabase connectivity
  try {
    const { error } = await supabaseAdmin()
      .from("exchange_credentials")
      .select("id")
      .limit(1);
    checks.exchange_credentials_table = error ? `✗ ${error.message}` : "✓ erişilebilir";
  } catch (e: any) {
    checks.exchange_credentials_table = `✗ ${e?.message ?? "bağlanamadı"}`;
  }

  // 3. Encryption test
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
