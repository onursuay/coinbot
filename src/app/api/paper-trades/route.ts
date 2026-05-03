import { ok } from "@/lib/api-helpers";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth";
import {
  evaluateOpenTrades,
  estimateNetUnrealizedPnl,
  fetchOpenTradeMarkPrices,
} from "@/lib/engines/paper-trading-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const skipEvaluate = url.searchParams.get("skipEvaluate") === "1";
  const debug = url.searchParams.get("debug") === "1";
  const diag: Record<string, unknown> = {};

  if (!supabaseConfigured()) {
    diag.supabaseConfigured = false;
    return ok({ open: [], closed: [], ...(debug ? { _diag: diag } : {}) });
  }
  const userId = getCurrentUserId();
  diag.userId = userId;
  diag.skipEvaluate = skipEvaluate;

  // Refresh open trades against current price each fetch.
  // Wrapped in try/catch so a transient ticker / closePaperTrade failure does
  // not erase the open list returned to the UI.
  if (!skipEvaluate) {
    try {
      const evalResult = await evaluateOpenTrades(userId);
      diag.evaluateOpenTrades = evalResult;
    } catch (e: unknown) {
      diag.evaluateOpenTradesError = e instanceof Error ? e.message : String(e);
    }
  }

  const sb = supabaseAdmin();
  const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 100) || 100);

  const { data: openData, error: openErr } = await sb.from("paper_trades")
    .select("*").eq("user_id", userId).eq("status", "open").order("opened_at", { ascending: false });
  if (openErr) diag.openError = openErr.message ?? String(openErr);
  diag.openCount = openData?.length ?? 0;

  // Enrich open rows with mark price + unrealized net PnL preview. The UI uses
  // these to colour the manual close button (green/red/blue) and the close
  // route uses the same formula via estimateNetUnrealizedPnl to enforce the
  // loss-close confirmation gate. If price lookup fails for a row, fields are
  // null and the UI shows a disabled neutral button with a tooltip.
  let enrichedOpen = openData ?? [];
  if (enrichedOpen.length > 0) {
    try {
      const priceMap = await fetchOpenTradeMarkPrices(userId);
      enrichedOpen = enrichedOpen.map((t: Record<string, unknown>) => {
        const resolved = priceMap[t.id as string] ?? null;
        if (resolved == null) {
          return {
            ...t,
            current_price: null,
            current_price_source: null,
            net_unrealized_pnl: null,
            net_unrealized_pnl_pct: null,
          };
        }
        const { netPnl, pnlPct } = estimateNetUnrealizedPnl({
          direction: t.direction as "LONG" | "SHORT",
          entryPrice: Number(t.entry_price),
          positionSize: Number(t.position_size),
          marginUsed: Number(t.margin_used),
          openedAt: String(t.opened_at),
          currentPrice: resolved.price,
        });
        return {
          ...t,
          current_price: resolved.price,
          current_price_source: resolved.source,
          net_unrealized_pnl: netPnl,
          net_unrealized_pnl_pct: pnlPct,
        };
      });
    } catch (e) {
      diag.markPriceError = e instanceof Error ? e.message : String(e);
    }
  }

  const { data: closedData, error: closedErr } = await sb.from("paper_trades")
    .select("*").eq("user_id", userId).eq("status", "closed").order("closed_at", { ascending: false }).limit(limit);
  if (closedErr) diag.closedError = closedErr.message ?? String(closedErr);
  diag.closedCount = closedData?.length ?? 0;

  return ok({ open: enrichedOpen, closed: closedData ?? [], ...(debug ? { _diag: diag } : {}) });
}
