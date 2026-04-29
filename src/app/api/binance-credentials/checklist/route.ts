// Faz 17 — POST /api/binance-credentials/checklist
// Updates manual security checklist state ONLY. Never accepts secrets/api keys.

import { z } from "zod";
import { ok, fail, parseBody, isResponse } from "@/lib/api-helpers";
import { getCurrentUserId } from "@/lib/auth";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { DEFAULT_CHECKLIST, type BinanceSecurityChecklist } from "@/lib/binance-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const State = z.enum(["unknown", "confirmed", "failed"]);

// Strict schema: ONLY checklist state values are accepted.
// Any extra/unknown property (e.g. "apiKey", "secret") is rejected by .strict().
const Body = z
  .object({
    withdrawPermissionDisabled: State.optional(),
    ipRestrictionConfigured: State.optional(),
    futuresPermissionConfirmed: State.optional(),
    extraPermissionsReviewed: State.optional(),
  })
  .strict();

const SECRET_LIKE_KEYS = [
  "apikey", "api_key", "apiKey",
  "secret", "apisecret", "api_secret", "apiSecret",
  "passphrase", "apiPassphrase",
];

export async function POST(req: Request) {
  // Defense in depth: even before zod parses, refuse any request that includes a secret-like key.
  let raw: any = null;
  try {
    raw = await req.clone().json();
  } catch {
    /* parseBody will fail below */
  }
  if (raw && typeof raw === "object") {
    for (const k of Object.keys(raw)) {
      if (SECRET_LIKE_KEYS.includes(k) || /secret|passphrase|api[_-]?key/i.test(k)) {
        return fail("Bu endpoint API key/secret kabul etmez.", 400);
      }
    }
  }

  const parsed = await parseBody(req, Body);
  if (isResponse(parsed)) return parsed;

  if (!supabaseConfigured()) {
    return fail("Supabase yapılandırılmadı.", 500);
  }

  try {
    const userId = getCurrentUserId();
    const { data } = await supabaseAdmin()
      .from("bot_settings")
      .select("binance_security_checklist")
      .eq("user_id", userId)
      .maybeSingle();
    const current: BinanceSecurityChecklist = {
      ...DEFAULT_CHECKLIST,
      ...((data as any)?.binance_security_checklist ?? {}),
    };
    const next: BinanceSecurityChecklist = {
      withdrawPermissionDisabled: parsed.withdrawPermissionDisabled ?? current.withdrawPermissionDisabled,
      ipRestrictionConfigured: parsed.ipRestrictionConfigured ?? current.ipRestrictionConfigured,
      futuresPermissionConfirmed: parsed.futuresPermissionConfirmed ?? current.futuresPermissionConfirmed,
      extraPermissionsReviewed: parsed.extraPermissionsReviewed ?? current.extraPermissionsReviewed,
      updatedAt: new Date().toISOString(),
    };
    await supabaseAdmin()
      .from("bot_settings")
      .update({ binance_security_checklist: next })
      .eq("user_id", userId);
    return ok({ checklist: next });
  } catch (e: any) {
    return fail(`checklist güncelleme hatası: ${String(e?.message ?? e).slice(0, 200)}`, 500);
  }
}
