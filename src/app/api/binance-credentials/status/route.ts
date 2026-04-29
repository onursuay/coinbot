// Faz 17 — GET /api/binance-credentials/status
// Read-only credential + futures-access + checklist status snapshot.
// Never returns secrets. Never calls order endpoints.

import { ok, fail } from "@/lib/api-helpers";
import { getCurrentUserId } from "@/lib/auth";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { isHardLiveAllowed } from "@/lib/env";
import {
  checkCredentialPresence,
  validateFuturesAccess,
  EXPECTED_VPS_IP,
  DEFAULT_CHECKLIST,
  type BinanceCredentialStatus,
  type BinanceSecurityChecklist,
} from "@/lib/binance-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadChecklist(): Promise<BinanceSecurityChecklist> {
  if (!supabaseConfigured()) return DEFAULT_CHECKLIST;
  try {
    const userId = getCurrentUserId();
    const { data } = await supabaseAdmin()
      .from("bot_settings")
      .select("binance_security_checklist")
      .eq("user_id", userId)
      .maybeSingle();
    const stored = (data as any)?.binance_security_checklist;
    if (stored && typeof stored === "object") {
      return { ...DEFAULT_CHECKLIST, ...stored };
    }
    return DEFAULT_CHECKLIST;
  } catch {
    return DEFAULT_CHECKLIST;
  }
}

export async function GET() {
  try {
    const presence = checkCredentialPresence();
    const futuresAccess = await validateFuturesAccess();
    const checklist = await loadChecklist();
    const payload: BinanceCredentialStatus = {
      presence,
      futuresAccess,
      checklist,
      recommendedVpsIp: EXPECTED_VPS_IP,
      liveGateOpen: isHardLiveAllowed(),
    };
    return ok(payload);
  } catch (e: any) {
    return fail(`status hatası: ${String(e?.message ?? e).slice(0, 200)}`, 500);
  }
}
