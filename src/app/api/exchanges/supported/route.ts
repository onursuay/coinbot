import { NextResponse } from "next/server";
import { SUPPORTED_EXCHANGES } from "@/lib/exchanges/exchange-factory";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (supabaseConfigured()) {
    try {
      const { data } = await supabaseAdmin().from("supported_exchanges").select("*").eq("is_enabled", true).order("name");
      if (data) return NextResponse.json({ ok: true, data });
    } catch { /* fallback below */ }
  }
  // Fallback static list (when Supabase isn't configured)
  return NextResponse.json({
    ok: true,
    data: SUPPORTED_EXCHANGES.map((slug) => ({
      slug, name: slug.toUpperCase(),
      supports_spot: true, supports_futures: true, supports_websocket: true,
      requires_passphrase: slug === "okx", is_enabled: true,
    })),
  });
}
