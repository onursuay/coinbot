// Order Lifecycle Manager
//
// Tracks every order from submission → ack → fill → settlement.
// Critical invariants:
//   - Every live order MUST have a clientOrderId (idempotency).
//   - Position is NOT considered "active" until fill is verified.
//   - Position is NOT considered "safe" until protective SL/TP orders are placed AND verified.
//   - On position close, ALL outstanding protective orders for that position MUST be cancelled.
//   - Periodic reconciliation: DB state vs. exchange state must match; mismatch → safe mode.
//
// This module provides the DB-level lifecycle tracking. Exchange-side order
// submission is the responsibility of the adapter layer; this module records.

import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { randomBytes } from "crypto";

export type OrderStatus =
  | "submitted"
  | "acknowledged"
  | "filled"
  | "partially_filled"
  | "cancelled"
  | "rejected"
  | "expired"
  | "failed";

export type OrderType = "MARKET" | "LIMIT" | "STOP_MARKET" | "TAKE_PROFIT_MARKET";

export interface OrderRecord {
  userId: string;
  exchangeName: string;
  symbol: string;
  side: "BUY" | "SELL";
  positionDirection: "LONG" | "SHORT";
  orderType: OrderType;
  reduceOnly?: boolean;
  isProtective?: boolean;
  parentPositionId?: string | null;
  requestedQty: number;
  tradingMode: "paper" | "live";
  rawResponse?: any;
}

export function generateClientOrderId(prefix = "bot"): string {
  return `${prefix}-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

export async function recordOrderSubmitted(p: OrderRecord & { clientOrderId: string }): Promise<{ ok: boolean; error?: string; id?: string }> {
  if (!supabaseConfigured()) return { ok: false, error: "Supabase not configured" };
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("order_lifecycle").insert({
    user_id: p.userId,
    client_order_id: p.clientOrderId,
    exchange_name: p.exchangeName,
    symbol: p.symbol,
    side: p.side,
    position_direction: p.positionDirection,
    order_type: p.orderType,
    reduce_only: p.reduceOnly ?? false,
    is_protective: p.isProtective ?? false,
    parent_position_id: p.parentPositionId ?? null,
    status: "submitted",
    requested_qty: p.requestedQty,
    remaining_qty: p.requestedQty,
    trading_mode: p.tradingMode,
    raw_response: p.rawResponse ?? null,
  }).select("id").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data?.id };
}

export async function recordOrderUpdate(clientOrderId: string, update: {
  status?: OrderStatus;
  exchangeOrderId?: string;
  filledQty?: number;
  avgFillPrice?: number;
  rawResponse?: any;
  error?: string;
}): Promise<{ ok: boolean }> {
  if (!supabaseConfigured()) return { ok: false };
  const sb = supabaseAdmin();
  const patch: Record<string, any> = { last_check_at: new Date().toISOString() };
  if (update.status) {
    patch.status = update.status;
    if (update.status === "acknowledged") patch.acknowledged_at = new Date().toISOString();
    if (update.status === "filled") patch.filled_at = new Date().toISOString();
    if (update.status === "cancelled") patch.cancelled_at = new Date().toISOString();
  }
  if (update.exchangeOrderId) patch.exchange_order_id = update.exchangeOrderId;
  if (typeof update.filledQty === "number") patch.filled_qty = update.filledQty;
  if (typeof update.avgFillPrice === "number") patch.avg_fill_price = update.avgFillPrice;
  if (update.rawResponse !== undefined) patch.raw_response = update.rawResponse;
  if (update.error) patch.reconciliation_note = update.error;

  const { error } = await sb.from("order_lifecycle").update(patch).eq("client_order_id", clientOrderId);
  return { ok: !error };
}

// Verify that a position has matching protective orders (SL + TP).
// If not, position is NOT safe.
export async function verifyProtectiveOrders(positionId: string): Promise<{ slPresent: boolean; tpPresent: boolean; safe: boolean }> {
  if (!supabaseConfigured()) return { slPresent: false, tpPresent: false, safe: false };
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("order_lifecycle")
    .select("order_type, status, is_protective")
    .eq("parent_position_id", positionId)
    .eq("is_protective", true);

  const orders = data ?? [];
  const slPresent = orders.some((o) => o.order_type === "STOP_MARKET" && (o.status === "acknowledged" || o.status === "submitted" || o.status === "filled"));
  const tpPresent = orders.some((o) => o.order_type === "TAKE_PROFIT_MARKET" && (o.status === "acknowledged" || o.status === "submitted" || o.status === "filled"));
  return { slPresent, tpPresent, safe: slPresent && tpPresent };
}

// Cancel all open protective orders for a position (called when position closes).
export async function cancelProtectiveOrdersForPosition(positionId: string): Promise<{ cancelled: number }> {
  if (!supabaseConfigured()) return { cancelled: 0 };
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("order_lifecycle")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("parent_position_id", positionId)
    .eq("is_protective", true)
    .in("status", ["submitted", "acknowledged"])
    .select("id");
  return { cancelled: data?.length ?? 0 };
}

// Periodic reconciliation: compare DB orders vs exchange state.
// Caller passes the exchange state; this module returns mismatches.
// NOTE: full implementation requires authenticated exchange API access. The
// scaffolding here records the intent; the actual exchange-side query lives
// in the adapter (binanceAccountService) once live trading is wired.
export interface ReconciliationInput {
  userId: string;
  exchangeName: string;
  exchangeOpenOrders: Array<{ clientOrderId: string; status: string; filledQty: number; avgPrice?: number }>;
}

export interface ReconciliationResult {
  ok: boolean;
  mismatches: Array<{ clientOrderId: string; dbStatus: string; exchangeStatus: string; reason: string }>;
  shouldEnterSafeMode: boolean;
}

export async function reconcileOrders(input: ReconciliationInput): Promise<ReconciliationResult> {
  if (!supabaseConfigured()) {
    return { ok: false, mismatches: [], shouldEnterSafeMode: true };
  }
  const sb = supabaseAdmin();
  const { data: dbOrders } = await sb
    .from("order_lifecycle")
    .select("client_order_id, status, filled_qty, requested_qty")
    .eq("user_id", input.userId)
    .eq("exchange_name", input.exchangeName)
    .in("status", ["submitted", "acknowledged", "partially_filled"]);

  const mismatches: ReconciliationResult["mismatches"] = [];
  const exchangeMap = new Map(input.exchangeOpenOrders.map((o) => [o.clientOrderId, o]));

  for (const dbo of dbOrders ?? []) {
    const ex = exchangeMap.get(dbo.client_order_id);
    if (!ex) {
      // DB says open, exchange has no record → potential ghost order
      mismatches.push({
        clientOrderId: dbo.client_order_id,
        dbStatus: dbo.status,
        exchangeStatus: "missing",
        reason: "Order in DB but not on exchange — possible disconnect/cancel",
      });
    } else if (Math.abs(Number(dbo.filled_qty ?? 0) - ex.filledQty) > 1e-8) {
      mismatches.push({
        clientOrderId: dbo.client_order_id,
        dbStatus: dbo.status,
        exchangeStatus: ex.status,
        reason: `Filled qty mismatch: db=${dbo.filled_qty} exchange=${ex.filledQty}`,
      });
    }
  }

  return {
    ok: mismatches.length === 0,
    mismatches,
    shouldEnterSafeMode: mismatches.length > 0,
  };
}
