// Bot orchestrator — kill switch, pause/resume, single decision tick.

import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { botLog, riskEvent } from "@/lib/logger";
import { evaluateOpenTrades, openPaperTrade } from "./paper-trading-engine";
import { evaluateRisk } from "./risk-engine";
import { generateSignal } from "./signal-engine";
import { getAdapter } from "@/lib/exchanges/exchange-factory";
import { getDailyStatus } from "./daily-target";
import type { ExchangeName, Timeframe } from "@/lib/exchanges/types";

export type BotStatus = "running" | "paused" | "stopped" | "kill_switch";

const PAPER_BALANCE = 1000; // virtual balance for paper risk sizing

async function loadSettings(userId: string) {
  if (!supabaseConfigured()) return null;
  const sb = supabaseAdmin();
  const { data } = await sb.from("bot_settings").select("*").eq("user_id", userId).maybeSingle();
  if (data) return data;
  const insert = {
    user_id: userId,
    active_exchange: env.defaultActiveExchange,
    trading_mode: env.defaultTradingMode,
    market_type: env.defaultMarketType,
    margin_mode: env.defaultMarginMode,
    bot_status: "stopped",
    max_leverage: env.maxLeverage,
    max_allowed_leverage: env.maxAllowedLeverage,
    risk_per_trade_percent: env.maxRiskPerTradePercent,
    max_daily_loss_percent: env.maxDailyLossPercent,
    max_weekly_loss_percent: env.maxWeeklyLossPercent,
    daily_profit_target_usd: env.dailyProfitTargetUsd,
    max_open_positions: env.maxOpenPositions,
    min_risk_reward_ratio: env.minRiskRewardRatio,
  };
  const { data: created } = await sb.from("bot_settings").insert(insert).select().single();
  return created;
}

export async function getBotState(userId: string) {
  const settings = await loadSettings(userId);
  return settings;
}

export async function setBotStatus(userId: string, status: BotStatus, reason?: string) {
  if (!supabaseConfigured()) return null;
  const sb = supabaseAdmin();
  const { data } = await sb.from("bot_settings").upsert({
    user_id: userId,
    bot_status: status,
    kill_switch_active: status === "kill_switch",
  }, { onConflict: "user_id" }).select().single();
  await botLog({
    userId, level: status === "kill_switch" ? "warn" : "info",
    eventType: `bot_${status}`,
    message: `Bot status -> ${status}${reason ? `: ${reason}` : ""}`,
  });
  if (status === "kill_switch") {
    await riskEvent({ userId, eventType: "kill_switch", severity: "critical", message: reason ?? "Kill switch tetiklendi" });
  }
  return data;
}

export async function tickBot(userId: string, opts?: { timeframe?: Timeframe; symbols?: string[] }) {
  const settings = await loadSettings(userId);
  if (!settings) {
    return { ok: false, reason: "Supabase yapılandırılmamış" };
  }
  if (settings.bot_status !== "running") {
    return { ok: false, reason: `Bot durumu: ${settings.bot_status}` };
  }

  // Sweep open paper trades for SL/TP first.
  await evaluateOpenTrades(userId);

  const exchange = settings.active_exchange as ExchangeName;
  const adapter = getAdapter(exchange);
  const tf: Timeframe = opts?.timeframe ?? "15m";

  const sb = supabaseAdmin();
  const { data: watched } = await sb.from("watched_symbols")
    .select("symbol").eq("user_id", userId).eq("exchange_name", exchange)
    .eq("market_type", "futures").eq("is_active", true);
  const symbols = (opts?.symbols && opts.symbols.length > 0)
    ? opts.symbols
    : (watched?.map((w) => w.symbol) ?? ["BTC/USDT", "ETH/USDT", "SOL/USDT"]);

  const daily = await getDailyStatus(userId, PAPER_BALANCE);
  if (daily.targetHit) {
    await botLog({ userId, eventType: "daily_target_hit", message: "Günlük kâr hedefi tamamlandı — yeni işlem yok" });
    return { ok: true, opened: 0, reason: "daily_target_hit" };
  }
  if (daily.lossLimitHit) {
    await setBotStatus(userId, "paused", "daily_loss_limit_hit");
    return { ok: true, opened: 0, reason: "daily_loss_limit_hit" };
  }

  const { data: openPositions } = await sb.from("paper_trades")
    .select("id").eq("user_id", userId).eq("status", "open");
  const openCount = openPositions?.length ?? 0;
  if (openCount >= settings.max_open_positions) {
    return { ok: true, opened: 0, reason: "max_open_positions" };
  }

  let opened = 0;
  let btcKlines: any[] = [];
  try { btcKlines = await adapter.getKlines("BTC/USDT", tf, 250); } catch { /* optional */ }

  for (const symbol of symbols) {
    try {
      const [klines, ticker, info, funding] = await Promise.all([
        adapter.getKlines(symbol, tf, 250),
        adapter.getTicker(symbol),
        adapter.getExchangeInfo(symbol),
        adapter.getFundingRate(symbol),
      ]);
      const sig = generateSignal({ symbol, timeframe: tf, klines, ticker, funding, btcKlines });

      // Persist signal for audit
      await sb.from("signals").insert({
        user_id: userId, exchange_name: exchange, market_type: "futures", margin_mode: settings.margin_mode,
        symbol, timeframe: tf, signal_type: sig.signalType, signal_score: sig.score,
        entry_price: sig.entryPrice, stop_loss: sig.stopLoss, take_profit: sig.takeProfit,
        risk_reward_ratio: sig.riskRewardRatio, reasons: sig.reasons,
        rejected_reason: sig.rejectedReason ?? null,
      });

      if (sig.signalType !== "LONG" && sig.signalType !== "SHORT") continue;
      if (!sig.entryPrice || !sig.stopLoss || !sig.takeProfit) continue;

      const liq = await adapter.getEstimatedLiquidationPrice({
        symbol, direction: sig.signalType, entryPrice: sig.entryPrice, leverage: settings.max_leverage, marginMode: "isolated",
      });

      const risk = evaluateRisk({
        accountBalanceUsd: PAPER_BALANCE,
        symbol,
        direction: sig.signalType,
        entryPrice: sig.entryPrice,
        stopLoss: sig.stopLoss,
        takeProfit: sig.takeProfit,
        signalScore: sig.score,
        marketSpread: ticker.spread,
        recentLossStreak: 0,
        openPositionCount: openCount + opened,
        dailyRealizedPnlUsd: daily.realizedPnlUsd,
        weeklyRealizedPnlUsd: daily.realizedPnlUsd,
        dailyTargetHit: daily.targetHit,
        conservativeMode: false,
        killSwitchActive: settings.kill_switch_active,
        webSocketHealthy: true,
        apiHealthy: true,
        dataFresh: true,
        fundingRate: funding?.rate,
        estimatedLiquidationPrice: liq,
        exchangeMaxLeverage: info?.maxLeverage,
        exchangeMinOrderSize: info?.minOrderSize,
        exchangeStepSize: info?.stepSize,
        exchangeTickSize: info?.tickSize,
        marginMode: "isolated",
      });
      if (!risk.allowed) {
        await botLog({
          userId, exchange, eventType: "risk_blocked",
          message: `${symbol} ${sig.signalType} reddedildi: ${risk.reason}`,
          metadata: { violations: risk.ruleViolations, signalScore: sig.score },
        });
        continue;
      }

      await openPaperTrade({
        userId, exchange, symbol, direction: sig.signalType,
        entryPrice: sig.entryPrice, stopLoss: sig.stopLoss, takeProfit: sig.takeProfit,
        leverage: risk.leverage, positionSize: risk.positionSize, marginUsed: risk.marginUsed,
        riskAmount: risk.riskAmount, riskRewardRatio: risk.riskRewardRatio,
        marginMode: "isolated", estimatedLiquidationPrice: risk.estimatedLiquidationPrice ?? null,
        signalScore: sig.score, entryReason: sig.reasons.join(" • "),
      });
      opened++;
      if (openCount + opened >= settings.max_open_positions) break;
    } catch (e: any) {
      await botLog({ userId, exchange, level: "error", eventType: "tick_error", message: `${symbol}: ${e?.message ?? e}` });
    }
  }
  return { ok: true, opened };
}
