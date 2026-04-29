// Faz 15 — GET /api/live-trades
//
// Read-only endpoint. Sadece live_trades tablosunu okur.
// Binance API çağrısı YAPMAZ. Emir göndermez.
// Veri yoksa boş liste döner; hata fırlatmaz.
//
// MUTLAK KURALLAR:
//   • Bu endpoint hiçbir canlı emir açmaz/kapatmaz.
//   • Binance private/order endpoint çağrısı yoktur.
//   • HARD_LIVE_TRADING_ALLOWED=false korunur.
//   • openLiveOrder / closeLiveOrder bu dosyada yoktur.

import { ok, fail } from "@/lib/api-helpers";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth";
import {
  liveTradeRowToNormalizedTrade,
  type LiveTradeRowRaw,
  type NormalizedTrade,
} from "@/lib/trade-performance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIVE_TRADE_SELECT =
  "id, symbol, side, status, entry_price, exit_price, stop_loss, take_profit, pnl, pnl_percent, trade_signal_score, rr_ratio, close_reason, exit_reason, opened_at, closed_at, trade_mode, execution_type";

interface LiveTradesResponse {
  trades: NormalizedTrade[];
  total: number;
  hasData: boolean;
}

export async function GET(req: Request) {
  if (!supabaseConfigured()) {
    const empty: LiveTradesResponse = { trades: [], total: 0, hasData: false };
    return ok(empty);
  }

  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status"); // "open" | "closed" | null (tümü)
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(parseInt(limitParam ?? "100", 10) || 100, 1), 500);

  try {
    const userId = getCurrentUserId();
    const sb = supabaseAdmin();

    let query = sb
      .from("live_trades")
      .select(LIVE_TRADE_SELECT)
      .eq("user_id", userId)
      .order("opened_at", { ascending: false })
      .limit(limit);

    if (statusFilter === "open" || statusFilter === "closed") {
      query = query.eq("status", statusFilter);
    }

    const { data: rows, error } = await query;

    if (error) {
      // live_trades tablosu henüz oluşturulmamışsa boş döner; hata fırlatmaz.
      const empty: LiveTradesResponse = { trades: [], total: 0, hasData: false };
      return ok(empty);
    }

    const trades: NormalizedTrade[] = (rows ?? []).map((r: LiveTradeRowRaw) =>
      liveTradeRowToNormalizedTrade(r),
    );

    const response: LiveTradesResponse = {
      trades,
      total: trades.length,
      hasData: trades.length > 0,
    };

    return ok(response);
  } catch (e: any) {
    return fail(e?.message ?? "live-trades okunamadı", 500);
  }
}
