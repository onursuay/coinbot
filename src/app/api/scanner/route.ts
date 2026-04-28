// Scanner API — reads worker's last scan result from Supabase.
// Binance market data calls are performed exclusively by the VPS worker, NOT by Vercel.
// Direct exchange API calls from Vercel are intentionally removed to prevent HTTP 451
// geo-restriction errors. The scanner page reads worker-produced scan_details from DB.

import { ok, fail } from "@/lib/api-helpers";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request) {
  if (!supabaseConfigured()) {
    return ok({
      rows: [],
      stats: null,
      source: "fallback",
      message: "Supabase yapılandırılmamış — worker scan verisi alınamadı.",
    });
  }

  try {
    const { data, error } = await supabaseAdmin()
      .from("bot_settings")
      .select("last_tick_summary, last_tick_at, active_exchange")
      .limit(1)
      .single();

    if (error || !data?.last_tick_summary) {
      return ok({
        rows: [],
        stats: null,
        source: "db",
        message: "Henüz scan verisi yok. Worker bir tick çalıştırdıktan sonra dolacak.",
      });
    }

    const summary = data.last_tick_summary as any;
    const scanDetails: any[] = summary.scanDetails ?? [];

    return ok({
      rows: scanDetails,
      stats: {
        totalUniverse: summary.universe ?? 0,
        preFiltered: summary.prefiltered ?? 0,
        deepAnalyzed: summary.scanned ?? 0,
        signalLong: scanDetails.filter((r) => r.signalType === "LONG").length,
        signalShort: scanDetails.filter((r) => r.signalType === "SHORT").length,
        signalNoTrade: scanDetails.filter((r) => r.signalType === "NO_TRADE").length,
        signalWait: scanDetails.filter((r) => r.signalType === "WAIT").length,
        nextCursor: "0",
      },
      source: "worker_tick_summary",
      exchange: data.active_exchange ?? "binance",
      lastTickAt: data.last_tick_at ?? null,
    });
  } catch (e: any) {
    return fail(e?.message ?? "Scanner okunamadı", 500);
  }
}

export async function POST(req: Request) {
  return GET(req);
}
