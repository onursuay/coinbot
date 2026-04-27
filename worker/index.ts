// Standalone trading bot worker — runs as a long-lived Node.js process on VPS/cloud.
// NOT designed for Vercel serverless. Vercel hosts only the dashboard + REST API.
//
// Usage:
//   node --loader tsx worker/index.ts
//   (or compile to JS first; see worker/README.md)
//
// Env required:
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   - WORKER_ID (e.g. "vps-eu-west-1")
//   - TICK_INTERVAL_SEC (default 30)
//   - HEARTBEAT_INTERVAL_SEC (default 15)
//   - HARD_LIVE_TRADING_ALLOWED, BINANCE_API_KEY, BINANCE_API_SECRET (only if live)
//
// Optional monitoring report env:
//   - REPORT_EMAIL_ENABLED=true
//   - REPORT_EMAIL_INTERVAL_MINUTES=30
//   - REPORT_EMAIL_TO=onursuay@hotmail.com
//   - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
//
// Behavior:
//   - Every TICK_INTERVAL_SEC: calls tickBot() to scan + generate signals + open paper/live trades.
//   - Every HEARTBEAT_INTERVAL_SEC: writes heartbeat to Supabase + renews worker lock.
//   - Every REPORT_EMAIL_INTERVAL_MINUTES: builds monitoring report, emails it, saves to DB.
//   - On SIGTERM/SIGINT: stops gracefully, writes final heartbeat with status='stopped', releases lock.
//   - On unhandled error: logs, writes status='error' heartbeat, exits with code 1.
//
// The bot's mode (paper/live) and enable flags are read from bot_settings on each tick.
// The worker process itself does NOT need to be restarted to switch modes — change the
// row in Supabase via dashboard, and the next tick picks it up.
//
// DISTRIBUTED LOCK: Only the lock owner runs tickBot(). The lock is acquired on startup
// and renewed on every heartbeat. Lock TTL = 90 s. A second worker running in parallel
// will heartbeat but skip all tick logic until the first worker's lock expires.

import { tickBot, setBotStatus } from "../src/lib/engines/bot-orchestrator";
import { recordHeartbeat } from "../src/lib/engines/heartbeat";
import { getCurrentUserId } from "../src/lib/auth";
import { supabaseAdmin, supabaseConfigured } from "../src/lib/supabase/server";
import { reconcileOrders } from "../src/lib/engines/order-lifecycle-manager";
import { resolveActiveExchange } from "../src/lib/exchanges/resolve-active-exchange";
import { startReportScheduler } from "../src/lib/reports/report-scheduler";
import { emptyTickStats, type TickPeriodStats } from "../src/lib/reports/monitoring-report";
import { startLogCleanupScheduler } from "../src/lib/logs/log-cleanup";
import { acquireLock, renewLock, releaseLock } from "./lock";

const TICK_INTERVAL_SEC      = Number(process.env.TICK_INTERVAL_SEC      ?? 30);
const HEARTBEAT_INTERVAL_SEC = Number(process.env.HEARTBEAT_INTERVAL_SEC ?? 15);
const WORKER_ID              = process.env.WORKER_ID ?? `worker-${process.pid}`;
const WORKER_START_MS        = Date.now();

// Docker sets HOSTNAME to the short container ID automatically.
const CONTAINER_ID = process.env.HOSTNAME ?? "";
const GIT_COMMIT   = process.env.GIT_COMMIT ?? "";

const LOCK_META = {
  workerId:    WORKER_ID,
  containerId: CONTAINER_ID || undefined,
  gitCommit:   GIT_COMMIT   || undefined,
  processPid:  process.pid,
};

let stopping     = false;
let isLockOwner  = false; // updated by heartbeatLoop on every cycle

// ── In-memory tick stats for monitoring reports ───────────────────────────────
let currentTickStats: TickPeriodStats = emptyTickStats();

function updateTickStats(durationMs: number, scanned: number, hasError: boolean): void {
  currentTickStats.count += 1;
  currentTickStats.totalDurationMs += durationMs;
  if (durationMs > currentTickStats.maxDurationMs) currentTickStats.maxDurationMs = durationMs;
  currentTickStats.totalScanned += scanned;
  if (hasError) currentTickStats.errorCount += 1;
}

// ── Bot mode reader ───────────────────────────────────────────────────────────

async function readBotMode(): Promise<{ mode: "paper" | "live"; status: string; killSwitch: boolean } | null> {
  if (!supabaseConfigured()) return null;
  const { data } = await supabaseAdmin().from("bot_settings").select("trading_mode, bot_status, kill_switch_active, enable_live_trading").limit(1);
  const row = data?.[0];
  if (!row) return null;
  return {
    mode: (row.trading_mode === "live" && row.enable_live_trading) ? "live" : "paper",
    status: row.bot_status ?? "stopped",
    killSwitch: !!row.kill_switch_active,
  };
}

// ── Loops ─────────────────────────────────────────────────────────────────────

async function heartbeatLoop() {
  const userId = getCurrentUserId();
  while (!stopping) {
    try {
      // Renew (or acquire for the first time) the distributed lock.
      // Non-fatal: if renew fails, we log but keep the previous isLockOwner state.
      try {
        const owned = await renewLock(LOCK_META);
        if (owned !== isLockOwner) {
          console.log(`[lock] ${owned ? "ACQUIRED" : "LOST"} — workerId=${WORKER_ID}`);
        }
        isLockOwner = owned;
      } catch (lockErr: any) {
        console.error("[lock] renew error:", lockErr?.message ?? lockErr);
      }

      const [mode, activeExchange] = await Promise.all([
        readBotMode(),
        resolveActiveExchange(userId),
      ]);
      await recordHeartbeat({
        workerId: WORKER_ID,
        status: mode?.killSwitch ? "kill_switch_triggered" : (mode?.status === "stopped" ? "stopped" : (mode?.mode === "live" ? "running_live" : "running_paper")),
        activeMode: mode?.mode,
        activeExchange,
        websocketStatus: "disconnected", // wired up later when WS is connected
        binanceApiStatus: "ok",
      });
    } catch (e: any) {
      console.error("[heartbeat] failed:", e?.message ?? e);
    }
    await sleep(HEARTBEAT_INTERVAL_SEC * 1000);
  }
}

async function tickLoop() {
  while (!stopping) {
    try {
      if (!isLockOwner) {
        // Another worker holds the active lock — skip tick, stay quiet.
        await sleep(TICK_INTERVAL_SEC * 1000);
        continue;
      }

      const mode = await readBotMode();
      if (!mode || mode.status === "stopped" || mode.killSwitch) {
        await sleep(TICK_INTERVAL_SEC * 1000);
        continue;
      }
      const userId = getCurrentUserId();
      const result = await tickBot(userId, {
        workerContext: {
          workerId:    WORKER_ID,
          containerId: CONTAINER_ID || undefined,
          gitCommit:   GIT_COMMIT   || undefined,
          processPid:  process.pid,
          isLockOwner: true,
        },
      });

      updateTickStats(result.durationMs, result.scannedSymbols.length, result.errors.length > 0);

      const ts = new Date().toISOString();
      const statusIcon = result.ok ? "✅" : "⏭ ";
      const modeTag = mode.mode === "live" ? "[LIVE]" : "[paper]";
      console.log(
        `${ts} ${statusIcon} ${modeTag} tick | ` +
        `universe=${result.totalUniverseSymbols ?? "?"} ` +
        `prefilter=${result.prefilteredSymbols ?? "?"} ` +
        `scanned=${result.scannedSymbols.length} ` +
        `signals=${result.generatedSignals.length} ` +
        `rejected=${result.rejectedSignals.length} ` +
        `opened=${result.openedPaperTrades.length} ` +
        `errors=${result.errors.length} ` +
        `| ${result.durationMs}ms` +
        (result.reason ? ` | skip: ${result.reason}` : "")
      );
      if (result.openedPaperTrades.length > 0) {
        for (const t of result.openedPaperTrades) {
          console.log(`  → OPENED: ${t.direction} ${t.symbol} @ ${t.entryPrice}`);
        }
      }
      if (result.rejectedSignals.length > 0) {
        const top = result.rejectedSignals.slice(0, 5).map((r) => `${r.symbol}(${r.reason})`).join(", ");
        console.log(`  ↳ rejected: ${top}${result.rejectedSignals.length > 5 ? ` +${result.rejectedSignals.length - 5} more` : ""}`);
      }
      if (result.errors.length > 0) {
        console.error(`  ⚠ errors: ${result.errors.map((e) => `${e.symbol}:${e.error}`).join(", ")}`);
      }
    } catch (e: any) {
      console.error("[tick] failed:", e?.message ?? e);
      updateTickStats(0, 0, true);
      await recordHeartbeat({
        workerId: WORKER_ID,
        status: "error",
        lastError: e?.message ?? String(e),
      }).catch(() => undefined);
    }
    await sleep(TICK_INTERVAL_SEC * 1000);
  }
}

async function reconciliationLoop() {
  const RECON_INTERVAL_MS = 5 * 60 * 1000; // every 5 min
  while (!stopping) {
    await sleep(RECON_INTERVAL_MS);
    if (stopping) break;
    try {
      if (!isLockOwner) continue; // only lock owner reconciles

      const mode = await readBotMode();
      if (!mode || mode.status === "stopped" || mode.killSwitch) continue;
      // Paper mode: no real orders on exchange, skip reconciliation
      if (mode.mode !== "live") continue;

      const userId = getCurrentUserId();
      if (!supabaseConfigured()) continue;

      const exchangeName = await resolveActiveExchange(userId);

      // Live mode: compare DB open orders vs exchange.
      // Since live order placement is not yet wired, we pass empty exchangeOpenOrders.
      // When live orders are implemented, populate from exchange adapter.
      const result = await reconcileOrders({
        userId,
        exchangeName,
        exchangeOpenOrders: [],
      });

      if (!result.ok || result.shouldEnterSafeMode) {
        console.warn(`[reconcile] mismatches=${result.mismatches.length} shouldEnterSafeMode=${result.shouldEnterSafeMode}`);
        if (result.shouldEnterSafeMode) {
          const reason = result.mismatches[0]?.reason ?? "Reconciliation mismatch";
          await setBotStatus(userId, "kill_switch", `Reconciliation: ${reason}`);
          await recordHeartbeat({
            workerId: WORKER_ID,
            status: "safe_mode",
            lastError: `Reconciliation triggered safe mode: ${reason}`,
          }).catch(() => undefined);
        }
      } else {
        console.log(`[reconcile] ok — ${result.mismatches.length} mismatches`);
      }
    } catch (e: any) {
      console.error("[reconcile] failed:", e?.message ?? e);
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function gracefulShutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[worker] ${signal} received — shutting down`);
  await recordHeartbeat({
    workerId: WORKER_ID,
    status: "stopped",
    lastError: `shutdown by ${signal}`,
  }).catch(() => undefined);
  if (isLockOwner) {
    await releaseLock(WORKER_ID).catch(() => undefined);
    console.log("[lock] released");
  }
  process.exit(0);
}

// ── Signal handlers ───────────────────────────────────────────────────────────

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => gracefulShutdown("SIGINT"));
process.on("unhandledRejection", (e: any) => {
  console.error("[worker] unhandledRejection:", e?.message ?? e);
});
process.on("uncaughtException", (e: any) => {
  console.error("[worker] uncaughtException:", e?.message ?? e);
});

// ── Start ─────────────────────────────────────────────────────────────────────

const userId = getCurrentUserId();

console.log(`[worker] starting workerId=${WORKER_ID} tickSec=${TICK_INTERVAL_SEC} heartbeatSec=${HEARTBEAT_INTERVAL_SEC}`);
console.log(`[worker] identity containerId=${CONTAINER_ID || "?"} gitCommit=${GIT_COMMIT || "?"} pid=${process.pid}`);

// Attempt initial lock acquisition before starting loops.
// Non-fatal: loops will retry via heartbeat. We log the result but don't abort startup.
(async () => {
  try {
    isLockOwner = await acquireLock(LOCK_META);
    console.log(`[lock] initial acquire: ${isLockOwner ? "OWNED" : "NOT_OWNER (another worker active)"}`);
  } catch (e: any) {
    console.error("[lock] initial acquire failed:", e?.message ?? e);
  }
})();

startLogCleanupScheduler();

startReportScheduler({
  userId,
  workerStartMs: WORKER_START_MS,
  workerRestartCount: 0,
  getTickStats: () => ({ ...currentTickStats }),
  resetTickStats: () => {
    currentTickStats = emptyTickStats();
  },
});

// Run loops in parallel — they're independent
Promise.all([heartbeatLoop(), tickLoop(), reconciliationLoop()]).catch((e) => {
  console.error("[worker] fatal:", e?.message ?? e);
  process.exit(1);
});
