// Bot orchestrator — kill switch, pause/resume, single decision tick.

import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { botLog, riskEvent } from "@/lib/logger";
import { evaluateOpenTrades, openPaperTrade } from "./paper-trading-engine";
import { evaluateRisk } from "./risk-engine";
import { generateSignal } from "./signal-engine";
import { getAdapter } from "@/lib/exchanges/exchange-factory";
import { getDailyStatus } from "./daily-target";
import { getUniverseSlice, type ScanUniverse } from "./symbol-universe";
import { isAutoTradeAllowed, applyDynamicDowngrade, classifyTier } from "@/lib/risk-tiers";
import type { ExchangeName, Timeframe } from "@/lib/exchanges/types";

export type BotStatus = "running" | "paused" | "stopped" | "kill_switch";

export interface TickResult {
  ok: boolean;
  reason?: string;
  scannedSymbols: string[];
  generatedSignals: { symbol: string; type: string; score: number }[];
  openedPaperTrades: { symbol: string; direction: string; entryPrice: number }[];
  rejectedSignals: { symbol: string; reason: string }[];
  errors: { symbol: string; error: string }[];
  durationMs: number;
  totalUniverseSymbols?: number;
  prefilteredSymbols?: number;
  deeplyAnalyzedSymbols?: number;
  nextCursor?: string;
}

const PAPER_BALANCE = 1000;

async function loadSettings(userId: string) {
  if (!supabaseConfigured()) return null;
  const sb = supabaseAdmin();

  // Use upsert with ignoreDuplicates so a conflicting row never causes a hard error.
  // We always re-select afterwards to return the canonical row regardless of insert/conflict.
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
    scan_universe: "all_futures",
    min_24h_volume_usd: 500_000,
    max_spread_percent: 0.1,
    max_funding_rate_abs: 0.003,
    max_symbols_per_tick: 50,
    max_concurrent_requests: 5,
    kline_limit: 250,
    scanner_timeframe: "5m",
    scanner_cursor: "0",
  };

  // Fetch all rows (single-tenant: at most 1 row) — avoids UUID .eq() PostgREST cast issues.
  const { data: rows, error: readErr } = await sb
    .from("bot_settings")
    .select("*")
    .limit(1);
  if (readErr) throw new Error(`bot_settings okunamadı: ${readErr.message}`);
  const existing = rows?.[0] ?? null;
  if (existing) return existing;

  // No row exists — insert with defaults (bot_status: stopped).
  // On duplicate key (race condition), re-fetch.
  const { data: created, error: insertErr } = await sb
    .from("bot_settings")
    .insert(insert)
    .select()
    .single();

  if (!insertErr) return created;

  const isDuplicate = (insertErr as any)?.code === "23505" || /duplicate key/i.test(insertErr.message ?? "");
  if (!isDuplicate) {
    throw new Error(`bot_settings yazılamadı: ${insertErr.message}`);
  }

  // Row appeared between our read and insert — fetch it now.
  const { data: retryRows, error: retryErr } = await sb
    .from("bot_settings")
    .select("*")
    .limit(1);
  if (retryErr) throw new Error(`bot_settings re-read hatası: ${retryErr.message}`);
  return retryRows?.[0] ?? null;
}

export async function getBotState(userId: string) {
  return loadSettings(userId);
}

export async function setBotStatus(userId: string, status: BotStatus, reason?: string) {
  if (!supabaseConfigured()) {
    throw new Error("Supabase yapılandırılmamış — bot status güncellenemiyor");
  }
  // Ensure a settings row exists with all required defaults before mutating status.
  await loadSettings(userId);

  const sb = supabaseAdmin();
  const patch: Record<string, unknown> = {
    bot_status: status,
    kill_switch_active: status === "kill_switch",
  };
  const { data, error } = await sb
    .from("bot_settings")
    .update(patch)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) {
    await botLog({
      userId, level: "error", eventType: "bot_status_error",
      message: `setBotStatus(${status}) hata: ${error.message}`,
    });
    throw new Error(`bot_settings güncellenemedi: ${error.message}`);
  }

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

export async function tickBot(userId: string, opts?: { timeframe?: Timeframe; symbols?: string[] }): Promise<TickResult> {
  const start = Date.now();
  const result: TickResult = {
    ok: false,
    scannedSymbols: [],
    generatedSignals: [],
    openedPaperTrades: [],
    rejectedSignals: [],
    errors: [],
    durationMs: 0,
  };

  await botLog({ userId, eventType: "tick_started", message: "Tick başladı" });

  const settings = await loadSettings(userId);
  if (!settings) {
    result.reason = "Supabase yapılandırılmamış";
    result.durationMs = Date.now() - start;
    await botLog({ userId, level: "error", eventType: "tick_failed", message: result.reason });
    return result;
  }
  if (settings.bot_status !== "running") {
    result.reason = `Bot durumu: ${settings.bot_status}`;
    result.durationMs = Date.now() - start;
    await botLog({ userId, eventType: "tick_skipped", message: result.reason });
    return result;
  }

  const exchange = settings.active_exchange as ExchangeName;
  const adapter = getAdapter(exchange);
  const tf: Timeframe = opts?.timeframe ?? (settings.scanner_timeframe as Timeframe) ?? "5m";

  if (!supabaseConfigured()) {
    result.reason = "Supabase yapılandırılmamış";
    result.durationMs = Date.now() - start;
    return result;
  }

  const sb = supabaseAdmin();

  // Sweep SL/TP on open paper trades first
  await evaluateOpenTrades(userId);

  // Get symbol universe (cursor-based batch rotation across all futures)
  let symbols: string[];
  let universeTotal = 0;
  let universePrefiltered = 0;
  let tickerMap: Record<string, any> = {};
  let nextCursor = "0";

  if (opts?.symbols && opts.symbols.length > 0) {
    symbols = opts.symbols;
  } else {
    try {
      const scanMode = (settings.scan_universe as ScanUniverse) ?? "all_futures";
      const cursor = settings.scanner_cursor ?? "0";
      const universe = await getUniverseSlice({
        exchange,
        scanMode,
        min24hVolumeUsd: Number(settings.min_24h_volume_usd ?? 500_000),
        maxSpreadPct: Number(settings.max_spread_percent ?? 0.1),
        maxFundingRateAbs: Number(settings.max_funding_rate_abs ?? 0.003),
        maxSymbolsPerTick: Number(settings.max_symbols_per_tick ?? 50),
        cursor,
      });
      symbols = universe.batchSymbols;
      universeTotal = universe.totalSymbols;
      universePrefiltered = universe.preFilteredCount;
      tickerMap = universe.tickerMap;
      nextCursor = universe.nextCursor;

      // Persist cursor for next tick
      await sb.from("bot_settings").update({ scanner_cursor: nextCursor }).limit(1);
    } catch {
      symbols = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT"];
    }
  }

  result.scannedSymbols = symbols;
  result.totalUniverseSymbols = universeTotal;
  result.prefilteredSymbols = universePrefiltered;
  result.nextCursor = nextCursor;

  const daily = await getDailyStatus(userId, PAPER_BALANCE);
  if (daily.targetHit) {
    result.ok = true;
    result.reason = "daily_target_hit";
    result.durationMs = Date.now() - start;
    await botLog({ userId, eventType: "tick_completed", message: "Tick tamamlandı — günlük hedef doldu, işlem yok", metadata: { ...summary(result) } });
    return result;
  }
  if (daily.lossLimitHit) {
    await setBotStatus(userId, "paused", "daily_loss_limit_hit");
    result.reason = "daily_loss_limit_hit";
    result.durationMs = Date.now() - start;
    await botLog({ userId, level: "warn", eventType: "tick_completed", message: "Tick — günlük zarar limiti, bot duraklatıldı" });
    return result;
  }

  const { data: openPos } = await sb.from("paper_trades").select("id").eq("user_id", userId).eq("status", "open");
  let openCount = openPos?.length ?? 0;

  if (openCount >= settings.max_open_positions) {
    result.ok = true;
    result.reason = "max_open_positions";
    result.durationMs = Date.now() - start;
    await botLog({ userId, eventType: "tick_completed", message: `Tick — maks açık pozisyon (${openCount}) doldu` });
    return result;
  }

  let btcKlines: any[] = [];
  try { btcKlines = await adapter.getKlines("BTC/USDT", tf, 250); } catch { /* non-fatal */ }

  await botLog({ userId, exchange, eventType: "scanner_started", message: `${symbols.length} sembol taranıyor (${tf}) universe=${universeTotal} prefiltered=${universePrefiltered}` });

  for (const symbol of symbols) {
    try {
      const preTicker = tickerMap[symbol];
      const [klines, ticker, info, funding] = await Promise.all([
        adapter.getKlines(symbol, tf, 250),
        preTicker ? Promise.resolve(preTicker) : adapter.getTicker(symbol),
        adapter.getExchangeInfo(symbol),
        adapter.getFundingRate(symbol),
      ]);

      const sig = generateSignal({ symbol, timeframe: tf, klines, ticker, funding, btcKlines });

      // Persist signal for audit
      await sb.from("signals").insert({
        user_id: userId, exchange_name: exchange, market_type: "futures",
        margin_mode: settings.margin_mode, symbol, timeframe: tf,
        signal_type: sig.signalType, signal_score: sig.score,
        entry_price: sig.entryPrice, stop_loss: sig.stopLoss, take_profit: sig.takeProfit,
        risk_reward_ratio: sig.riskRewardRatio, reasons: sig.reasons,
        rejected_reason: sig.rejectedReason ?? null,
      });

      if (sig.signalType !== "LONG" && sig.signalType !== "SHORT") {
        const rejReason = sig.rejectedReason ?? sig.reasons[0] ?? sig.signalType;
        result.rejectedSignals.push({ symbol, reason: rejReason });
        await botLog({
          userId, exchange, eventType: "signal_rejected",
          message: `${symbol} ${sig.signalType} — ${rejReason}`,
          metadata: { score: sig.score, features: sig.features },
        });
        continue;
      }

      result.generatedSignals.push({ symbol, type: sig.signalType, score: sig.score });
      await botLog({
        userId, exchange, eventType: "signal_generated",
        message: `${symbol} ${sig.signalType} skor=${sig.score} — ${sig.reasons[0] ?? ""}`,
        metadata: { score: sig.score, entryPrice: sig.entryPrice },
      });

      if (!sig.entryPrice || !sig.stopLoss || !sig.takeProfit) continue;

      // ── WHITELIST + TIER GATE ── (auto-trade only allowed for whitelisted symbols)
      const allowedSymbols: string[] = Array.isArray(settings.allowed_symbols) && settings.allowed_symbols.length > 0
        ? settings.allowed_symbols
        : [];
      const symbolNorm = symbol.replace("/", ""); // BTC/USDT → BTCUSDT
      const inDbWhitelist = allowedSymbols.length === 0 || allowedSymbols.includes(symbolNorm) || allowedSymbols.includes(symbol);
      const inTierWhitelist = isAutoTradeAllowed(symbol);
      if (!inTierWhitelist || !inDbWhitelist) {
        result.rejectedSignals.push({ symbol, reason: "Whitelist dışı (tier/db)" });
        await botLog({
          userId, exchange, eventType: "whitelist_blocked",
          message: `${symbol} otomatik işlem whitelist dışı`,
          metadata: { tier: classifyTier(symbol), dbWhitelist: allowedSymbols.length },
        });
        continue;
      }

      // ── DYNAMIC TIER DOWNGRADE ── (live market conditions can demote/reject)
      const tierResult = applyDynamicDowngrade(symbol, {
        spreadPercent: ticker.spread * 100,
        atrPercent: typeof sig.features.atrPctOfClose === "number" ? sig.features.atrPctOfClose : 0,
        fundingRatePercent: Math.abs((funding?.rate ?? 0) * 100),
        orderbookDepthUsdt: 0, // not yet computed at this layer; risk-engine handles
        volume24hUsdt: ticker.quoteVolume24h,
        btcDirectionAligned: undefined, // signal-engine already incorporates BTC trend
      });
      if (tierResult.rejected) {
        result.rejectedSignals.push({ symbol, reason: `Tier reject: ${tierResult.reasons.join(", ")}` });
        await botLog({
          userId, exchange, eventType: "tier_blocked",
          message: `${symbol} tier reddetti: ${tierResult.reasons.join(", ")}`,
          metadata: { tier: tierResult.originalTier, effective: tierResult.effectiveTier },
        });
        continue;
      }
      // Use tier-policy max leverage as upper cap for risk engine
      const tierLeverageCap = Math.min(tierResult.policy.maxLeverage, settings.max_leverage ?? 3);

      const liq = await adapter.getEstimatedLiquidationPrice({
        symbol, direction: sig.signalType, entryPrice: sig.entryPrice,
        leverage: tierLeverageCap, marginMode: "isolated",
      });

      const risk = evaluateRisk({
        accountBalanceUsd: PAPER_BALANCE,
        symbol, direction: sig.signalType,
        entryPrice: sig.entryPrice, stopLoss: sig.stopLoss, takeProfit: sig.takeProfit,
        signalScore: sig.score, marketSpread: ticker.spread,
        recentLossStreak: 0, openPositionCount: openCount,
        dailyRealizedPnlUsd: daily.realizedPnlUsd, weeklyRealizedPnlUsd: daily.realizedPnlUsd,
        dailyTargetHit: daily.targetHit, conservativeMode: false,
        killSwitchActive: settings.kill_switch_active,
        webSocketHealthy: true, apiHealthy: true, dataFresh: true,
        fundingRate: funding?.rate,
        estimatedLiquidationPrice: liq,
        tierMaxLeverage: tierResult.policy.maxLeverage,
        tierMinRiskRewardRatio: tierResult.policy.minRiskRewardRatio,
        tierMaxRiskPerTradePercent: tierResult.policy.maxRiskPerTradePercent,
        exchangeMaxLeverage: info?.maxLeverage,
        exchangeMinOrderSize: info?.minOrderSize,
        exchangeStepSize: info?.stepSize,
        exchangeTickSize: info?.tickSize,
        marginMode: "isolated",
      });

      if (!risk.allowed) {
        result.rejectedSignals.push({ symbol, reason: `Risk: ${risk.reason}` });
        await botLog({
          userId, exchange, eventType: "risk_blocked",
          message: `${symbol} ${sig.signalType} risk engine reddetti: ${risk.reason}`,
          metadata: { violations: risk.ruleViolations },
        });
        continue;
      }

      const trade = await openPaperTrade({
        userId, exchange, symbol, direction: sig.signalType,
        entryPrice: sig.entryPrice, stopLoss: sig.stopLoss, takeProfit: sig.takeProfit,
        leverage: risk.leverage, positionSize: risk.positionSize, marginUsed: risk.marginUsed,
        riskAmount: risk.riskAmount, riskRewardRatio: risk.riskRewardRatio,
        marginMode: "isolated", estimatedLiquidationPrice: risk.estimatedLiquidationPrice ?? null,
        signalScore: sig.score, entryReason: sig.reasons.join(" • "),
      });

      result.openedPaperTrades.push({
        symbol, direction: sig.signalType, entryPrice: sig.entryPrice,
      });
      await botLog({
        userId, exchange, eventType: "paper_trade_opened",
        message: `${sig.signalType} ${symbol} @ ${sig.entryPrice} lev=${risk.leverage}x skor=${sig.score}`,
        metadata: { tradeId: trade?.id },
      });
      openCount++;
      if (openCount >= settings.max_open_positions) break;
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      result.errors.push({ symbol, error: msg });
      await botLog({ userId, exchange, level: "error", eventType: "tick_error", message: `${symbol}: ${msg}` });
    }
  }

  result.ok = true;
  result.deeplyAnalyzedSymbols = symbols.length;
  result.durationMs = Date.now() - start;

  await botLog({
    userId, exchange, eventType: "tick_completed",
    message: `Tick tamamlandı — universe=${universeTotal} prefilter=${universePrefiltered} tarandı=${symbols.length} sinyal=${result.generatedSignals.length} açıldı=${result.openedPaperTrades.length} red=${result.rejectedSignals.length} hata=${result.errors.length} cursor=${nextCursor} (${result.durationMs}ms)`,
    metadata: summary(result),
  });

  return result;
}

function summary(r: TickResult) {
  return {
    universe: r.totalUniverseSymbols,
    prefiltered: r.prefilteredSymbols,
    scanned: r.scannedSymbols.length,
    generated: r.generatedSignals.length,
    opened: r.openedPaperTrades.length,
    rejected: r.rejectedSignals.length,
    errors: r.errors.length,
    nextCursor: r.nextCursor,
    durationMs: r.durationMs,
  };
}
