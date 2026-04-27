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
  lowVolumeRejectedCount: number;
  recentSignalCount: number;
  recentSignalSymbols: string[];
  universe: number;
  deepAnalyzed: number;

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

  // 8. Trade details (last 30 min)
  openedTradeDetails: { symbol: string; direction: string; entryPrice: number; stopLoss: number; takeProfit: number; signalScore: number }[];
  closedTradeDetails: { symbol: string; direction: string; entryPrice: number; exitPrice: number; pnl: number; exitReason: string }[];
  nearMissCandidates: { symbol: string; score: number; rejectReason: string }[];
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
    topRejectedReasons: [], lowVolumeRejectedCount: 0, recentSignalCount: 0, recentSignalSymbols: [],
    universe: 0, deepAnalyzed: 0,
    openedPaperTrades30m: 0, closedPaperTrades30m: 0, openPaperPositions: 0,
    totalPaperPnl: 0, pnl30m: 0, winRate: 0, profitFactor: 0, maxDrawdown: 0,
    slClosedCount: 0, tpClosedCount: 0, totalClosedTrades: 0,
    paperTradesCompleted: 0, paperTradesRequired: 100,
    liveReady: false, readinessBlockers: [], strategyScore: 100, strategyBlocked: false,
    hardLiveTradingAllowedFalse: !isHardLiveAllowed(), enableLiveTradingFalse: true,
    tradingModePaper: true, realOrderSent: false, killSwitchActive: false, lastError: null,
    warnings: [],
    openedTradeDetails: [], closedTradeDetails: [], nearMissCandidates: [],
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
      lowVolumeRejectedCount: 0,
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
    openedDetailRes,
    closedDetailRes,
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
    sb.from("paper_trades")
      .select("symbol, direction, entry_price, stop_loss, take_profit, signal_score")
      .eq("user_id", userId).gte("opened_at", thirtyMinAgo).limit(10),
    sb.from("paper_trades")
      .select("symbol, direction, entry_price, exit_price, pnl, exit_reason")
      .eq("user_id", userId).not("closed_at", "is", null).gte("closed_at", thirtyMinAgo).limit(10),
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

  // Volume-based rejections are counted separately — never pollute the top reject reason list.
  const isVolumeReject = (r: string) => /hacim|volume|likid/i.test(r);
  const rejMap = new Map<string, number>();
  let signalVolumeRejectCount = 0;
  for (const s of recentSignals) {
    if (s.rejected_reason) {
      if (isVolumeReject(s.rejected_reason)) {
        signalVolumeRejectCount++;
      } else {
        rejMap.set(s.rejected_reason, (rejMap.get(s.rejected_reason) ?? 0) + 1);
      }
    }
  }
  // Fall back to last_tick_summary top reject reasons when no recent signal data;
  // filter volume reasons from the fallback too.
  const topRejectedReasons: { reason: string; count: number }[] =
    rejMap.size > 0
      ? [...rejMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([reason, count]) => ({ reason, count }))
      : (tickSummary?.topRejectReasons ?? [])
          .filter((r: string) => !isVolumeReject(r))
          .slice(0, 5)
          .map((r: string) => ({ reason: r, count: 1 }));

  // Total low-volume excluded = prefilter gate + signal-engine volume rejects that slipped through
  const lowVolumeRejectedCount = (tickSummary?.lowVolumePrefilterRejected ?? 0) + signalVolumeRejectCount;

  // Near-miss candidates from last tick scan details (top scored but not opened)
  const scanDetails = (tickSummary?.scanDetails ?? []) as any[];
  const nearMissCandidates = scanDetails
    .filter((d: any) => !d.opened && (d.signalScore ?? 0) > 0)
    .sort((a: any, b: any) => (b.signalScore ?? 0) - (a.signalScore ?? 0))
    .slice(0, 5)
    .map((d: any) => ({
      symbol: d.symbol,
      score: d.signalScore ?? 0,
      rejectReason: d.rejectReason ?? d.riskRejectReason ?? "—",
    }));

  // Opened trade details (last 30 min)
  const openedTradeDetails = (openedDetailRes.data ?? []).map((t: any) => ({
    symbol: t.symbol,
    direction: t.direction,
    entryPrice: Number(t.entry_price ?? 0),
    stopLoss: Number(t.stop_loss ?? 0),
    takeProfit: Number(t.take_profit ?? 0),
    signalScore: Number(t.signal_score ?? 0),
  }));

  // Closed trade details (last 30 min)
  const closedTradeDetails = (closedDetailRes.data ?? []).map((t: any) => ({
    symbol: t.symbol,
    direction: t.direction,
    entryPrice: Number(t.entry_price ?? 0),
    exitPrice: Number(t.exit_price ?? 0),
    pnl: Number(t.pnl ?? 0),
    exitReason: t.exit_reason ?? "—",
  }));

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
    lowVolumeRejectedCount,
    recentSignalCount: successSignals.length,
    recentSignalSymbols,
    universe: tickSummary?.universe ?? 0,
    deepAnalyzed: tickSummary?.scanned ?? 0,
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
    openedTradeDetails,
    closedTradeDetails,
    nearMissCandidates,
  };
}
