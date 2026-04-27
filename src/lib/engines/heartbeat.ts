// Worker heartbeat — VPS/cloud worker sends periodic heartbeat so dashboard
// can show online/offline status. Bot must NOT trade if heartbeat is stale.

import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export interface HeartbeatPayload {
  workerId?: string;
  status: "running_paper" | "running_live" | "safe_mode" | "kill_switch_triggered" | "error" | "stopped";
  activeMode?: "paper" | "live";
  activeExchange?: string;
  websocketStatus?: "connected" | "disconnected" | "reconnecting";
  binanceApiStatus?: "ok" | "degraded" | "down" | "unknown";
  openPositionsCount?: number;
  lastError?: string | null;
}

const STALE_THRESHOLD_MS = 60_000; // 60 sec — if no heartbeat in 60s, worker is offline

export async function recordHeartbeat(p: HeartbeatPayload): Promise<{ ok: boolean; error?: string }> {
  if (!supabaseConfigured()) return { ok: false, error: "Supabase not configured" };
  const sb = supabaseAdmin();
  const workerId = p.workerId ?? env.workerId;

  const row = {
    worker_id: workerId,
    status: p.status,
    active_mode: p.activeMode ?? null,
    active_exchange: p.activeExchange ?? null,
    websocket_status: p.websocketStatus ?? null,
    binance_api_status: p.binanceApiStatus ?? null,
    open_positions_count: p.openPositionsCount ?? 0,
    last_error: p.lastError ?? null,
    last_heartbeat: new Date().toISOString(),
  };

  const { error } = await sb.from("worker_heartbeat").upsert(row, { onConflict: "worker_id" });
  if (error) return { ok: false, error: error.message };

  // Mirror summary to bot_settings for quick dashboard reads
  await sb.from("bot_settings").update({
    last_heartbeat: row.last_heartbeat,
    worker_id: workerId,
    worker_status: p.status,
    websocket_status: p.websocketStatus ?? null,
    binance_api_status: p.binanceApiStatus ?? null,
    last_error: p.lastError ?? null,
  }).limit(1);

  return { ok: true };
}

export interface WorkerHealthSnapshot {
  online: boolean;
  workerId: string | null;
  status: string | null;
  lastHeartbeat: string | null;
  ageMs: number | null;
  websocketStatus: string | null;
  binanceApiStatus: string | null;
  openPositionsCount: number;
  lastError: string | null;
}

export async function getWorkerHealth(): Promise<WorkerHealthSnapshot> {
  const offline: WorkerHealthSnapshot = {
    online: false, workerId: null, status: null, lastHeartbeat: null, ageMs: null,
    websocketStatus: null, binanceApiStatus: null, openPositionsCount: 0, lastError: null,
  };
  if (!supabaseConfigured()) return offline;

  const { data, error } = await supabaseAdmin()
    .from("worker_heartbeat")
    .select("*")
    .order("last_heartbeat", { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return offline;

  const row = data[0];
  const last = row.last_heartbeat ? new Date(row.last_heartbeat).getTime() : 0;
  const ageMs = last > 0 ? Date.now() - last : null;
  const online = ageMs !== null && ageMs < STALE_THRESHOLD_MS;

  return {
    online,
    workerId: row.worker_id ?? null,
    status: row.status ?? null,
    lastHeartbeat: row.last_heartbeat ?? null,
    ageMs,
    websocketStatus: row.websocket_status ?? null,
    binanceApiStatus: row.binance_api_status ?? null,
    openPositionsCount: row.open_positions_count ?? 0,
    lastError: row.last_error ?? null,
  };
}

export function isHeartbeatFresh(snapshot: WorkerHealthSnapshot): boolean {
  return snapshot.online === true;
}
