// Dry-run diagnostics — read-only snapshot of all bot state for dashboard visibility.
// No mutations. Safe to call at any time.

import { ok, fail } from "@/lib/api-helpers";
import { getCurrentUserId } from "@/lib/auth";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getWorkerHealth } from "@/lib/engines/heartbeat";
import { checkLiveReadiness } from "@/lib/engines/live-readiness";
import { isHardLiveAllowed } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = getCurrentUserId();

    if (!supabaseConfigured()) {
      return ok({
        bot_status: "stopped",
        worker_health: null,
        trading_mode: "paper",
        active_exchange: "binance",
        hard_live_gate: isHardLiveAllowed(),
        open_paper_positions: 0,
        last_tick_at: null,
        last_scanned_symbols: [],
        last_rejected_signals: [],
        last_opened_paper_trade: null,
        readiness_summary: null,
        scan_details: [],
        supabase_configured: false,
      });
    }

    const sb = supabaseAdmin();

    const [settingsRes, openPosRes, workerHealth, readiness] = await Promise.all([
      sb.from("bot_settings").select(
        "bot_status, trading_mode, active_exchange, kill_switch_active, kill_switch_reason, last_tick_at, last_tick_summary"
      ).limit(1),
      sb.from("paper_trades").select("id", { count: "exact", head: true })
        .eq("user_id", userId).eq("status", "open"),
      getWorkerHealth(),
      checkLiveReadiness(userId),
    ]);

    const settings = settingsRes.data?.[0] ?? null;
    const tickSummary = (settings?.last_tick_summary as any) ?? null;

    return ok({
      bot_status: settings?.bot_status ?? "stopped",
      trading_mode: settings?.trading_mode ?? "paper",
      active_exchange: settings?.active_exchange ?? "binance",
      kill_switch_active: settings?.kill_switch_active ?? false,
      kill_switch_reason: settings?.kill_switch_reason ?? null,
      hard_live_gate: isHardLiveAllowed(),
      open_paper_positions: openPosRes.count ?? 0,
      last_tick_at: settings?.last_tick_at ?? null,
      worker_health: {
        online: workerHealth.online,
        workerId: workerHealth.workerId,
        status: workerHealth.status,
        ageMs: workerHealth.ageMs,
        websocketStatus: workerHealth.websocketStatus,
        binanceApiStatus: workerHealth.binanceApiStatus,
        lastError: workerHealth.lastError,
      },
      last_scanned_symbols: tickSummary?.scanDetails?.map((d: any) => d.symbol) ?? [],
      last_rejected_signals: tickSummary?.topRejectReasons ?? [],
      last_opened_paper_trade: tickSummary?.lastOpenedTrade ?? null,
      tick_stats: tickSummary ? {
        universe: tickSummary.universe,
        prefiltered: tickSummary.prefiltered,
        scanned: tickSummary.scanned,
        signals: tickSummary.signals,
        opened: tickSummary.opened,
        rejected: tickSummary.rejected,
        errors: tickSummary.errors,
        durationMs: tickSummary.durationMs,
      } : null,
      scan_details: tickSummary?.scanDetails ?? [],
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
