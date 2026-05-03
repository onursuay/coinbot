// Futures Paper Trading Engine — gerçek emir göndermez. Borsa adapter'ından
// canlı fiyat alır; entry/stop/tp seviyelerini gerçekçi şekilde simüle eder.

import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getAdapter } from "@/lib/exchanges/exchange-factory";
import { botLog } from "@/lib/logger";
import { recordLearningEvent } from "@/lib/learning/learning-events";
import { analyzeOutcome, generateLesson, type ClosedTradeContext } from "@/lib/learning/lesson-engine";
import type { ExchangeName, MarginMode, PositionDirection } from "@/lib/exchanges/types";

export interface OpenPaperTradeInput {
  userId: string;
  exchange: ExchangeName;
  symbol: string;
  direction: PositionDirection;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  leverage: number;
  positionSize: number;
  marginUsed: number;
  riskAmount: number;
  riskRewardRatio: number;
  marginMode?: MarginMode;
  estimatedLiquidationPrice?: number | null;
  signalScore?: number;
  entryReason?: string;
  tier?: string;
  spreadPercent?: number;
  atrPercent?: number;
  fundingRate?: number;
  signalConfidence?: number;
  riskPercent?: number;
  // Faz 20 — risk lifecycle metadata. Open shape so future paper-only
  // diagnostic fields (e.g. May 2026 sizingVersion=risk_cap_v1 + sizing
  // cap diag fields) can be attached without re-typing every site.
  riskMetadata?: Record<string, unknown> & {
    risk_amount_usdt?: number;
    risk_per_trade_percent?: number;
    position_notional_usdt?: number;
    stop_distance_percent?: number;
    risk_config_source?: string;
    risk_config_bound?: boolean;
  };
}

const FEE_RATE = 0.0004;       // 4 bps per side (taker)
const SLIPPAGE_RATE = 0.0005;  // 5 bps slippage assumption

// Pure unrealized PnL preview — same fees/slippage/funding model as
// closePaperTrade. Used by /api/paper-trades GET to enrich open rows and by
// /api/paper-trades/close POST to evaluate the loss-close confirmation gate.
// Keeping this as a single source of truth ensures the UI button color and
// the server guard see the same number.
export function estimateNetUnrealizedPnl(args: {
  direction: "LONG" | "SHORT";
  entryPrice: number;
  positionSize: number;
  marginUsed: number;
  openedAt: string;
  currentPrice: number;
}): { netPnl: number; pnlPct: number } {
  const sign = args.direction === "LONG" ? 1 : -1;
  const grossPnl = sign * (args.currentPrice - args.entryPrice) * args.positionSize;
  const fees = (args.entryPrice + args.currentPrice) * args.positionSize * FEE_RATE;
  const slippage = (args.entryPrice + args.currentPrice) * args.positionSize * SLIPPAGE_RATE * 0.5;
  const hoursOpen = Math.max(0, (Date.now() - new Date(args.openedAt).getTime()) / 3_600_000);
  const fundingEst = args.positionSize * args.entryPrice * 0.0001 * (hoursOpen / 8);
  const netPnl = grossPnl - fees - slippage - fundingEst;
  const pnlPct = args.marginUsed > 0 ? (netPnl / args.marginUsed) * 100 : 0;
  return { netPnl, pnlPct };
}

// Stable label set for the close-price fallback chain. Returned as
// `closePriceSource` from the close API and used by the GET route to tag the
// `current_price_source` field on each enriched open row.
//
// Chain order (most reliable → last resort):
//   binance  — exchange ticker call succeeded
//   scanner  — signals.entry_price ≤5 minutes old (very fresh, from worker tick)
//   signal   — signals.entry_price ≤60 minutes old (less fresh)
//   metadata — trade.risk_metadata.{currentPrice|lastPrice|mark_price|last_price}
//   log      — bot_logs metadata.entryPrice on a recent signal_generated event
//              for the same symbol (≤60 minutes)
//
// Guardrails enforced by the resolver:
//   • Entry price (paper_trades.entry_price) is NEVER auto-substituted — using
//     it would zero the unrealized PnL and mislead the loss-close gate.
//   • Anything older than 60 minutes is rejected outright.
//   • If every source fails, the resolver returns null and the close API
//     returns PRICE_UNAVAILABLE / BINANCE_451 / BINANCE_BLOCKED so no
//     position is closed against a stale or made-up price.
export type ClosePriceSource = "binance" | "scanner" | "signal" | "metadata" | "log";

export interface ResolvedClosePrice {
  price: number;
  source: ClosePriceSource;
  ageMs?: number;
}

/** Numeric coercion that filters out NaN, ±Infinity, zero and negative values. */
function safePositive(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Resolve the close price using the full fallback chain (no exchange ticker —
 *  the caller does that separately and only delegates here when the ticker
 *  failed). Used by both the close API and the GET enrichment so the button
 *  colour and the server gate see the same number. */
export async function resolveClosePriceFallback(
  userId: string,
  trade: { id: string; symbol: string; risk_metadata?: Record<string, unknown> | null },
): Promise<ResolvedClosePrice | null> {
  if (!supabaseConfigured()) return null;
  const sb = supabaseAdmin();
  const now = Date.now();

  // 2. scanner / signal — signals.entry_price within 60 minutes.
  // Tag as "scanner" if ≤5 min old, otherwise "signal".
  try {
    const sinceIso = new Date(now - 60 * 60 * 1000).toISOString();
    const { data } = await sb
      .from("signals")
      .select("entry_price, created_at")
      .eq("user_id", userId)
      .eq("symbol", trade.symbol)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(1);
    const px = safePositive(data?.[0]?.entry_price);
    const createdAt = data?.[0]?.created_at ? new Date(String(data[0].created_at)).getTime() : null;
    if (px != null && createdAt != null) {
      const ageMs = now - createdAt;
      const source: ClosePriceSource = ageMs <= 5 * 60 * 1000 ? "scanner" : "signal";
      return { price: px, source, ageMs };
    }
  } catch {
    /* ignore — try next source */
  }

  // 3. metadata — fields the orchestrator may have stamped on the trade row
  // (paper_learning, force_paper, manual edits). Never fall back to entry_price.
  const meta = (trade.risk_metadata ?? null) as Record<string, unknown> | null;
  if (meta) {
    for (const key of ["currentPrice", "lastPrice", "mark_price", "last_price", "markPrice", "current_price"]) {
      const px = safePositive(meta[key]);
      if (px != null) return { price: px, source: "metadata" };
    }
  }

  // 4. log — most recent signal_generated event for the symbol that captured
  // entryPrice in its metadata (see bot-orchestrator.ts: signal_generated log).
  try {
    const sinceIso = new Date(now - 60 * 60 * 1000).toISOString();
    const { data } = await sb
      .from("bot_logs")
      .select("metadata, created_at, event_type")
      .eq("user_id", userId)
      .eq("event_type", "signal_generated")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(20);
    for (const row of data ?? []) {
      const md = (row?.metadata ?? null) as Record<string, unknown> | null;
      if (!md) continue;
      // The signal_generated log is summary-level (no symbol field). To keep
      // this useful we only accept it as a *generic* market-stamp source when
      // the metadata explicitly names the same symbol; otherwise skip.
      const sym = String(md.symbol ?? "");
      if (sym !== trade.symbol) continue;
      const px = safePositive(md.entryPrice ?? md.entry_price ?? md.lastPrice ?? md.price);
      if (px != null) {
        const createdAt = row.created_at ? new Date(String(row.created_at)).getTime() : null;
        return { price: px, source: "log", ageMs: createdAt ? now - createdAt : undefined };
      }
    }
  } catch {
    /* ignore */
  }

  return null;
}

/** Mark-price fetcher for the GET /api/paper-trades enrichment. Tries the
 *  exchange ticker first, then falls through to the unified fallback chain.
 *  Returns a map of trade id → { price, source } (or null if every source
 *  failed). */
export async function fetchOpenTradeMarkPrices(
  userId: string,
): Promise<Record<string, ResolvedClosePrice | null>> {
  if (!supabaseConfigured()) return {};
  const sb = supabaseAdmin();
  const { data: open } = await sb
    .from("paper_trades")
    .select("id, exchange_name, symbol, risk_metadata")
    .eq("user_id", userId)
    .eq("status", "open");
  const result: Record<string, ResolvedClosePrice | null> = {};
  await Promise.all(
    (open ?? []).map(
      async (t: { id: string; exchange_name: ExchangeName; symbol: string; risk_metadata?: Record<string, unknown> | null }) => {
        let resolved: ResolvedClosePrice | null = null;
        try {
          const tk = await getAdapter(t.exchange_name).getTicker(t.symbol);
          const px = safePositive(tk.lastPrice);
          if (px != null) resolved = { price: px, source: "binance" };
        } catch {
          /* ignore — fall through */
        }
        if (resolved == null) {
          resolved = await resolveClosePriceFallback(userId, t);
        }
        result[t.id] = resolved;
      },
    ),
  );
  return result;
}

export async function openPaperTrade(input: OpenPaperTradeInput) {
  // Defense-in-depth: never persist a paper trade without a finite, positive
  // signal score. Orchestrator's hard gate is the primary guard; this catches
  // any future caller that bypasses it. Runs BEFORE the Supabase check so the
  // invariant holds even when Supabase isn't configured.
  if (
    input.signalScore === undefined ||
    input.signalScore === null ||
    typeof input.signalScore !== "number" ||
    !Number.isFinite(input.signalScore) ||
    input.signalScore <= 0
  ) {
    throw new Error(
      `openPaperTrade: NO_VALID_SIGNAL_SCORE — paper trade for ${input.symbol} ${input.direction} reddedildi (signalScore=${String(input.signalScore)})`,
    );
  }
  if (input.direction !== "LONG" && input.direction !== "SHORT") {
    throw new Error(
      `openPaperTrade: SIGNAL_TYPE_MISSING — paper trade for ${input.symbol} reddedildi (direction=${String(input.direction)})`,
    );
  }
  if (!supabaseConfigured()) {
    throw new Error("Supabase yapılandırılmamış — paper trade kaydedilemez");
  }
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("paper_trades")
    .insert({
      user_id: input.userId,
      exchange_name: input.exchange,
      market_type: "futures",
      margin_mode: input.marginMode ?? "isolated",
      symbol: input.symbol,
      direction: input.direction,
      entry_price: input.entryPrice,
      stop_loss: input.stopLoss,
      take_profit: input.takeProfit,
      leverage: input.leverage,
      position_size: input.positionSize,
      margin_used: input.marginUsed,
      risk_amount: input.riskAmount,
      risk_reward_ratio: input.riskRewardRatio,
      estimated_liquidation_price: input.estimatedLiquidationPrice ?? null,
      signal_score: input.signalScore ?? null,
      entry_reason: input.entryReason ?? null,
      tier: input.tier ?? null,
      spread_percent: input.spreadPercent ?? null,
      atr_percent: input.atrPercent ?? null,
      funding_rate: input.fundingRate ?? null,
      is_paper: true,
      signal_confidence: input.signalConfidence ?? null,
      risk_percent: input.riskPercent ?? null,
      risk_metadata: input.riskMetadata ?? null,
      fees_estimated: input.entryPrice * input.positionSize * FEE_RATE,
      slippage_estimated: input.entryPrice * input.positionSize * SLIPPAGE_RATE,
      status: "open",
      opened_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw error;
  await botLog({
    userId: input.userId, exchange: input.exchange,
    eventType: "paper_open",
    message: `${input.direction} ${input.symbol} @ ${input.entryPrice} lev=${input.leverage}x`,
    metadata: { tradeId: data.id, signalScore: input.signalScore },
  });
  return data;
}

export interface ClosePaperTradeInput {
  userId: string;
  tradeId: string;
  exitPrice: number;
  exitReason: string;
}

export async function closePaperTrade(input: ClosePaperTradeInput) {
  const sb = supabaseAdmin();
  const { data: trade, error: e1 } = await sb
    .from("paper_trades")
    .select("*").eq("id", input.tradeId).eq("user_id", input.userId).single();
  if (e1 || !trade) throw e1 ?? new Error("Trade bulunamadı");
  if (trade.status !== "open") return trade;

  const sign = trade.direction === "LONG" ? 1 : -1;
  const grossPnl = sign * (input.exitPrice - trade.entry_price) * trade.position_size;
  const fees = (trade.entry_price + input.exitPrice) * trade.position_size * FEE_RATE;
  const slippage = (trade.entry_price + input.exitPrice) * trade.position_size * SLIPPAGE_RATE * 0.5;
  // Funding cost rough estimate per hour open (not material for short-lived trades).
  const hoursOpen = Math.max(0, (Date.now() - new Date(trade.opened_at).getTime()) / 3_600_000);
  const fundingEst = trade.position_size * trade.entry_price * 0.0001 * (hoursOpen / 8);

  const netPnl = grossPnl - fees - slippage - fundingEst;
  const pnlPct = trade.margin_used > 0 ? (netPnl / trade.margin_used) * 100 : 0;

  const { data, error } = await sb
    .from("paper_trades")
    .update({
      exit_price: input.exitPrice,
      exit_reason: input.exitReason,
      pnl: netPnl,
      pnl_percent: pnlPct,
      fees_estimated: fees,
      slippage_estimated: slippage,
      funding_estimated: fundingEst,
      status: "closed",
      closed_at: new Date().toISOString(),
    })
    .eq("id", input.tradeId)
    .select().single();
  if (error) throw error;

  await botLog({
    userId: input.userId, exchange: trade.exchange_name,
    eventType: "paper_close",
    message: `${trade.direction} ${trade.symbol} kapandı @ ${input.exitPrice} pnl=${netPnl.toFixed(2)} (${input.exitReason})`,
    metadata: { tradeId: trade.id },
  });

  // Paper Learning outcome analysis + lesson — best-effort. Only writes
  // trade_learning_events when the trade was opened under PAPER_LEARNING_MODE.
  try {
    const meta = (trade.risk_metadata ?? null) as Record<string, unknown> | null;
    const isLearningTrade = meta?.paper_learning_mode === true || meta?.opened_by === "PAPER_LEARNING_MODE";
    if (isLearningTrade) {
      const ctx: ClosedTradeContext = {
        symbol: trade.symbol,
        direction: trade.direction as "LONG" | "SHORT",
        pnl: netPnl,
        pnlPercent: pnlPct,
        exitReason: input.exitReason,
        hoursOpen,
        bypassedRiskGates: Array.isArray(meta?.bypassed_risk_gates)
          ? (meta!.bypassed_risk_gates as string[])
          : Array.isArray(meta?.bypassed_gates)
            ? (meta!.bypassed_gates as string[])
            : [],
        normalModeWouldReject: typeof meta?.normal_mode_would_reject === "boolean" ? (meta!.normal_mode_would_reject as boolean) : null,
        originalRejectReason: typeof meta?.original_reject_reason === "string" ? (meta!.original_reject_reason as string) : null,
        originalSignalScore: typeof meta?.original_signal_score === "number" ? (meta!.original_signal_score as number) : null,
        originalMarketQualityScore: typeof meta?.original_market_quality_score === "number" ? (meta!.original_market_quality_score as number) : null,
        generatedFallbackSlTp: typeof meta?.generated_fallback_sl_tp === "boolean" ? (meta!.generated_fallback_sl_tp as boolean) : null,
        btcTrendState: typeof meta?.btc_trend_state === "string" ? (meta!.btc_trend_state as string) : null,
        marketRegime: typeof meta?.market_regime === "string" ? (meta!.market_regime as string) : null,
      };
      const analysis = analyzeOutcome(ctx);
      const lesson = generateLesson(ctx);

      await recordLearningEvent({
        paperTradeId: String(trade.id),
        symbol: trade.symbol,
        direction: trade.direction as "LONG" | "SHORT",
        eventType: "closed",
        eventJson: {
          exitPrice: input.exitPrice,
          exitReason: input.exitReason,
          pnl: netPnl,
          pnlPercent: pnlPct,
          hoursOpen,
        },
      });
      await recordLearningEvent({
        paperTradeId: String(trade.id),
        symbol: trade.symbol,
        direction: trade.direction as "LONG" | "SHORT",
        eventType: "outcome_analyzed",
        eventJson: {
          outcome: analysis.outcome,
          riskWarrantedFlag: analysis.riskWarrantedFlag,
          bypassesEvaluated: analysis.bypassesEvaluated,
          notes: analysis.notes,
        },
      });
      await recordLearningEvent({
        paperTradeId: String(trade.id),
        symbol: trade.symbol,
        direction: trade.direction as "LONG" | "SHORT",
        eventType: "lesson_created",
        eventJson: {
          tags: lesson.tags,
          outcome: lesson.outcome,
        },
        llmSummary: lesson.text,
      });
      await botLog({
        userId: input.userId, exchange: trade.exchange_name,
        eventType: "paper_learning_lesson_created",
        message: `[PAPER LEARNING] ${trade.symbol} ${trade.direction} → ${lesson.outcome} • ${lesson.text}`,
        metadata: { tradeId: trade.id, outcome: lesson.outcome, tags: lesson.tags },
      });
    }
  } catch (e) {
    // Outcome analysis failure must never block paper close flow.
    // eslint-disable-next-line no-console
    console.warn("[learning] outcome analysis failed:", (e as Error).message);
  }

  return data;
}

// Mark-to-market sweep: SL/TP/break-even/trailing checks against live price.
export async function evaluateOpenTrades(userId: string) {
  if (!supabaseConfigured()) return { processed: 0, closed: 0 };
  const sb = supabaseAdmin();
  const { data: open } = await sb
    .from("paper_trades").select("*")
    .eq("user_id", userId).eq("status", "open");
  let closed = 0;
  for (const t of open ?? []) {
    try {
      const adapter = getAdapter(t.exchange_name);
      const tk = await adapter.getTicker(t.symbol);
      const px = tk.lastPrice;
      if (!px) continue;
      let exitReason: string | null = null;
      if (t.direction === "LONG") {
        if (px <= t.stop_loss) exitReason = "stop_loss";
        else if (px >= t.take_profit) exitReason = "take_profit";
      } else {
        if (px >= t.stop_loss) exitReason = "stop_loss";
        else if (px <= t.take_profit) exitReason = "take_profit";
      }
      if (exitReason) {
        await closePaperTrade({ userId, tradeId: t.id, exitPrice: px, exitReason });
        closed++;
      }
    } catch {
      /* ignore per-trade errors */
    }
  }
  return { processed: (open ?? []).length, closed };
}
