import { NextResponse } from "next/server";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth";
import { decryptSecret, maskApiKey } from "@/lib/crypto";

export const dynamic = "force-dynamic";

const NO_CACHE = { headers: { "Cache-Control": "no-store" } };

export async function GET() {
  if (!supabaseConfigured()) return NextResponse.json({ ok: true, data: [] }, NO_CACHE);
  const userId = getCurrentUserId();
  const { data, error } = await supabaseAdmin()
    .from("exchange_credentials")
    .select("id, exchange_name, api_key_encrypted, is_active, last_validated_at, created_at")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500, ...NO_CACHE });
  const rows = (data ?? []).map((c) => {
    let masked_api_key = "****";
    try { masked_api_key = maskApiKey(decryptSecret(c.api_key_encrypted)); } catch {}
    return {
      id: c.id,
      exchange: c.exchange_name,
      masked_api_key,
      is_active: c.is_active,
      last_validated_at: c.last_validated_at,
    };
  });
  return NextResponse.json({ ok: true, data: rows }, NO_CACHE);
}
