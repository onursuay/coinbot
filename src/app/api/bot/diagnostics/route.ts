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
  dynamicRejectedLowVolume: 0,
  dynamicRejectedStablecoin: 0,
  dynamicRejectedHighSpread: 0,
  dynamicRejectedPumpDump: 0,
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
        worker_health: EMPTY_WORKER_HEALTH,
        last_scanned_symbols: [],
        last_rejected_signals: [],
        last_opened_paper_trade: null,
        tick_stats: EMPTY_TICK_STATS,
        scan_details: [],
        readiness_summary: {
          ready: false,
          paperTradesCompleted: 0,
          paperTradesRequired: 100,
          blockers: ["Supabase env missing"],
          checks: [],
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
        dynamicRejectedLowVolume: tickSummary.dynamicRejectedLowVolume ?? 0,
        dynamicRejectedStablecoin: tickSummary.dynamicRejectedStablecoin ?? 0,
        dynamicRejectedHighSpread: tickSummary.dynamicRejectedHighSpread ?? 0,
        dynamicRejectedPumpDump: tickSummary.dynamicRejectedPumpDump ?? 0,
      } : EMPTY_TICK_STATS,
      scan_details: tickSummary?.scanDetails ?? [],
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
    });
  } catch (e: any) {
    return fail(e?.message ?? "diagnostics failed", 500);
  }
}

export async function POST() {
  return fail("Diagnostics endpoint is read-only. Use GET.", 405);
}
