// Dry-run diagnostics — read-only snapshot of all bot state for dashboard visibility.
// No mutations. Safe to call at any time. Always returns same shape, even when Supabase is missing.

import { ok, fail } from "@/lib/api-helpers";
import { getCurrentUserId } from "@/lib/auth";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getWorkerHealth } from "@/lib/engines/heartbeat";
import { checkLiveReadiness } from "@/lib/engines/live-readiness";
import { isHardLiveAllowed } from "@/lib/env";
import { resolveActiveExchange } from "@/lib/exchanges/resolve-active-exchange";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMPTY_WORKER_HEALTH = {
  online: false,
  workerId: null,
  status: "offline",
  ageMs: null,
  secondsSinceHeartbeat: null,
  websocketStatus: null,
  binanceApiStatus: null,
  lastError: null,
};

const EMPTY_TICK_STATS = {
  universe: 0, prefiltered: 0, scanned: 0,
  lowVolumeRejected: 0,
  signals: 0, rejected: 0, opened: 0, errors: 0, durationMs: 0,
  dynamicCandidates: 0,
  dynamicOpportunityCandidates: 0,
  dynamicEliminatedLowSignal: 0,
  dynamicEliminatedQuality: 0,
  dynamicEliminatedSetup: 0,
  dynamicEliminatedSignal: 0,
  dynamicBtcTrendRejected: 0,
  dynamicRejectedLowVolume: 0,
  dynamicRejectedStablecoin: 0,
  dynamicRejectedHighSpread: 0,
  dynamicRejectedPumpDump: 0,
  dynamicRejectedWeakMomentum: 0,
  dynamicRejectedNoData: 0,
  dynamicRejectedInsufficientDepth: 0,
};

export async function GET() {
  try {
    const userId = getCurrentUserId();

    if (!supabaseConfigured()) {
      return ok({
        bot_status: "stopped",
        trading_mode: "paper",
        active_exchange: "binance",
        kill_switch_active: false,
        kill_switch_reason: null,
        hard_live_gate: isHardLiveAllowed(),
        open_paper_positions: 0,
        last_tick_at: null,
        tickSkipped: false,
        skipReason: null,
        tickError: null,
        workerLockOwner: null,
        worker_id: null,
        tickStartedAt: null,
        tickCompletedAt: null,
        worker_health: EMPTY_WORKER_HEALTH,
        last_scanned_symbols: [],
        last_rejected_signals: [],
        last_opened_paper_trade: null,
        tick_stats: EMPTY_TICK_STATS,
        scan_details: [],
        opportunity_pool: [],
        readiness_summary: {
          ready: false,
          paperTradesCompleted: 0,
          paperTradesRequired: 100,
          blockers: ["Supabase env missing"],
          checks: [],
        },
        strategy_health: {
          score: null,
          min: null,
          blocked: false,
          bypassedByLearning: false,
          blockedInNormalMode: false,
          blockReason: null,
          positionOpeningBlocked: false,
          positionOpeningBlockReason: null,
          scannerMode: "full" as const,
          tableStillGenerated: true,
        },
        supabase_configured: false,
      });
    }

    const sb = supabaseAdmin();

    const [settingsRes, openPosRes, workerHealth, readiness, resolvedExchange] = await Promise.all([
      sb.from("bot_settings").select(
        "bot_status, trading_mode, active_exchange, kill_switch_active, kill_switch_reason, last_tick_at, last_tick_summary"
      ).limit(1),
      sb.from("paper_trades").select("id", { count: "exact", head: true })
        .eq("user_id", userId).eq("status", "open"),
      getWorkerHealth(),
      checkLiveReadiness(userId),
      resolveActiveExchange(userId),
    ]);

    // Read-only threshold simulation — non-critical, failure does not break diagnostics
    let recentSignals: { symbol: string; signal_type: string; signal_score: number; rejected_reason: string | null }[] = [];
    try {
      const signalsRes = await (sb.from("signals") as any)
        .select("symbol, signal_type, signal_score, rejected_reason")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(200);
      recentSignals = signalsRes?.data ?? [];
    } catch { /* non-critical — threshold simulation degraded gracefully */ }

    const settings = settingsRes.data?.[0] ?? null;
    const tickSummary = (settings?.last_tick_summary as any) ?? null;
    const ageMs = workerHealth.ageMs;

    // ── Diagnostics freshness ──────────────────────────────────────────────
    const lastTickAt: string | null = settings?.last_tick_at ?? null;
    const diagnosticsGeneratedAt: string | null =
      tickSummary?.generatedAt ?? tickSummary?.at ?? tickSummary?.timestamp ?? null;
    const freshnessRef = lastTickAt ?? diagnosticsGeneratedAt;
    let diagnosticsAgeSec: number | null = null;
    let diagnosticsStale = true;
    if (freshnessRef) {
      const ageS = (Date.now() - new Date(freshnessRef).getTime()) / 1000;
      if (Number.isFinite(ageS)) {
        diagnosticsAgeSec = Math.round(ageS);
        diagnosticsStale = diagnosticsAgeSec > 90;
      }
    }

    // ── Diagnostic threshold simulation (read-only, no settings changed) ──
    // Based on the last 200 signals stored in DB. Answers counterfactual questions.
    const totalRecentSignals = recentSignals.length;
    // Signals rejected purely for low score (passed all other filters)
    const lowScoreRejects = recentSignals.filter(
      (s) => s.signal_type === "NO_TRADE" && typeof s.signal_score === "number" && (s.rejected_reason ?? "").includes("skoru düşük")
    );
    // How many would pass if threshold were 60 instead of 70?
    const wouldPassAt60 = lowScoreRejects.filter((s) => s.signal_score >= 60).length;
    // How many would pass if threshold were 50?
    const wouldPassAt50 = lowScoreRejects.filter((s) => s.signal_score >= 50).length;
    // Signals blocked by BTC trend filter
    const btcTrendBlocked = recentSignals.filter(
      (s) => s.signal_type === "NO_TRADE" && (s.rejected_reason ?? "").includes("BTC trend")
    ).length;
    // Near-miss signals (50-69, passed all filters except score)
    const nearMissCount = lowScoreRejects.filter((s) => s.signal_score >= 50 && s.signal_score < 70).length;
    // Score distribution of near-miss signals
    const nearMissTopSymbols = lowScoreRejects
      .filter((s) => s.signal_score >= 50 && s.signal_score < 70)
      .sort((a, b) => b.signal_score - a.signal_score)
      .slice(0, 10)
      .map((s) => `${s.symbol} skor=${s.signal_score}`);

    const thresholdSimulation = {
      // Diagnostic only — these numbers describe what WOULD have happened.
      // Real MIN_SIGNAL_CONFIDENCE is 70 and remains unchanged.
      basedOnLastNSignals: totalRecentSignals,
      currentThreshold: 70,
      wouldPassAt60: wouldPassAt60,
      wouldPassAt50: wouldPassAt50,
      btcTrendFilterBlocked: btcTrendBlocked,
      nearMissCount: nearMissCount,
      nearMissTopSymbols,
      settingsUnchanged: true,
    };

    return ok({
      bot_status: settings?.bot_status ?? "stopped",
      trading_mode: settings?.trading_mode ?? "paper",
      active_exchange: resolvedExchange,
      kill_switch_active: settings?.kill_switch_active ?? false,
      kill_switch_reason: settings?.kill_switch_reason ?? null,
      hard_live_gate: isHardLiveAllowed(),
      open_paper_positions: openPosRes.count ?? 0,
      last_tick_at: settings?.last_tick_at ?? null,
      tickSkipped: tickSummary?.tickSkipped === true,
      skipReason: tickSummary?.skipReason ?? null,
      tickError: tickSummary?.tickError ?? null,
      workerLockOwner: typeof tickSummary?.workerLockOwner === "boolean" ? tickSummary.workerLockOwner : null,
      worker_id: tickSummary?.worker_id ?? null,
      tickStartedAt: tickSummary?.tickStartedAt ?? null,
      tickCompletedAt: tickSummary?.tickCompletedAt ?? tickSummary?.at ?? null,
      worker_health: {
        online: workerHealth.online,
        workerId: workerHealth.workerId,
        status: workerHealth.status ?? "offline",
        ageMs,
        secondsSinceHeartbeat: ageMs !== null ? Math.round(ageMs / 1000) : null,
        websocketStatus: workerHealth.websocketStatus,
        binanceApiStatus: workerHealth.binanceApiStatus,
        lastError: workerHealth.lastError,
      },
      last_scanned_symbols: tickSummary?.scanDetails?.map((d: any) => d.symbol) ?? [],
      last_rejected_signals: tickSummary?.topRejectReasons ?? [],
      last_opened_paper_trade: tickSummary?.lastOpenedTrade ?? null,
      tick_stats: tickSummary ? {
        universe: tickSummary.universe ?? 0,
        prefiltered: tickSummary.prefiltered ?? 0,
        scanned: tickSummary.scanned ?? 0,
        lowVolumeRejected: tickSummary.lowVolumePrefilterRejected ?? 0,
        signals: tickSummary.signals ?? 0,
        rejected: tickSummary.rejected ?? 0,
        opened: tickSummary.opened ?? 0,
        errors: tickSummary.errors ?? 0,
        durationMs: tickSummary.durationMs ?? 0,
        dynamicCandidates: tickSummary.dynamicCandidates ?? 0,
        dynamicOpportunityCandidates: tickSummary.dynamicOpportunityCandidates ?? 0,
        dynamicEliminatedLowSignal: tickSummary.dynamicEliminatedLowSignal ?? 0,
        dynamicEliminatedQuality: tickSummary.dynamicEliminatedQuality ?? 0,
        dynamicEliminatedSetup: tickSummary.dynamicEliminatedSetup ?? 0,
        dynamicEliminatedSignal: tickSummary.dynamicEliminatedSignal ?? 0,
        dynamicBtcTrendRejected: tickSummary.dynamicBtcTrendRejected ?? 0,
        dynamicRejectedLowVolume: tickSummary.dynamicRejectedLowVolume ?? 0,
        dynamicRejectedStablecoin: tickSummary.dynamicRejectedStablecoin ?? 0,
        dynamicRejectedHighSpread: tickSummary.dynamicRejectedHighSpread ?? 0,
        dynamicRejectedPumpDump: tickSummary.dynamicRejectedPumpDump ?? 0,
        dynamicRejectedWeakMomentum: tickSummary.dynamicRejectedWeakMomentum ?? 0,
        dynamicRejectedNoData: tickSummary.dynamicRejectedNoData ?? 0,
        dynamicRejectedInsufficientDepth: tickSummary.dynamicRejectedInsufficientDepth ?? 0,
      } : EMPTY_TICK_STATS,
      scan_details: tickSummary?.scanDetails ?? [],
      // Aliases (Dynamic Market Visibility patch) — preferred shapes for the scanner.
      scan_details_all: tickSummary?.allAnalyzedScanDetails ?? tickSummary?.scanDetails ?? [],
      scan_details_filtered: tickSummary?.scanDetails ?? [],
      all_analyzed_scan_details: tickSummary?.allAnalyzedScanDetails ?? tickSummary?.scanDetails ?? [],
      display_filter_summary: tickSummary ? (() => {
        const allAnalyzed: any[] = tickSummary.allAnalyzedScanDetails ?? tickSummary.scanDetails ?? [];
        let gmtCount = 0, mtCount = 0, milCount = 0, krmCount = 0, dynamicAnalyzed = 0;
        for (const d of allAnalyzed) {
          if (d?.coinClass === "DYNAMIC") dynamicAnalyzed++;
          const sources: string[] = Array.isArray(d?.candidateSources) ? d.candidateSources : [];
          const srcDisp: string | null = d?.sourceDisplay ?? null;
          // Resolve effective source label using same rule as the UI.
          let label = srcDisp ?? "";
          if (!label) {
            if (sources.length >= 2) label = "KRM";
            else if (sources.length === 1) {
              if (sources[0] === "WIDE_MARKET") label = "GMT";
              else if (sources[0] === "MOMENTUM") label = "MT";
              else if (sources[0] === "MANUAL_LIST") label = "MİL";
            }
          }
          if (label === "GMT") gmtCount++;
          else if (label === "MT") mtCount++;
          else if (label === "MİL" || label === "MIL") milCount++;
          else if (label === "KRM") krmCount++;
        }
        return {
          rawAnalyzedCount: allAnalyzed.length,
          filteredVisibleCount: (tickSummary.scanDetails ?? []).length,
          dynamicAnalyzedCount: dynamicAnalyzed,
          dynamicFilteredCount: tickSummary.dynamicEliminatedLowSignal ?? 0,
          coreCount: tickSummary.coreSymbolsCount ?? 0,
          unifiedSymbolsCount: tickSummary.unifiedSymbolsCount ?? 0,
          gmtCount, mtCount, milCount, krmCount,
        };
      })() : null,
      opportunity_pool: tickSummary?.opportunityPool ?? tickSummary?.scanDetails ?? [],
      tick_identity: tickSummary ? {
        worker_id:    tickSummary.worker_id    ?? null,
        container_id: tickSummary.container_id ?? null,
        git_commit:   tickSummary.git_commit   ?? null,
        process_pid:  tickSummary.process_pid  ?? null,
        generated_at: tickSummary.at           ?? null,
      } : null,
      near_miss_summary: tickSummary ? {
        nearMiss: tickSummary.nearMiss ?? 0,
        topNearMiss: tickSummary.topNearMiss ?? [],
      } : { nearMiss: 0, topNearMiss: [] },
      threshold_simulation: thresholdSimulation,
      readiness_summary: {
        ready: readiness.ready,
        paperTradesCompleted: readiness.paperTradesCompleted,
        paperTradesRequired: readiness.paperTradesRequired,
        blockers: readiness.blockers,
        checks: readiness.checks,
      },
      supabase_configured: true,
      diagnosticsStale,
      diagnosticsAgeSec,
      lastTickAt,
      diagnosticsGeneratedAt,
      strategy_health: {
        score: tickSummary?.strategyHealthScore ?? null,
        min: tickSummary?.strategyHealthMin ?? null,
        blocked: tickSummary?.strategyHealthBlocked ?? false,
        bypassedByLearning: tickSummary?.strategyHealthBypassedByLearning ?? false,
        blockedInNormalMode: tickSummary?.strategyHealthBlockedInNormalMode ?? false,
        blockReason: tickSummary?.strategyHealthBlockReason ?? null,
        positionOpeningBlocked: tickSummary?.positionOpeningBlocked ?? false,
        positionOpeningBlockReason: tickSummary?.positionOpeningBlockReason ?? null,
        scannerMode: tickSummary?.scannerMode ?? "full",
        tableStillGenerated: tickSummary?.tableStillGenerated ?? true,
      },
      unified_diagnostics: {
        unifiedCandidatePoolActive: tickSummary?.unifiedCandidatePoolActive ?? false,
        unifiedPoolSize: tickSummary?.unifiedPoolSize ?? null,
        unifiedDeepCandidatesCount: tickSummary?.unifiedDeepCandidatesCount ?? null,
        unifiedPoolGeneratedAt: tickSummary?.unifiedPoolGeneratedAt ?? null,
        unifiedPoolFromCache: tickSummary?.unifiedPoolFromCache ?? null,
        unifiedProviderError: tickSummary?.unifiedProviderError ?? null,
        analyzedSymbolsCount: tickSummary?.analyzedSymbolsCount ?? null,
        coreSymbolsCount: tickSummary?.coreSymbolsCount ?? null,
        unifiedSymbolsCount: tickSummary?.unifiedSymbolsCount ?? null,
        unifiedCandidatePoolModeAllowed: tickSummary?.unifiedCandidatePoolModeAllowed ?? null,
        unifiedCandidatePoolBlockedReason: tickSummary?.unifiedCandidatePoolBlockedReason ?? null,
        tradeMode: tickSummary?.tradeMode ?? null,
        executionMode: tickSummary?.executionMode ?? null,
      },
    });
  } catch (e: any) {
    return fail(e?.message ?? "diagnostics failed", 500);
  }
}

export async function POST() {
  return fail("Diagnostics endpoint is read-only. Use GET.", 405);
}
