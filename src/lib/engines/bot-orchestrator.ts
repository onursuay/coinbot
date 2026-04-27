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
import { isAutoTradeAllowed, applyDynamicDowngrade, classifyTier, getPrioritySymbols } from "@/lib/risk-tiers";
import { calculateStrategyHealth } from "./strategy-health";
import type { ExchangeName, Timeframe } from "@/lib/exchanges/types";

export type BotStatus = "running" | "paused" | "stopped" | "kill_switch";

export interface ScanDetail {
  symbol: string;
  tier: string;
  spreadPercent: number;
  atrPercent: number;
  fundingRate: number;
  orderBookDepth: number;    // USDT — top-10 bid+ask average
  signalType: string;
  signalScore: number;
  rejectReason: string | null;
  riskAllowed: boolean | null;
  riskRejectReason: string | null;
  opened: boolean;
}

export interface TickResult {
  ok: boolean;
  reason?: string;
  scannedSymbols: string[];
  generatedSignals: { symbol: string; type: string; score: number }[];
  openedPaperTrades: { symbol: string; direction: string; entryPrice: number }[];
  rejectedSignals: { symbol: string; reason: string }[];
  // Signals that passed all filters except score (50-69). Never opens a trade.
  nearMissSignals: { symbol: string; direction: string; score: number; reason: string }[];
  errors: { symbol: string; error: string }[];
  scanDetails: ScanDetail[];
  durationMs: number;
  totalUniverseSymbols?: number;
  prefilteredSymbols?: number;
  deeplyAnalyzedSymbols?: number;
  // Coins removed before deep analysis because 24h volume < 5M USDT (signal-engine hard floor).
  // Counted but never added to scanDetails — keeps the table clean.
  lowVolumePrefilterRejected?: number;
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
  if (existing) {
    // Override active_exchange with exchange_credentials.is_active=true (primary source of truth)
    const { data: credRows } = await sb
      .from("exchange_credentials")
      .select("exchange_name")
      .eq("is_active", true)
      .limit(1);
    const activeCred = credRows?.[0]?.exchange_name;
    if (activeCred) {
      existing.active_exchange = (activeCred as string).toLowerCase();
    } else {
      // No active credential — self-heal bot_settings.active_exchange to env default.
      // This clears stale values (e.g. "mexc" left over after credential changes).
      const envExchange = env.defaultActiveExchange || "binance";
      if (existing.active_exchange !== envExchange) {
        existing.active_exchange = envExchange;
        await sb.from("bot_settings").update({ active_exchange: envExchange }).neq("id", "00000000-0000-0000-0000-000000000000");
      }
    }
    return existing;
  }

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
  const isKillSwitch = status === "kill_switch";
  const dbStatus = isKillSwitch ? "kill_switch_triggered" : status;

  const patch: Record<string, unknown> = {
    bot_status: dbStatus,
    kill_switch_active: isKillSwitch,
  };
  if (isKillSwitch) {
    // Write reason + force live trading off on kill switch
    patch.kill_switch_reason = reason ?? "Kill switch tetiklendi";
    patch.enable_live_trading = false;
  }

  const { error } = await sb.from("bot_settings").update(patch).eq("user_id", userId);

  if (error) {
    await botLog({
      userId, level: "error", eventType: "bot_status_error",
      message: `setBotStatus(${dbStatus}) hata: ${error.message}`,
    });
    throw new Error(`bot_settings güncellenemedi: ${error.message}`);
  }

  await botLog({
    userId, level: isKillSwitch ? "warn" : "info",
    eventType: `bot_${dbStatus}`,
    message: `Bot status -> ${dbStatus}${reason ? `: ${reason}` : ""}`,
  });
  if (isKillSwitch) {
    await riskEvent({ userId, eventType: "kill_switch", severity: "critical", message: reason ?? "Kill switch tetiklendi" });
  }
  return { bot_status: dbStatus, kill_switch_active: isKillSwitch };
}

export async function tickBot(userId: string, opts?: { timeframe?: Timeframe; symbols?: string[] }): Promise<TickResult> {
  const start = Date.now();
  const result: TickResult = {
    ok: false,
    scannedSymbols: [],
    generatedSignals: [],
    openedPaperTrades: [],
    rejectedSignals: [],
    nearMissSignals: [],
    errors: [],
    scanDetails: [],
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
  const isRunning = ["running", "running_paper", "running_live"].includes(settings.bot_status ?? "");
  if (!isRunning) {
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
        // TIER_1 + TIER_2 pinned to every tick — never missed by cursor rotation
        prioritySymbols: getPrioritySymbols(),
      });
      symbols = universe.batchSymbols;
      universeTotal = universe.totalSymbols;
      universePrefiltered = universe.preFilteredCount;
      tickerMap = universe.tickerMap;
      nextCursor = universe.nextCursor;

      // Persist cursor for next tick
      await sb.from("bot_settings").update({ scanner_cursor: nextCursor }).eq("user_id", userId);
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

  // ── STRATEGY HEALTH GATE ── block new trades if score below threshold
  const strategyHealth = await calculateStrategyHealth(userId);
  if (strategyHealth.blocked) {
    result.ok = true;
    result.reason = `strategy_health_blocked: ${strategyHealth.blockReason}`;
    result.durationMs = Date.now() - start;
    await botLog({
      userId, level: "warn", eventType: "tick_completed",
      message: `Tick — strateji sağlık gate reddetti: ${strategyHealth.blockReason}`,
      metadata: { score: strategyHealth.score, totalTrades: strategyHealth.totalTrades },
    });
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

  // ── Volume pre-gate ──
  // Coins with 24h volume < 5M USDT will be rejected in signal-engine anyway (hard floor).
  // Pre-filtering here avoids the expensive klines/orderbook fetches and keeps scanDetails clean.
  // Priority symbols (TIER_1/2) bypass this check — they're pinned and always sufficiently liquid.
  const ANALYSIS_MIN_VOLUME_USDT = 5_000_000;
  const priorityPinSet = new Set(getPrioritySymbols());
  let lowVolumeSkipped = 0;
  const symbolsToAnalyze = symbols.filter((sym) => {
    if (priorityPinSet.has(sym)) return true;
    const vol = tickerMap[sym]?.quoteVolume24h;
    // Strict: vol must be present AND >= 5M USDT.
    // Missing (undefined) / zero / below threshold → all rejected.
    if (typeof vol !== "number" || vol < ANALYSIS_MIN_VOLUME_USDT) {
      lowVolumeSkipped++;
      return false;
    }
    return true;
  });
  result.lowVolumePrefilterRejected = lowVolumeSkipped;

  await botLog({ userId, exchange, eventType: "scanner_started", message: `${symbolsToAnalyze.length} sembol taranıyor (${tf}) universe=${universeTotal} prefiltered=${universePrefiltered} lowVolSkipped=${lowVolumeSkipped}` });

  for (const symbol of symbolsToAnalyze) {
    const detail: ScanDetail = {
      symbol,
      tier: classifyTier(symbol),
      spreadPercent: 0,
      atrPercent: 0,
      fundingRate: 0,
      orderBookDepth: 0,
      signalType: "UNKNOWN",
      signalScore: 0,
      rejectReason: null,
      riskAllowed: null,
      riskRejectReason: null,
      opened: false,
    };

    try {
      const preTicker = tickerMap[symbol];
      const [klines, ticker, info, funding, orderBook] = await Promise.all([
        adapter.getKlines(symbol, tf, 250),
        preTicker ? Promise.resolve(preTicker) : adapter.getTicker(symbol),
        adapter.getExchangeInfo(symbol),
        adapter.getFundingRate(symbol),
        adapter.getOrderBook(symbol, 10).catch(() => null),
      ]);

      // Compute bid+ask USDT depth (top-10 levels average)
      let orderbookDepthUsdt = 0;
      if (orderBook) {
        const bidDepth = orderBook.bids.slice(0, 10).reduce((s, b) => s + b.price * b.size, 0);
        const askDepth = orderBook.asks.slice(0, 10).reduce((s, a) => s + a.price * a.size, 0);
        orderbookDepthUsdt = (bidDepth + askDepth) / 2;
      }
      detail.orderBookDepth = orderbookDepthUsdt;

      detail.spreadPercent = ticker.spread * 100;
      detail.fundingRate = funding?.rate ?? 0;

      const sig = generateSignal({ symbol, timeframe: tf, klines, ticker, funding, btcKlines });
      detail.signalType = sig.signalType;
      detail.signalScore = sig.score;
      detail.atrPercent = typeof sig.features.atrPctOfClose === "number" ? sig.features.atrPctOfClose : 0;

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
        detail.rejectReason = rejReason;
        result.rejectedSignals.push({ symbol, reason: rejReason });
        await botLog({
          userId, exchange, eventType: "signal_rejected",
          message: `${symbol} ${sig.signalType} — ${rejReason}`,
          metadata: { score: sig.score, features: sig.features },
        });

        // Near-miss: passed all filters except score (50-69). Informational only, never opens a trade.
        if (sig.nearMissDirection && sig.score >= 50) {
          const nmReason = `Skor=${sig.score}/100 — 70 eşiği geçemedi (RR=${sig.riskRewardRatio?.toFixed(2) ?? "?"}, stop=${sig.features.stopDistPct ?? "?"}%)`;
          result.nearMissSignals.push({ symbol, direction: sig.nearMissDirection, score: sig.score, reason: nmReason });
          await botLog({
            userId, exchange, eventType: "near_miss_signal",
            message: `NEAR_MISS ${sig.nearMissDirection} ${symbol} skor=${sig.score}/100 — eşik 70, mevcut ${sig.score}`,
            metadata: { score: sig.score, direction: sig.nearMissDirection, rr: sig.riskRewardRatio, stopDistPct: sig.features.stopDistPct, trendScore: sig.features.trendScore, volConf: sig.features.volConf },
          });
        }

        result.scanDetails.push(detail);
        continue;
      }

      result.generatedSignals.push({ symbol, type: sig.signalType, score: sig.score });
      await botLog({
        userId, exchange, eventType: "signal_generated",
        message: `${symbol} ${sig.signalType} skor=${sig.score} — ${sig.reasons[0] ?? ""}`,
        metadata: { score: sig.score, entryPrice: sig.entryPrice },
      });

      if (!sig.entryPrice || !sig.stopLoss || !sig.takeProfit) {
        detail.rejectReason = "entry/SL/TP eksik";
        result.scanDetails.push(detail);
        continue;
      }

      // ── WHITELIST + TIER GATE ── (auto-trade only allowed for whitelisted symbols)
      const allowedSymbols: string[] = Array.isArray(settings.allowed_symbols) && settings.allowed_symbols.length > 0
        ? settings.allowed_symbols
        : [];
      const symbolNorm = symbol.replace("/", ""); // BTC/USDT → BTCUSDT
      const inDbWhitelist = allowedSymbols.length === 0 || allowedSymbols.includes(symbolNorm) || allowedSymbols.includes(symbol);
      const inTierWhitelist = isAutoTradeAllowed(symbol);
      if (!inTierWhitelist || !inDbWhitelist) {
        const wlReason = "Whitelist dışı (tier/db)";
        detail.rejectReason = wlReason;
        result.rejectedSignals.push({ symbol, reason: wlReason });
        await botLog({
          userId, exchange, eventType: "whitelist_blocked",
          message: `${symbol} otomatik işlem whitelist dışı`,
          metadata: { tier: classifyTier(symbol), dbWhitelist: allowedSymbols.length },
        });
        result.scanDetails.push(detail);
        continue;
      }

      // ── DYNAMIC TIER DOWNGRADE ── (live market conditions can demote/reject)
      const tierResult = applyDynamicDowngrade(symbol, {
        spreadPercent: ticker.spread * 100,
        atrPercent: detail.atrPercent,
        fundingRatePercent: Math.abs((funding?.rate ?? 0) * 100),
        orderbookDepthUsdt,
        volume24hUsdt: ticker.quoteVolume24h,
        btcDirectionAligned: undefined,
      });
      detail.tier = tierResult.effectiveTier;

      if (tierResult.rejected) {
        const tierReason = `Tier reject: ${tierResult.reasons.join(", ")}`;
        detail.rejectReason = tierReason;
        result.rejectedSignals.push({ symbol, reason: tierReason });
        await botLog({
          userId, exchange, eventType: "tier_blocked",
          message: `${symbol} tier reddetti: ${tierResult.reasons.join(", ")}`,
          metadata: { tier: tierResult.originalTier, effective: tierResult.effectiveTier },
        });
        result.scanDetails.push(detail);
        continue;
      }

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

      detail.riskAllowed = risk.allowed;
      detail.riskRejectReason = risk.allowed ? null : (risk.reason ?? null);

      if (!risk.allowed) {
        const riskReason = `Risk: ${risk.reason}`;
        detail.rejectReason = riskReason;
        result.rejectedSignals.push({ symbol, reason: riskReason });
        await botLog({
          userId, exchange, eventType: "risk_blocked",
          message: `${symbol} ${sig.signalType} risk engine reddetti: ${risk.reason}`,
          metadata: { violations: risk.ruleViolations },
        });
        result.scanDetails.push(detail);
        continue;
      }

      const trade = await openPaperTrade({
        userId, exchange, symbol, direction: sig.signalType,
        entryPrice: sig.entryPrice, stopLoss: sig.stopLoss, takeProfit: sig.takeProfit,
        leverage: risk.leverage, positionSize: risk.positionSize, marginUsed: risk.marginUsed,
        riskAmount: risk.riskAmount, riskRewardRatio: risk.riskRewardRatio,
        marginMode: "isolated", estimatedLiquidationPrice: risk.estimatedLiquidationPrice ?? null,
        signalScore: sig.score, entryReason: sig.reasons.join(" • "),
        tier: tierResult.effectiveTier,
        spreadPercent: ticker.spread * 100,
        atrPercent: detail.atrPercent,
        fundingRate: funding?.rate ?? undefined,
        signalConfidence: sig.score,
        riskPercent: env.maxRiskPerTradePercent,
      });

      detail.opened = true;
      result.openedPaperTrades.push({
        symbol, direction: sig.signalType, entryPrice: sig.entryPrice,
      });
      await botLog({
        userId, exchange, eventType: "paper_trade_opened",
        message: `${sig.signalType} ${symbol} @ ${sig.entryPrice} lev=${risk.leverage}x skor=${sig.score}`,
        metadata: { tradeId: trade?.id },
      });
      result.scanDetails.push(detail);
      openCount++;
      if (openCount >= settings.max_open_positions) break;
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      detail.rejectReason = `Hata: ${msg}`;
      result.errors.push({ symbol, error: msg });
      result.scanDetails.push(detail);
      await botLog({ userId, exchange, level: "error", eventType: "tick_error", message: `${symbol}: ${msg}` });
    }
  }

  result.ok = true;
  result.deeplyAnalyzedSymbols = symbolsToAnalyze.length;
  result.durationMs = Date.now() - start;

  // Persist last tick summary for diagnostics endpoint
  const lastTickSummary = {
    at: new Date().toISOString(),
    universe: universeTotal,
    prefiltered: universePrefiltered,
    scanned: symbolsToAnalyze.length,
    lowVolumePrefilterRejected: lowVolumeSkipped,
    signals: result.generatedSignals.length,
    opened: result.openedPaperTrades.length,
    rejected: result.rejectedSignals.length,
    nearMiss: result.nearMissSignals.length,
    errors: result.errors.length,
    durationMs: result.durationMs,
    scanDetails: result.scanDetails.slice(0, 50), // cap at 50 to limit JSONB size
    lastOpenedTrade: result.openedPaperTrades[0] ?? null,
    topRejectReasons: result.rejectedSignals.slice(0, 10).map((r) => `${r.symbol}: ${r.reason}`),
    topNearMiss: result.nearMissSignals.slice(0, 5).map((n) => `${n.direction} ${n.symbol} skor=${n.score}`),
  };
  await sb.from("bot_settings").update({
    last_tick_at: lastTickSummary.at,
    last_tick_summary: lastTickSummary,
  }).eq("user_id", userId);

  await botLog({
    userId, exchange, eventType: "tick_completed",
    message: `Tick tamamlandı — universe=${universeTotal} prefilter=${universePrefiltered} lowVolSkip=${lowVolumeSkipped} tarandı=${symbolsToAnalyze.length} sinyal=${result.generatedSignals.length} açıldı=${result.openedPaperTrades.length} red=${result.rejectedSignals.length} hata=${result.errors.length} cursor=${nextCursor} (${result.durationMs}ms)`,
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
