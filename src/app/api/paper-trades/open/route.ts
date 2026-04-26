import { z } from "zod";
import { fail, ok, parseBody, isResponse } from "@/lib/api-helpers";
import { getCurrentUserId } from "@/lib/auth";
import { getAdapter } from "@/lib/exchanges/exchange-factory";
import { evaluateRisk } from "@/lib/engines/risk-engine";
import { openPaperTrade } from "@/lib/engines/paper-trading-engine";
import { getDailyStatus } from "@/lib/engines/daily-target";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import type { ExchangeName, PositionDirection } from "@/lib/exchanges/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAPER_BALANCE = 1000;

const Body = z.object({
  exchange: z.enum(["mexc", "binance", "okx", "bybit"]),
  symbol: z.string().min(2),
  direction: z.enum(["LONG", "SHORT"]),
  entryPrice: z.number().positive(),
  stopLoss: z.number().positive(),
  takeProfit: z.number().positive(),
  signalScore: z.number().min(0).max(100).default(85),
  entryReason: z.string().optional(),
});

export async function POST(req: Request) {
  if (!supabaseConfigured()) return fail("Supabase yapılandırılmamış", 500);
  const parsed = await parseBody(req, Body);
  if (isResponse(parsed)) return parsed;
  const userId = getCurrentUserId();

  const exchange = parsed.exchange as ExchangeName;
  const direction = parsed.direction as PositionDirection;
  const adapter = getAdapter(exchange);
  const [info, ticker] = await Promise.all([
    adapter.getExchangeInfo(parsed.symbol),
    adapter.getTicker(parsed.symbol),
  ]);
  const liq = await adapter.getEstimatedLiquidationPrice({
    symbol: parsed.symbol, direction, entryPrice: parsed.entryPrice,
    leverage: 3, marginMode: "isolated",
  });

  const { data: openRows } = await supabaseAdmin().from("paper_trades")
    .select("id").eq("user_id", userId).eq("status", "open");
  const daily = await getDailyStatus(userId, PAPER_BALANCE);

  const risk = evaluateRisk({
    accountBalanceUsd: PAPER_BALANCE,
    symbol: parsed.symbol,
    direction,
    entryPrice: parsed.entryPrice,
    stopLoss: parsed.stopLoss,
    takeProfit: parsed.takeProfit,
    signalScore: parsed.signalScore,
    marketSpread: ticker.spread,
    recentLossStreak: 0,
    openPositionCount: openRows?.length ?? 0,
    dailyRealizedPnlUsd: daily.realizedPnlUsd,
    weeklyRealizedPnlUsd: daily.realizedPnlUsd,
    dailyTargetHit: daily.targetHit,
    conservativeMode: false,
    killSwitchActive: false,
    webSocketHealthy: true,
    apiHealthy: true,
    dataFresh: true,
    estimatedLiquidationPrice: liq,
    exchangeMaxLeverage: info?.maxLeverage,
    exchangeMinOrderSize: info?.minOrderSize,
    exchangeStepSize: info?.stepSize,
    marginMode: "isolated",
  });
  if (!risk.allowed) return fail(`Risk engine reddetti: ${risk.reason}`, 400, { ruleViolations: risk.ruleViolations });

  const trade = await openPaperTrade({
    userId, exchange,
    symbol: parsed.symbol, direction,
    entryPrice: parsed.entryPrice, stopLoss: parsed.stopLoss, takeProfit: parsed.takeProfit,
    leverage: risk.leverage, positionSize: risk.positionSize, marginUsed: risk.marginUsed,
    riskAmount: risk.riskAmount, riskRewardRatio: risk.riskRewardRatio,
    marginMode: "isolated", estimatedLiquidationPrice: risk.estimatedLiquidationPrice ?? null,
    signalScore: parsed.signalScore, entryReason: parsed.entryReason,
  });
  return ok(trade);
}
