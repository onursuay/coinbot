import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export interface CleanupResult {
  ok: boolean;
  deleted_total: number;
  details: Record<string, number>;
  ran_at: string;
  error?: string;
}

export async function runLogCleanup(): Promise<CleanupResult> {
  if (!supabaseConfigured()) {
    return { ok: false, deleted_total: 0, details: {}, ran_at: new Date().toISOString(), error: "Supabase not configured" };
  }
  const { data, error } = await supabaseAdmin().rpc("cleanup_old_logs");
  if (error) {
    return { ok: false, deleted_total: 0, details: {}, ran_at: new Date().toISOString(), error: error.message };
  }
  const d = data as Record<string, any>;
  return {
    ok: true,
    deleted_total: d.deleted_total ?? 0,
    details: {
      bot_logs_debug_info: d.bot_logs_debug_info ?? 0,
      bot_logs_warn: d.bot_logs_warn ?? 0,
      bot_logs_error: d.bot_logs_error ?? 0,
      risk_events_info: d.risk_events_info ?? 0,
      risk_events_warning: d.risk_events_warning ?? 0,
      risk_events_critical: d.risk_events_critical ?? 0,
      monitoring_reports: d.monitoring_reports ?? 0,
    },
    ran_at: d.ran_at ?? new Date().toISOString(),
  };
}

export function startLogCleanupScheduler(): void {
  if (!env.logRetentionEnabled) {
    console.log("[log-cleanup] LOG_RETENTION_ENABLED=false — scheduler disabled");
    return;
  }

  const intervalMs = env.logCleanupIntervalHours * 60 * 60 * 1000;
  const initialDelayMs = 5 * 60 * 1000; // 5 minutes after worker start

  console.log(`[log-cleanup] Scheduler starting — first run in 5m, then every ${env.logCleanupIntervalHours}h`);

  setTimeout(async () => {
    await runCycle();
    setInterval(runCycle, intervalMs);
  }, initialDelayMs);
}

async function runCycle(): Promise<void> {
  try {
    const result = await runLogCleanup();
    if (result.ok) {
      console.log(`[log-cleanup] OK — deleted ${result.deleted_total} rows`, result.details);
    } else {
      console.warn(`[log-cleanup] Failed: ${result.error}`);
    }
  } catch (e: any) {
    // Never crash the worker
    console.error(`[log-cleanup] Unexpected error: ${e?.message ?? e}`);
  }
}
