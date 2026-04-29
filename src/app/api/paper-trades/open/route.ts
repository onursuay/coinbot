import { z } from "zod";
import { fail, ok, parseBody, isResponse } from "@/lib/api-helpers";
import { getCurrentUserId } from "@/lib/auth";
import { getAdapter } from "@/lib/exchanges/exchange-factory";
import { evaluateRisk } from "@/lib/engines/risk-engine";
import { openPaperTrade } from "@/lib/engines/paper-trading-engine";
import { getDailyStatus } from "@/lib/engines/daily-target";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { buildRiskExecutionConfig, ensureHydrated } from "@/lib/risk-settings";
import type { ExchangeName, PositionDirection } from "@/lib/exchanges/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAPER_BALANCE_FALLBACK = 1000;

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

  // Faz 20: load risk execution config for capital and risk % overrides.
  await ensureHydrated();
  const riskCfg = buildRiskExecutionConfig();
  const riskCapitalSource: "risk_settings" | "capital_missing_fallback" =
    riskCfg.totalBotCapitalUsdt > 0 ? "risk_settings" : "capital_missing_fallback";
  const effectiveCapital =
    riskCfg.totalBotCapitalUsdt > 0 ? riskCfg.totalBotCapitalUsdt : PAPER_BALANCE_FALLBACK;

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
  const daily = await getDailyStatus(userId, effectiveCapital, {
    dailyMaxLossPercent: riskCfg.dailyMaxLossPercent,
  });

  const risk = evaluateRisk({
    accountBalanceUsd: effectiveCapital,
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
    // Faz 20 — risk settings overrides
    riskConfigMaxOpenPositions: riskCfg.defaultMaxOpenPositions,
    riskConfigDailyMaxLossPercent: riskCfg.dailyMaxLossPercent,
    riskConfigRiskPerTradePercent: riskCfg.riskPerTradePercent,
    riskConfigTotalCapitalUsdt: effectiveCapital,
    riskConfigCapitalSource: riskCapitalSource,
  });
  if (!risk.allowed) return fail(`Risk engine reddetti: ${risk.reason}`, 400, { ruleViolations: risk.ruleViolations });

  const stopDistPct = parsed.entryPrice > 0
    ? (Math.abs(parsed.entryPrice - parsed.stopLoss) / parsed.entryPrice) * 100
    : 0;

  const trade = await openPaperTrade({
    userId, exchange,
    symbol: parsed.symbol, direction,
    entryPrice: parsed.entryPrice, stopLoss: parsed.stopLoss, takeProfit: parsed.takeProfit,
    leverage: risk.leverage, positionSize: risk.positionSize, marginUsed: risk.marginUsed,
    riskAmount: risk.riskAmount, riskRewardRatio: risk.riskRewardRatio,
    marginMode: "isolated", estimatedLiquidationPrice: risk.estimatedLiquidationPrice ?? null,
    signalScore: parsed.signalScore, entryReason: parsed.entryReason,
    riskPercent: riskCfg.riskPerTradePercent,
    riskMetadata: {
      risk_amount_usdt: risk.riskAmount,
      risk_per_trade_percent: riskCfg.riskPerTradePercent,
      position_notional_usdt: risk.positionSize * parsed.entryPrice,
      stop_distance_percent: stopDistPct,
      risk_config_source: riskCapitalSource,
      risk_config_bound: true,
    },
  });
  return ok(trade);
}
