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
  // Faz 20 — risk lifecycle metadata
  riskMetadata?: {
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
