// Faz 21 — GET /api/position-management/recommendations
//
// Read-only endpoint: mevcut paper/live açık pozisyonları okur ve
// kademeli yönetim önerisi üretir.
//
// MUTLAK KURALLAR:
//   • Emir göndermez.
//   • Binance API çağrısı yapmaz.
//   • HARD_LIVE_TRADING_ALLOWED=false korunur.
//   • Sadece pozisyon yönetimi önerisi (advisory) döner.
//   • ?mode=paper | ?mode=live | ?mode=all desteklenir.
//     Bu fazda sadece paper pozisyonlar işlenir.

import { ok, fail } from "@/lib/api-helpers";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth";
import { evaluatePosition } from "@/lib/position-management";
import type { PositionManagementInput, PositionManagementDecision } from "@/lib/position-management";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface RecommendationsResponse {
  recommendations: PositionManagementDecision[];
  total: number;
  mode: string;
  evaluatedAt: string;
  advisoryOnly: true;
}

export async function GET(req: Request) {
  if (!supabaseConfigured()) {
    return ok<RecommendationsResponse>({
      recommendations: [],
      total: 0,
      mode: "paper",
      evaluatedAt: new Date().toISOString(),
      advisoryOnly: true,
    });
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "paper";

  try {
    const userId = getCurrentUserId();
    const sb = supabaseAdmin();

    // Read open paper positions — no Binance API call, no order execution
    const { data: openTrades, error } = await sb
      .from("paper_trades")
      .select(
        "id, symbol, direction, entry_price, stop_loss, take_profit, position_size, margin_used, risk_amount, risk_reward_ratio, signal_score, signal_confidence, opened_at, risk_metadata, risk_percent",
      )
      .eq("user_id", userId)
      .eq("status", "open")
      .order("opened_at", { ascending: false });

    if (error) {
      return fail(`Pozisyonlar okunamadı: ${error.message}`, 500);
    }

    const recommendations: PositionManagementDecision[] = [];

    for (const trade of openTrades ?? []) {
      try {
        const entryPrice = Number(trade.entry_price ?? 0);
        const stopLoss = Number(trade.stop_loss ?? 0);
        const takeProfit = Number(trade.take_profit ?? 0);
        const positionSize = Number(trade.position_size ?? 0);
        const riskAmount = Number(trade.risk_amount ?? 0);
        const rrRatio = Number(trade.risk_reward_ratio ?? 0);
        const signalScore = Number(trade.signal_score ?? 0);

        // For paper positions we don't have live mark price — use entry as current
        // (unrealizedPnl would come from a separate mark-to-market call;
        // here we use 0 as conservative baseline since no Binance price call).
        const currentPrice = entryPrice;
        const unrealizedPnl = 0;
        const unrealizedPnlPct = 0;

        const notionalUsdt =
          entryPrice > 0 ? positionSize * entryPrice : Number(trade.margin_used ?? 0);

        const input: PositionManagementInput = {
          symbol: trade.symbol,
          side: trade.direction as "LONG" | "SHORT",
          entryPrice,
          currentPrice,
          stopLoss,
          takeProfit,
          quantity: positionSize,
          notionalUsdt,
          unrealizedPnl,
          unrealizedPnlPercent: unrealizedPnlPct,
          rrRatio,
          riskAmountUsdt: riskAmount,
          tradeSignalScore: signalScore,
          setupScore: Number(trade.signal_confidence ?? signalScore),
          marketQualityScore: 75,  // conservative default
          btcAligned: true,         // conservative default — no live market data
          volumeImpulse: false,     // conservative: don't recommend scale-in without live data
          openedAt: trade.opened_at,
          mode: "paper",
        };

        const decision = evaluatePosition(input);
        recommendations.push(decision);
      } catch {
        // skip per-trade errors — non-fatal
      }
    }

    return ok<RecommendationsResponse>({
      recommendations,
      total: recommendations.length,
      mode,
      evaluatedAt: new Date().toISOString(),
      advisoryOnly: true,
    });
  } catch (e: any) {
    return fail(e?.message ?? "Öneriler üretilemedi", 500);
  }
}
