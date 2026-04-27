import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getWorkerHealth } from "@/lib/engines/heartbeat";
import { resolveActiveExchange } from "@/lib/exchanges/resolve-active-exchange";
import { checkLiveReadiness } from "@/lib/engines/live-readiness";
import { calculateStrategyHealth } from "@/lib/engines/strategy-health";
import { isHardLiveAllowed, env } from "@/lib/env";

// In-memory tick stats collected during a 30-minute period.
export interface TickPeriodStats {
  count: number;
  totalDurationMs: number;
  maxDurationMs: number;
  errorCount: number;
  totalScanned: number;
  periodStart: number; // ms timestamp
}

export function emptyTickStats(): TickPeriodStats {
  return { count: 0, totalDurationMs: 0, maxDurationMs: 0, errorCount: 0, totalScanned: 0, periodStart: Date.now() };
}

export interface MonitoringMetrics {
  generatedAt: string;
  periodStart: string;
  periodEnd: string;

  // 1. General
  botStatus: string;
  workerOnline: boolean;
  workerAgeMs: number | null;
  workerUptimeSec: number;
  workerRestartCount: number;
  activeExchange: string;
  tradingMode: string;
  hardLiveAllowed: boolean;
  enableLiveTrading: boolean;

  // 2. Tick summary
  tickCount: number;
  avgTickDurationMs: number;
  maxTickDurationMs: number;
  tickErrorCount: number;
  totalScannedSymbols: number;
  avgScannedSymbols: number;
  lastTickAt: string | null;

  // 3. Scanner
  topRejectedReasons: { reason: string; count: number }[];
  recentSignalCount: number;
  recentSignalSymbols: string[];

  // 4. Paper trading
  openedPaperTrades30m: number;
  closedPaperTrades30m: number;
  openPaperPositions: number;
  totalPaperPnl: number;
  pnl30m: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  slClosedCount: number;
  tpClosedCount: number;
  totalClosedTrades: number;

  // 5. Live readiness
  paperTradesCompleted: number;
  paperTradesRequired: number;
  liveReady: boolean;
  readinessBlockers: string[];
  strategyScore: number;
  strategyBlocked: boolean;

  // 6. Security
  hardLiveTradingAllowedFalse: boolean;
  enableLiveTradingFalse: boolean;
  tradingModePaper: boolean;
  realOrderSent: boolean;
  killSwitchActive: boolean;
  lastError: string | null;

  // 7. Warnings
  warnings: string[];
}

function emptyMetrics(overrides: Partial<MonitoringMetrics> = {}): MonitoringMetrics {
  const now = new Date().toISOString();
  return {
    generatedAt: now, periodStart: now, periodEnd: now,
    botStatus: "unknown", workerOnline: false, workerAgeMs: null,
    workerUptimeSec: 0, workerRestartCount: 0,
    activeExchange: env.defaultActiveExchange || "binance",
    tradingMode: "paper", hardLiveAllowed: isHardLiveAllowed(), enableLiveTrading: false,
    tickCount: 0, avgTickDurationMs: 0, maxTickDurationMs: 0,
    tickErrorCount: 0, totalScannedSymbols: 0, avgScannedSymbols: 0, lastTickAt: null,
    topRejectedReasons: [], recentSignalCount: 0, recentSignalSymbols: [],
    openedPaperTrades30m: 0, closedPaperTrades30m: 0, openPaperPositions: 0,
    totalPaperPnl: 0, pnl30m: 0, winRate: 0, profitFactor: 0, maxDrawdown: 0,
    slClosedCount: 0, tpClosedCount: 0, totalClosedTrades: 0,
    paperTradesCompleted: 0, paperTradesRequired: 100,
    liveReady: false, readinessBlockers: [], strategyScore: 100, strategyBlocked: false,
    hardLiveTradingAllowedFalse: !isHardLiveAllowed(), enableLiveTradingFalse: true,
    tradingModePaper: true, realOrderSent: false, killSwitchActive: false, lastError: null,
    warnings: [],
    ...overrides,
  };
}

export async function buildMonitoringMetrics(
  userId: string,
  tickStats: TickPeriodStats,
  workerUptimeSec: number,
  workerRestartCount: number,
): Promise<MonitoringMetrics> {
  const now = new Date();
  const periodEnd = now.toISOString();
  const periodStart = new Date(tickStats.periodStart).toISOString();
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const tickCount = tickStats.count;
  const avgTickDurationMs = tickCount > 0 ? Math.round(tickStats.totalDurationMs / tickCount) : 0;

  if (!supabaseConfigured()) {
    return emptyMetrics({
      generatedAt: periodEnd, periodStart, periodEnd,
      workerUptimeSec, workerRestartCount,
      activeExchange: env.defaultActiveExchange || "binance",
      hardLiveAllowed: isHardLiveAllowed(),
      hardLiveTradingAllowedFalse: !isHardLiveAllowed(),
      tickCount, avgTickDurationMs,
      maxTickDurationMs: tickStats.maxDurationMs,
      tickErrorCount: tickStats.errorCount,
      totalScannedSymbols: tickStats.totalScanned,
      avgScannedSymbols: tickCount > 0 ? Math.round(tickStats.totalScanned / tickCount) : 0,
      readinessBlockers: ["Supabase not configured"],
      warnings: ["Supabase yapılandırılmamış — DB metrikleri alınamadı"],
    });
  }

  const sb = supabaseAdmin();

  const [
    settingsRes,
    workerHealth,
    activeExchange,
    readiness,
    strategyHealth,
    openedCountRes,
    closed30mRes,
    allClosedRes,
    openPosRes,
    signalsRes,
  ] = await Promise.all([
    sb.from("bot_settings")
      .select("bot_status, trading_mode, enable_live_trading, kill_switch_active, last_tick_at, last_tick_summary, last_error")
      .limit(1),
    getWorkerHealth(),
    resolveActiveExchange(userId),
    checkLiveReadiness(userId),
    calculateStrategyHealth(userId),
    sb.from("paper_trades").select("id", { count: "exact", head: true })
      .eq("user_id", userId).gte("opened_at", thirtyMinAgo),
    sb.from("paper_trades").select("pnl, exit_reason")
      .eq("user_id", userId).not("closed_at", "is", null).gte("closed_at", thirtyMinAgo),
    sb.from("paper_trades").select("pnl, exit_reason")
      .eq("user_id", userId).not("closed_at", "is", null),
    sb.from("paper_trades").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("status", "open"),
    sb.from("signals").select("symbol, rejected_reason, signal_type")
      .eq("user_id", userId).gte("created_at", thirtyMinAgo).limit(300),
  ]);

  const settings = settingsRes.data?.[0] ?? null;
  const tickSummary = (settings?.last_tick_summary as any) ?? null;
  const tradingMode = settings?.trading_mode ?? "paper";
  const enableLiveTrading = Boolean(settings?.enable_live_trading ?? false);
  const killSwitchActive = Boolean(settings?.kill_switch_active ?? false);
  const lastError = settings?.last_error ?? workerHealth.lastError ?? null;
  const lastTickAt = settings?.last_tick_at ?? null;

  // Paper trade stats — last 30 min
  const openedPaperTrades30m = openedCountRes.count ?? 0;
  const closed30m = closed30mRes.data ?? [];
  const closedPaperTrades30m = closed30m.length;
  const pnl30m = closed30m.reduce((s, t) => s + Number(t.pnl ?? 0), 0);

  // All-time paper stats
  const allClosed = allClosedRes.data ?? [];
  const totalClosedTrades = allClosed.length;
  let wins = 0, grossProfit = 0, grossLoss = 0, slCount = 0, tpCount = 0;
  let peak = 0, equity = 0, maxDrawdown = 0;
  for (const t of allClosed) {
    const pnl = Number(t.pnl ?? 0);
    if (pnl >= 0) { wins++; grossProfit += pnl; } else { grossLoss += Math.abs(pnl); }
    equity += pnl;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDrawdown) maxDrawdown = dd;
    const reason = (t.exit_reason ?? "").toLowerCase();
    if (reason === "stop_loss") slCount++;
    if (reason === "take_profit") tpCount++;
  }
  const winRate = totalClosedTrades > 0 ? (wins / totalClosedTrades) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;
  const totalPaperPnl = allClosed.reduce((s, t) => s + Number(t.pnl ?? 0), 0);

  // Scanner / signals
  const recentSignals = signalsRes.data ?? [];
  const successSignals = recentSignals.filter((s) => !s.rejected_reason);
  const recentSignalSymbols = [...new Set(successSignals.map((s) => s.symbol))].slice(0, 10);
  const rejMap = new Map<string, number>();
  for (const s of recentSignals) {
    if (s.rejected_reason) rejMap.set(s.rejected_reason, (rejMap.get(s.rejected_reason) ?? 0) + 1);
  }
  // Fall back to last_tick_summary top reject reasons when no recent signal data
  const topRejectedReasons: { reason: string; count: number }[] =
    rejMap.size > 0
      ? [...rejMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([reason, count]) => ({ reason, count }))
      : (tickSummary?.topRejectReasons ?? []).slice(0, 5).map((r: string) => ({ reason: r, count: 1 }));

  // Warnings
  const warnings: string[] = [];
  if (!workerHealth.online) warnings.push("Worker OFFLINE — heartbeat kesildi");
  if (workerHealth.binanceApiStatus === "down" || workerHealth.binanceApiStatus === "degraded") {
    warnings.push(`Borsa API durumu: ${workerHealth.binanceApiStatus}`);
  }
  if (tickStats.errorCount > 0) warnings.push(`Son periyotta ${tickStats.errorCount} tick hatası`);
  if (strategyHealth.score < 60 && strategyHealth.totalTrades >= 10) {
    warnings.push(`Strateji sağlık skoru düşük: ${strategyHealth.score}/100`);
  }
  if (openedPaperTrades30m === 0 && tickCount > 0) {
    const topReason = topRejectedReasons[0]?.reason;
    warnings.push(`30 dakikada paper trade açılmadı — ${topReason ? `en yaygın ret: ${topReason}` : "sinyal üretilmedi"}`);
  }
  if (killSwitchActive) warnings.push("Kill switch aktif!");
  if (isHardLiveAllowed()) warnings.push("DİKKAT: HARD_LIVE_TRADING_ALLOWED=true — canlı trading etkinleşebilir");

  return {
    generatedAt: now.toISOString(),
    periodStart,
    periodEnd,
    botStatus: settings?.bot_status ?? "unknown",
    workerOnline: workerHealth.online,
    workerAgeMs: workerHealth.ageMs,
    workerUptimeSec,
    workerRestartCount,
    activeExchange,
    tradingMode,
    hardLiveAllowed: isHardLiveAllowed(),
    enableLiveTrading,
    tickCount,
    avgTickDurationMs,
    maxTickDurationMs: tickStats.maxDurationMs,
    tickErrorCount: tickStats.errorCount,
    totalScannedSymbols: tickStats.totalScanned,
    avgScannedSymbols: tickCount > 0 ? Math.round(tickStats.totalScanned / tickCount) : 0,
    lastTickAt,
    topRejectedReasons,
    recentSignalCount: successSignals.length,
    recentSignalSymbols,
    openedPaperTrades30m,
    closedPaperTrades30m,
    openPaperPositions: openPosRes.count ?? 0,
    totalPaperPnl,
    pnl30m,
    winRate,
    profitFactor,
    maxDrawdown,
    slClosedCount: slCount,
    tpClosedCount: tpCount,
    totalClosedTrades,
    paperTradesCompleted: readiness.paperTradesCompleted,
    paperTradesRequired: readiness.paperTradesRequired,
    liveReady: readiness.ready,
    readinessBlockers: readiness.blockers,
    strategyScore: strategyHealth.score,
    strategyBlocked: strategyHealth.blocked,
    hardLiveTradingAllowedFalse: !isHardLiveAllowed(),
    enableLiveTradingFalse: !enableLiveTrading,
    tradingModePaper: tradingMode === "paper",
    realOrderSent: false,
    killSwitchActive,
    lastError,
    warnings,
  };
}
