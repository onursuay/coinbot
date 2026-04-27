-- Worker distributed lock — prevents duplicate workers from running tick logic simultaneously.
-- One lock row per user_id (single-tenant system, user_id = PRIMARY KEY).
-- Lock TTL = 90 seconds; renewed every heartbeat interval (15 s by default).
-- A second worker can acquire the lock only when:
--   1. No lock row exists yet, OR
--   2. The existing lock has expired (expires_at < now()), OR
--   3. The same worker_id is renewing its own lock.

CREATE TABLE IF NOT EXISTS public.worker_lock (
  user_id      UUID        PRIMARY KEY,
  worker_id    TEXT        NOT NULL,
  container_id TEXT,
  git_commit   TEXT,
  process_pid  INTEGER,
  acquired_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- try_acquire_worker_lock(p_user_id, p_worker_id, ...)
-- Returns TRUE  → this worker now owns the lock.
-- Returns FALSE → another worker holds an active lock.
--
-- Atomic: the INSERT ... ON CONFLICT DO UPDATE WHERE block is serialised by
-- Postgres. Two racing workers on an expired lock cannot both win.
CREATE OR REPLACE FUNCTION public.try_acquire_worker_lock(
  p_user_id            UUID,
  p_worker_id          TEXT,
  p_expires_in_seconds INT     DEFAULT 90,
  p_container_id       TEXT    DEFAULT NULL,
  p_git_commit         TEXT    DEFAULT NULL,
  p_process_pid        INT     DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_owner TEXT;
BEGIN
  INSERT INTO public.worker_lock
    (user_id, worker_id, container_id, git_commit, process_pid, acquired_at, expires_at)
  VALUES (
    p_user_id,
    p_worker_id,
    p_container_id,
    p_git_commit,
    p_process_pid,
    now(),
    now() + (p_expires_in_seconds || ' seconds')::interval
  )
  ON CONFLICT (user_id) DO UPDATE
    SET
      worker_id    = p_worker_id,
      container_id = p_container_id,
      git_commit   = p_git_commit,
      process_pid  = p_process_pid,
      acquired_at  = now(),
      expires_at   = now() + (p_expires_in_seconds || ' seconds')::interval
    WHERE
      worker_lock.expires_at < now()            -- steal expired lock
      OR worker_lock.worker_id = p_worker_id;   -- renew own lock

  -- Read back owner (one round-trip, but always consistent after the write above)
  SELECT worker_id INTO v_owner
  FROM public.worker_lock
  WHERE user_id = p_user_id;

  RETURN COALESCE(v_owner = p_worker_id, false);
END;
$$;
