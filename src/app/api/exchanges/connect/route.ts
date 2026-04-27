import { z } from "zod";
import { fail, ok, parseBody, isResponse } from "@/lib/api-helpers";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { SUPPORTED_EXCHANGES } from "@/lib/exchanges/exchange-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  exchange: z.enum(["mexc", "binance", "okx", "bybit"]),
  apiKey: z.string().min(8),
  apiSecret: z.string().min(8),
  apiPassphrase: z.string().optional(),
});

export async function POST(req: Request) {
  if (!supabaseConfigured()) return fail("Supabase yapılandırılmamış", 500);
  const parsed = await parseBody(req, Body);
  if (isResponse(parsed)) return parsed;
  if (!SUPPORTED_EXCHANGES.includes(parsed.exchange)) return fail("Borsa desteklenmiyor", 400);
  const userId = getCurrentUserId();

  let api_key_encrypted: string;
  let api_secret_encrypted: string;
  let api_passphrase_encrypted: string | null;
  try {
    api_key_encrypted = encryptSecret(parsed.apiKey);
    api_secret_encrypted = encryptSecret(parsed.apiSecret);
    api_passphrase_encrypted = parsed.apiPassphrase ? encryptSecret(parsed.apiPassphrase) : null;
  } catch (e: any) {
    return fail(`Şifreleme hatası: ${e?.message ?? "CREDENTIAL_ENCRYPTION_KEY eksik"}`, 500);
  }

  const row = {
    user_id: userId,
    exchange_name: parsed.exchange,
    api_key_encrypted,
    api_secret_encrypted,
    api_passphrase_encrypted,
    permissions: {},
    is_active: false,
    last_validated_at: null,
  };

  const { data, error } = await supabaseAdmin()
    .from("exchange_credentials")
    .upsert(row, { onConflict: "user_id,exchange_name" })
    .select("id, exchange_name, is_active, created_at")
    .single();
  if (error) return fail(error.message, 500);
  return ok(data);
}
