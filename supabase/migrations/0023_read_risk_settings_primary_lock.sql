-- 0023 — read_risk_settings: FOR NO KEY UPDATE ile primary'ye zorla.
--
-- DB'de doğru değer (6666) var (SQL Editor Primary Database ile doğrulandı).
-- read_risk_settings PostgREST RPC üzerinden eski değer (9999) döndürüyor.
-- Supabase bazı okuma transaction'larını read replica'ya yönlendiriyor.
--
-- FOR NO KEY UPDATE: row-level lock alır → transaction read-write olur →
-- PostgREST/Supabase primary'ye yönlendirir → taze veri okunur.
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
  SELECT risk_settings INTO result
    FROM public.bot_settings
   WHERE user_id = p_user_id
     FOR NO KEY UPDATE;

  RETURN COALESCE(result, '{}'::jsonb);
END;
$$;

NOTIFY pgrst, 'reload schema';
