// Paper close — structured error + price fallback + age/PnL gates.
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
// Manual-close gates (added with the stateful close-button UI):
//   • Positions in the 12-24h window are "İZLENİYOR" — close requests are
//     rejected with code POSITION_UNDER_OBSERVATION. The frontend renders the
//     button as disabled in this window; the server enforces the same rule.
//   • Positions in net loss (netUnrealizedPnl <= -0.25 USDT) require an
//     explicit `confirmLossClose: true` in the request body. Without it the
//     server returns LOSS_CLOSE_CONFIRMATION_REQUIRED so the UI can show a
//     modal. The PnL is computed via estimateNetUnrealizedPnl — the same
//     formula the GET route uses to colour the button.
//   • Server-side derives the canonical exit_reason from the position's age
//     and PnL bucket (manual_profit_close, manual_loss_close,
//     manual_break_even_close, manual_stale_*). Client-supplied reason is
//     ignored except for legacy "manual" callers.
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
import {
  closePaperTrade,
  estimateNetUnrealizedPnl,
  resolveClosePriceFallback,
  type ClosePriceSource,
} from "@/lib/engines/paper-trading-engine";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getAdapter } from "@/lib/exchanges/exchange-factory";
import { ExchangeHttpError } from "@/lib/exchanges/http";
import { botLog } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  tradeId: z.string().uuid(),
  reason: z.string().default("manual"),
  // Required when the position is in net loss. The frontend sets this after
  // the user confirms the loss-close modal. Default false so legacy callers
  // get the LOSS_CLOSE_CONFIRMATION_REQUIRED error instead of silently
  // realising a loss.
  confirmLossClose: z.boolean().default(false),
});

// Stable error codes — the frontend uses these to render localized messages
// instead of bubbling up backend text or raw HTTP statuses.
type CloseErrorCode =
  | "PRICE_UNAVAILABLE"               // primary + fallback both failed
  | "BINANCE_451"                     // exchange returned 451; fallback also unavailable
  | "BINANCE_BLOCKED"                 // exchange returned 403/429 etc; fallback unavailable
  | "CLOSE_FAILED"                    // closePaperTrade itself threw
  | "TRADE_NOT_FOUND"
  | "TRADE_ALREADY_CLOSED"
  | "POSITION_UNDER_OBSERVATION"      // 12-24h window — manual close blocked
  | "LOSS_CLOSE_CONFIRMATION_REQUIRED"// loss close without confirmLossClose=true
  | "SUPABASE_MISSING";

function closeFail(message: string, code: CloseErrorCode, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { ok: false, error: message, code, ...(extra ?? {}) },
    { status },
  );
}

// Loss threshold in USDT. Mirrors the UI break-even band:
//   • netPnl >=  0.25 → "profit"  (green button)
//   • netPnl <= -0.25 → "loss"    (red button, modal required to close)
//   • -0.25..+0.25    → "break_even" (blue button, no modal)
const LOSS_THRESHOLD_USDT = -0.25;
const PROFIT_THRESHOLD_USDT = 0.25;

type AgeBucket = "fresh" | "monitoring" | "stale";
type PnlBucket = "profit" | "loss" | "break_even";

function ageBucketFor(openedAt: string): AgeBucket {
  const ageH = (Date.now() - new Date(openedAt).getTime()) / 3_600_000;
  if (ageH < 12) return "fresh";
  if (ageH < 24) return "monitoring";
  return "stale";
}

function pnlBucketFor(netPnl: number): PnlBucket {
  if (netPnl >= PROFIT_THRESHOLD_USDT) return "profit";
  if (netPnl <= LOSS_THRESHOLD_USDT) return "loss";
  return "break_even";
}

// Canonical exit_reason mapping. The 12-24h "monitoring" bucket is blocked
// before reaching this function so it deliberately has no entry here.
function canonicalExitReason(age: AgeBucket, pnl: PnlBucket): string {
  if (age === "fresh") {
    if (pnl === "profit") return "manual_profit_close";
    if (pnl === "loss") return "manual_loss_close";
    return "manual_break_even_close";
  }
  // stale
  if (pnl === "profit") return "manual_stale_profit_close";
  if (pnl === "loss") return "manual_stale_loss_close";
  return "manual_stale_break_even_close";
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

  // ── Gate 1: 12-24h "İZLENİYOR" window — manual close blocked ───────────
  const age = ageBucketFor(trade.opened_at);
  if (age === "monitoring") {
    await botLog({
      userId,
      exchange: trade.exchange_name,
      level: "warn",
      eventType: "paper_trade_close_blocked_under_observation",
      message: `Manuel kapatma reddedildi — pozisyon izleme penceresinde (12-24s): ${trade.symbol} ${trade.direction}`,
      metadata: { tradeId: trade.id, symbol: trade.symbol, ageBucket: age },
    });
    return closeFail(
      "Pozisyon izleme sürecinde; kapatma devre dışı.",
      "POSITION_UNDER_OBSERVATION",
      409,
    );
  }

  await botLog({
    userId,
    exchange: trade.exchange_name,
    eventType: "paper_trade_close_requested",
    message: `Manuel paper close isteği: ${trade.symbol} ${trade.direction} (${trade.id})`,
    metadata: { tradeId: trade.id, symbol: trade.symbol, reason: parsed.reason, ageBucket: age },
  });

  // ── Step 1: try exchange ticker (Binance / active adapter) ─────────────
  let closePrice: number | null = null;
  let closePriceSource: ClosePriceSource = "binance";
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
      message: `Exchange ticker alınamadı (${primaryErrorCode} status=${primaryStatus}); fallback zinciri denenecek`,
      metadata: {
        tradeId: trade.id,
        symbol: trade.symbol,
        status: primaryStatus,
        message: e instanceof Error ? e.message : String(e),
      },
    });
  }

  // ── Step 2: fallback chain (scanner → signal → metadata → log) ─────────
  // Entry price is intentionally NOT a fallback — using it would zero the
  // unrealized PnL and bypass the loss-close gate. resolveClosePriceFallback
  // walks the chain and returns null when every reliable source is empty.
  if (closePrice == null) {
    const resolved = await resolveClosePriceFallback(userId, {
      id: trade.id,
      symbol: trade.symbol,
      risk_metadata: trade.risk_metadata as Record<string, unknown> | null,
    });
    if (resolved != null) {
      closePrice = resolved.price;
      closePriceSource = resolved.source;
      await botLog({
        userId,
        exchange: trade.exchange_name,
        level: "warn",
        eventType: "paper_trade_close_price_fallback_used",
        message: `Fallback fiyat kullanıldı (${trade.symbol} @ ${resolved.price}); kaynak: ${resolved.source}${resolved.ageMs != null ? ` (${Math.round(resolved.ageMs / 1000)}s)` : ""}`,
        metadata: {
          tradeId: trade.id,
          symbol: trade.symbol,
          fallbackPrice: resolved.price,
          fallbackSource: resolved.source,
          fallbackAgeMs: resolved.ageMs ?? null,
          primaryStatus,
          primaryErrorCode,
        },
      });
    }
  }

  // ── Step 3: still no reliable price → structured error, position stays open
  if (closePrice == null) {
    const code: CloseErrorCode = primaryErrorCode ?? "PRICE_UNAVAILABLE";
    const message = primaryStatus === 451
      ? "Binance fiyat verisine erişilemedi (451) ve fallback zincirinin tüm kaynakları boş; paper pozisyon kapatılamadı."
      : "Güvenilir güncel fiyat bulunamadı (binance/scanner/signal/metadata/log); paper pozisyon kapatılamadı.";
    await botLog({
      userId,
      exchange: trade.exchange_name,
      level: "warn",
      eventType: "paper_trade_close_price_unavailable",
      message: `Fallback zinciri boş: ${trade.symbol} (${code} status=${primaryStatus})`,
      metadata: { tradeId: trade.id, symbol: trade.symbol, code, primaryStatus },
    });
    await botLog({
      userId,
      exchange: trade.exchange_name,
      level: "error",
      eventType: "paper_trade_manual_close_failed",
      message: `Fiyat alınamadı: ${trade.symbol} (${code} status=${primaryStatus})`,
      metadata: { tradeId: trade.id, symbol: trade.symbol, code, primaryStatus },
    });
    return closeFail(message, code, 503, { primaryStatus });
  }

  // ── Gate 2: net unrealized PnL bucket + loss-close confirmation ────────
  const { netPnl, pnlPct } = estimateNetUnrealizedPnl({
    direction: trade.direction as "LONG" | "SHORT",
    entryPrice: Number(trade.entry_price),
    positionSize: Number(trade.position_size),
    marginUsed: Number(trade.margin_used),
    openedAt: String(trade.opened_at),
    currentPrice: closePrice,
  });
  const pnlCat = pnlBucketFor(netPnl);

  if (pnlCat === "loss" && !parsed.confirmLossClose) {
    const event = age === "stale"
      ? "paper_trade_manual_stale_loss_close_confirmation_required"
      : "paper_trade_manual_loss_close_confirmation_required";
    await botLog({
      userId,
      exchange: trade.exchange_name,
      level: "warn",
      eventType: event,
      message: `Zarar onayı gerekiyor: ${trade.symbol} ${trade.direction} netPnl=${netPnl.toFixed(4)} USDT`,
      metadata: { tradeId: trade.id, symbol: trade.symbol, netPnl, pnlPct, ageBucket: age, currentPrice: closePrice },
    });
    return closeFail(
      "Pozisyon zararda. Kapatmak için kullanıcı onayı gerekir.",
      "LOSS_CLOSE_CONFIRMATION_REQUIRED",
      409,
      { netUnrealizedPnl: netPnl, netUnrealizedPnlPct: pnlPct, currentPrice: closePrice, ageBucket: age },
    );
  }

  // ── Gate 3: emit canonical request log per (age, pnl) bucket ───────────
  const exitReason = canonicalExitReason(age, pnlCat);
  const requestEventType =
    age === "fresh"
      ? pnlCat === "profit"
        ? "paper_trade_manual_profit_close_requested"
        : pnlCat === "loss"
          ? "paper_trade_manual_loss_close_confirmed"
          : "paper_trade_manual_break_even_close_requested"
      : pnlCat === "profit"
        ? "paper_trade_manual_stale_profit_close_requested"
        : pnlCat === "loss"
          ? "paper_trade_manual_stale_loss_close_confirmed"
          : "paper_trade_manual_stale_break_even_close_requested";

  await botLog({
    userId,
    exchange: trade.exchange_name,
    eventType: requestEventType,
    message: `${exitReason}: ${trade.symbol} ${trade.direction} netPnl=${netPnl.toFixed(4)} USDT`,
    metadata: { tradeId: trade.id, symbol: trade.symbol, netPnl, pnlPct, ageBucket: age, pnlBucket: pnlCat, currentPrice: closePrice },
  });

  // ── Step 4: persist via canonical close helper (no exchange order) ─────
  try {
    const updated = await closePaperTrade({
      userId,
      tradeId: parsed.tradeId,
      exitPrice: closePrice,
      exitReason,
    });
    await botLog({
      userId,
      exchange: trade.exchange_name,
      eventType: "paper_trade_close_success",
      message: `Paper close OK: ${trade.symbol} @ ${closePrice} src=${closePriceSource} reason=${exitReason}`,
      metadata: {
        tradeId: trade.id,
        symbol: trade.symbol,
        closePrice,
        closePriceSource,
        primaryErrorCode: primaryErrorCode ?? null,
        ageBucket: age,
        pnlBucket: pnlCat,
        exitReason,
      },
    });
    return NextResponse.json({
      ok: true,
      data: updated,
      trade: updated,
      closePriceSource,
      ageBucket: age,
      pnlBucket: pnlCat,
      exitReason,
      ...(closePriceSource !== "binance"
        ? { warning: `Fallback fiyat kullanıldı (kaynak: ${closePriceSource}).` }
        : {}),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Paper close başarısız";
    await botLog({
      userId,
      exchange: trade.exchange_name,
      level: "error",
      eventType: "paper_trade_manual_close_failed",
      message: `closePaperTrade exception: ${trade.symbol} — ${message}`,
      metadata: { tradeId: trade.id, symbol: trade.symbol, error: message },
    });
    return closeFail(`Paper pozisyon kapatılamadı: ${message}`, "CLOSE_FAILED", 500);
  }
}
