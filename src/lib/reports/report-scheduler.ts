import { buildMonitoringMetrics, emptyTickStats, type TickPeriodStats } from "./monitoring-report";
import { sendMonitoringReport } from "./email-reporter";
import { env } from "@/lib/env";

export interface ReportSchedulerOptions {
  userId: string;
  workerStartMs: number;
  workerRestartCount?: number;
  getTickStats: () => TickPeriodStats;
  resetTickStats: () => void;
}

export async function runReportCycle(opts: ReportSchedulerOptions): Promise<void> {
  const tickStats = opts.getTickStats();
  const uptimeSec = Math.round((Date.now() - opts.workerStartMs) / 1000);

  try {
    const metrics = await buildMonitoringMetrics(
      opts.userId,
      tickStats,
      uptimeSec,
      opts.workerRestartCount ?? 0,
    );
    const result = await sendMonitoringReport(metrics);
    const tag =
      result.status === "sent"    ? "✅ gönderildi" :
      result.status === "skipped" ? "⏭  atlandı (REPORT_EMAIL_ENABLED=false veya SMTP eksik)" :
      `❌ hata: ${result.error}`;
    console.log(`[report] 30dk raporu ${tag}`);
  } catch (e: any) {
    // Never crash the worker — just log
    console.error("[report] Rapor döngüsü başarısız:", e?.message ?? e);
  }

  opts.resetTickStats();
}

export function startReportScheduler(opts: ReportSchedulerOptions): () => void {
  const intervalMs = (env.reportEmailIntervalMinutes ?? 30) * 60 * 1000;
  let stopping = false;

  (async () => {
    while (!stopping) {
      await sleep(intervalMs);
      if (stopping) break;
      await runReportCycle(opts);
    }
  })().catch((e) => {
    console.error("[report-scheduler] Fatal loop error:", e?.message ?? e);
  });

  return () => { stopping = true; };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
