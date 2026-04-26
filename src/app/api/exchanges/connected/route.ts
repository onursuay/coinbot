import { NextResponse } from "next/server";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth";
import { decryptSecret, maskApiKey } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!supabaseConfigured()) return NextResponse.json({ ok: true, data: [] });
  const userId = getCurrentUserId();
  const { data, error } = await supabaseAdmin()
    .from("exchange_credentials")
    .select("id, exchange_name, api_key_encrypted, permissions, is_active, last_validated_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const masked = (data ?? []).map((c) => {
    let masked_key = "";
    try { masked_key = maskApiKey(decryptSecret(c.api_key_encrypted)); } catch { masked_key = "****"; }
    return {
      id: c.id, exchange_name: c.exchange_name, masked_key,
      permissions: c.permissions, is_active: c.is_active, last_validated_at: c.last_validated_at,
      created_at: c.created_at,
    };
  });
  return NextResponse.json({ ok: true, data: masked });
}
