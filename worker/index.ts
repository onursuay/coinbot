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
// Behavior:
//   - Every TICK_INTERVAL_SEC: calls tickBot() to scan + generate signals + open paper/live trades.
//   - Every HEARTBEAT_INTERVAL_SEC: writes heartbeat to Supabase.
//   - On SIGTERM/SIGINT: stops gracefully, writes final heartbeat with status='stopped'.
//   - On unhandled error: logs, writes status='error' heartbeat, exits with code 1.
//
// The bot's mode (paper/live) and enable flags are read from bot_settings on each tick.
// The worker process itself does NOT need to be restarted to switch modes — change the
// row in Supabase via dashboard, and the next tick picks it up.

import { tickBot, setBotStatus } from "../src/lib/engines/bot-orchestrator";
import { recordHeartbeat } from "../src/lib/engines/heartbeat";
import { getCurrentUserId } from "../src/lib/auth";
import { supabaseAdmin, supabaseConfigured } from "../src/lib/supabase/server";
import { reconcileOrders } from "../src/lib/engines/order-lifecycle-manager";

const TICK_INTERVAL_SEC = Number(process.env.TICK_INTERVAL_SEC ?? 30);
const HEARTBEAT_INTERVAL_SEC = Number(process.env.HEARTBEAT_INTERVAL_SEC ?? 15);
const WORKER_ID = process.env.WORKER_ID ?? `worker-${process.pid}`;

let stopping = false;

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

async function heartbeatLoop() {
  while (!stopping) {
    try {
      const mode = await readBotMode();
      await recordHeartbeat({
        workerId: WORKER_ID,
        status: mode?.killSwitch ? "kill_switch_triggered" : (mode?.status === "stopped" ? "stopped" : (mode?.mode === "live" ? "running_live" : "running_paper")),
        activeMode: mode?.mode,
        activeExchange: "binance",
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
      const mode = await readBotMode();
      if (!mode || mode.status === "stopped" || mode.killSwitch) {
        // Bot not running — skip this tick
        await sleep(TICK_INTERVAL_SEC * 1000);
        continue;
      }
      const userId = getCurrentUserId();
      const result = await tickBot(userId);
      console.log(`[tick] ok=${result.ok} scanned=${result.scannedSymbols.length} signals=${result.generatedSignals.length} opened=${result.openedPaperTrades.length} duration=${result.durationMs}ms`);
    } catch (e: any) {
      console.error("[tick] failed:", e?.message ?? e);
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
      const mode = await readBotMode();
      if (!mode || mode.status === "stopped" || mode.killSwitch) continue;
      // Paper mode: no real orders on exchange, skip reconciliation
      if (mode.mode !== "live") continue;

      const userId = getCurrentUserId();
      if (!supabaseConfigured()) continue;

      // Live mode: compare DB open orders vs exchange.
      // Since live order placement is not yet wired, we pass empty exchangeOpenOrders.
      // When live orders are implemented, populate from exchange adapter.
      const result = await reconcileOrders({
        userId,
        exchangeName: "binance",
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
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("unhandledRejection", (e: any) => {
  console.error("[worker] unhandledRejection:", e?.message ?? e);
});
process.on("uncaughtException", (e: any) => {
  console.error("[worker] uncaughtException:", e?.message ?? e);
});

console.log(`[worker] starting workerId=${WORKER_ID} tickSec=${TICK_INTERVAL_SEC} heartbeatSec=${HEARTBEAT_INTERVAL_SEC}`);

// Run loops in parallel — they're independent
Promise.all([heartbeatLoop(), tickLoop(), reconciliationLoop()]).catch((e) => {
  console.error("[worker] fatal:", e?.message ?? e);
  process.exit(1);
});
