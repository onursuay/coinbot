// Paper close — structured error + price fallback.
//
// Binance returns HTTP 451 from Vercel/edge regions in some geos. The naive
// path used to bubble the raw "HTTP 451" string up to the browser as an alert.
// This route now:
//   1. tries the exchange ticker (primary)
//   2. falls back to the most recent `signals.entry_price` for the same
//      symbol within the last hour (secondary, paper-only)
//   3. returns a structured JSON error with a stable `code` field when both
//      sources fail — never raw text, never raw HTTP-status strings
//
// Live safety: this route never opens or sends any exchange order. It only
// updates the local `paper_trades` row. No call to /fapi/v1/order or
// /fapi/v1/leverage. closePaperTrade is the same canonical helper the SL/TP
// sweeper uses, so net pnl (gross - fees - slippage - funding) stays
// consistent with the per-row `pnl` column.

import { z } from "zod";
import { NextResponse } from "next/server";
import { parseBody, isResponse } from "@/lib/api-helpers";
import { getCurrentUserId } from "@/lib/auth";
import { closePaperTrade } from "@/lib/engines/paper-trading-engine";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getAdapter } from "@/lib/exchanges/exchange-factory";
import { ExchangeHttpError } from "@/lib/exchanges/http";
import { botLog } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  tradeId: z.string().uuid(),
  reason: z.string().default("manual"),
});

// Stable error codes — the frontend uses these to render localized messages
// instead of bubbling up backend text or raw HTTP statuses.
type CloseErrorCode =
  | "PRICE_UNAVAILABLE"   // primary + fallback both failed
  | "BINANCE_451"         // exchange returned 451; fallback also unavailable
  | "BINANCE_BLOCKED"     // exchange returned 403/429 etc; fallback unavailable
  | "CLOSE_FAILED"        // closePaperTrade itself threw
  | "TRADE_NOT_FOUND"
  | "TRADE_ALREADY_CLOSED"
  | "SUPABASE_MISSING";

function closeFail(message: string, code: CloseErrorCode, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { ok: false, error: message, code, ...(extra ?? {}) },
    { status },
  );
}

// Fallback price source — most recent scanner-stored entry_price for symbol.
// Reads from `signals` table which the orchestrator writes every tick. Only
// uses prices fresher than 1 hour to avoid quoting completely stale numbers
// (paper-only; never used to send real orders).
async function recentSignalPrice(userId: string, symbol: string): Promise<number | null> {
  if (!supabaseConfigured()) return null;
  const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  try {
    const { data } = await supabaseAdmin()
      .from("signals")
      .select("entry_price, created_at")
      .eq("user_id", userId)
      .eq("symbol", symbol)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(1);
    const px = Number(data?.[0]?.entry_price ?? 0);
    return Number.isFinite(px) && px > 0 ? px : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  if (!supabaseConfigured()) {
    return closeFail("Supabase yapılandırılmamış", "SUPABASE_MISSING", 500);
  }
  const parsed = await parseBody(req, Body);
  if (isResponse(parsed)) return parsed;

  const userId = getCurrentUserId();
  const { data: trade } = await supabaseAdmin()
    .from("paper_trades")
    .select("*")
    .eq("id", parsed.tradeId)
    .eq("user_id", userId)
    .single();

  if (!trade) {
    return closeFail("Trade bulunamadı", "TRADE_NOT_FOUND", 404);
  }
  if (trade.status === "closed") {
    return closeFail("İşlem zaten kapatılmış", "TRADE_ALREADY_CLOSED", 409);
  }

  await botLog({
    userId,
    exchange: trade.exchange_name,
    eventType: "paper_trade_close_requested",
    message: `Manuel paper close isteği: ${trade.symbol} ${trade.direction} (${trade.id})`,
    metadata: { tradeId: trade.id, symbol: trade.symbol, reason: parsed.reason },
  });

  // ── Step 1: try exchange ticker ────────────────────────────────────────
  let closePrice: number | null = null;
  let closePriceSource: "binance" | "fallback_signal" = "binance";
  let primaryErrorCode: CloseErrorCode | null = null;
  let primaryStatus = 0;

  try {
    const ticker = await getAdapter(trade.exchange_name).getTicker(trade.symbol);
    const px = Number(ticker.lastPrice);
    if (Number.isFinite(px) && px > 0) {
      closePrice = px;
    } else {
      primaryErrorCode = "PRICE_UNAVAILABLE";
    }
  } catch (e) {
    // Duck-typed status check — `instanceof ExchangeHttpError` would fail
    // across module-cache resets (notably in tests), so we accept any error
    // shape that exposes a numeric `status` field.
    const errStatus = (e && typeof e === "object" && "status" in (e as any))
      ? Number((e as any).status)
      : 0;
    primaryStatus = e instanceof ExchangeHttpError ? e.status : errStatus;
    primaryErrorCode =
      primaryStatus === 451 ? "BINANCE_451"
      : primaryStatus === 403 || primaryStatus === 429 ? "BINANCE_BLOCKED"
      : "PRICE_UNAVAILABLE";
    await botLog({
      userId,
      exchange: trade.exchange_name,
      level: "warn",
      eventType: "paper_trade_close_price_fetch_failed",
      message: `Exchange ticker alınamadı (${primaryErrorCode} status=${primaryStatus}); fallback denenecek`,
      metadata: {
        tradeId: trade.id,
        symbol: trade.symbol,
        status: primaryStatus,
        message: e instanceof Error ? e.message : String(e),
      },
    });
  }

  // ── Step 2: fallback to most recent signal price for symbol ────────────
  if (closePrice == null) {
    const fallback = await recentSignalPrice(userId, trade.symbol);
    if (fallback != null) {
      closePrice = fallback;
      closePriceSource = "fallback_signal";
      await botLog({
        userId,
        exchange: trade.exchange_name,
        level: "warn",
        eventType: "paper_trade_close_price_fallback_used",
        message: `Fallback fiyat kullanıldı (${trade.symbol} @ ${fallback}); kaynak: signals.entry_price (son 1 saat)`,
        metadata: {
          tradeId: trade.id,
          symbol: trade.symbol,
          fallbackPrice: fallback,
          primaryStatus,
          primaryErrorCode,
        },
      });
    }
  }

  // ── Step 3: still no price → structured error ──────────────────────────
  if (closePrice == null) {
    const code: CloseErrorCode = primaryErrorCode ?? "PRICE_UNAVAILABLE";
    const message = primaryStatus === 451
      ? "Binance fiyat verisine erişilemedi (451) ve son bilinen fiyat bulunamadı; paper pozisyon kapatılamadı."
      : "Güncel veya son bilinen fiyat bulunamadı; paper pozisyon kapatılamadı.";
    await botLog({
      userId,
      exchange: trade.exchange_name,
      level: "error",
      eventType: "paper_trade_close_failed",
      message: `Fiyat alınamadı: ${trade.symbol} (${code} status=${primaryStatus})`,
      metadata: { tradeId: trade.id, symbol: trade.symbol, code, primaryStatus },
    });
    return closeFail(message, code, 503, { primaryStatus });
  }

  // ── Step 4: persist via canonical close helper (no exchange order) ─────
  try {
    const updated = await closePaperTrade({
      userId,
      tradeId: parsed.tradeId,
      exitPrice: closePrice,
      exitReason: parsed.reason,
    });
    await botLog({
      userId,
      exchange: trade.exchange_name,
      eventType: "paper_trade_close_success",
      message: `Paper close OK: ${trade.symbol} @ ${closePrice} src=${closePriceSource}`,
      metadata: {
        tradeId: trade.id,
        symbol: trade.symbol,
        closePrice,
        closePriceSource,
        primaryErrorCode: primaryErrorCode ?? null,
      },
    });
    return NextResponse.json({
      ok: true,
      data: updated,
      trade: updated,
      closePriceSource,
      ...(closePriceSource === "fallback_signal"
        ? { warning: "Fallback fiyat kullanıldı (Binance ticker erişilemedi)." }
        : {}),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Paper close başarısız";
    await botLog({
      userId,
      exchange: trade.exchange_name,
      level: "error",
      eventType: "paper_trade_close_failed",
      message: `closePaperTrade exception: ${trade.symbol} — ${message}`,
      metadata: { tradeId: trade.id, symbol: trade.symbol, error: message },
    });
    return closeFail(`Paper pozisyon kapatılamadı: ${message}`, "CLOSE_FAILED", 500);
  }
}

