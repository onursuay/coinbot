// Distributed worker lock — ensures only one worker runs tick logic at a time.
// Backed by the worker_lock Supabase table via try_acquire_worker_lock() RPC.
//
// Lock TTL: LOCK_TTL_SECONDS (90 s).  Must be renewed before expiry — heartbeat (15 s) does this.
// Acquire = renew: the same UPSERT-with-WHERE logic handles both.
// A new worker can steal the lock only when it has expired.

import { supabaseAdmin, supabaseConfigured } from "../src/lib/supabase/server";
import { getCurrentUserId } from "../src/lib/auth";

export const LOCK_TTL_SECONDS = 90;

export interface WorkerLockMeta {
  workerId: string;
  containerId?: string;
  gitCommit?: string;
  processPid?: number;
}

// Returns true if this worker now owns the lock.
export async function acquireLock(meta: WorkerLockMeta): Promise<boolean> {
  if (!supabaseConfigured()) return true; // dev/test: no lock contention
  const userId = getCurrentUserId();
  const { data, error } = await supabaseAdmin().rpc("try_acquire_worker_lock", {
    p_user_id: userId,
    p_worker_id: meta.workerId,
    p_expires_in_seconds: LOCK_TTL_SECONDS,
    p_container_id: meta.containerId ?? null,
    p_git_commit: meta.gitCommit ?? null,
    p_process_pid: meta.processPid ?? null,
  });
  if (error) {
    // Migration 0008 not yet applied — function doesn't exist in schema.
    // Fall back to sole-owner mode so the worker keeps running.
    const isMissing = error.message?.includes("Could not find the function") ||
      (error as any)?.code === "PGRST202";
    if (isMissing) {
      console.warn("[lock] try_acquire_worker_lock RPC bulunamadı — migration 0008_worker_lock.sql henüz uygulanmamış. Tek-worker modu ile devam ediliyor.");
      return true;
    }
    throw new Error(`Worker lock acquire hatası: ${error.message}`);
  }
  return data === true;
}

// Renew = re-acquire with the same worker_id.
export async function renewLock(meta: WorkerLockMeta): Promise<boolean> {
  return acquireLock(meta);
}

// Release the lock row only if this worker owns it.
export async function releaseLock(workerId: string): Promise<void> {
  if (!supabaseConfigured()) return;
  const userId = getCurrentUserId();
  await supabaseAdmin()
    .from("worker_lock")
    .delete()
    .eq("user_id", userId)
    .eq("worker_id", workerId);
}
