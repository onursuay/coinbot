-- 0025 — read_risk_settings: pg_advisory_xact_lock ile primary'ye zorla.
--
-- FOR NO KEY UPDATE (0023) PostgREST/PgBouncer routing'ini etkilemedi;
-- PgBouncer bağlantıyı zaten read replica'ya vermiş oluyordu.
-- pg_advisory_xact_lock bir DML operasyonudur (pg_locks'a yazar) →
-- transaction write-mode olur → Supabase/PgBouncer primary'ye yönlendirmeli.
-- User-specific lock ID: çok kullanıcılı durumda cross-user contention yok.
--
-- Supabase Dashboard → SQL Editor'a yapıştır ve çalıştır.

CREATE OR REPLACE FUNCTION public.read_risk_settings(
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  -- Write-mode hint: advisory lock forces PgBouncer to route to primary.
  PERFORM pg_advisory_xact_lock(
    ('x' || substr(md5(p_user_id::text), 1, 16))::bit(64)::bigint
  );
  SELECT risk_settings INTO result
    FROM public.bot_settings
   WHERE user_id = p_user_id;
  RETURN COALESCE(result, '{}'::jsonb);
END;
$$;

NOTIFY pgrst, 'reload schema';
