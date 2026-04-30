-- 0024 — read_risk_settings: no-op UPDATE + RETURNING ile primary'den oku.
--
-- FOR NO KEY UPDATE lock Supabase'in read replica yönlendirmesini bypass etmedi.
-- Tek garantili yöntem: gerçek bir UPDATE DML statement'ı.
-- SET risk_settings = risk_settings → satırı değiştirmez ama UPDATE transaction'ı
-- primary'ye zorlar; RETURNING primary'deki taze değeri döndürür.
-- Yan etki: BEFORE trigger'dan updated_at = NOW() olur (kabul edilebilir).
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
  UPDATE public.bot_settings
     SET risk_settings = risk_settings
   WHERE user_id = p_user_id
  RETURNING risk_settings INTO result;

  RETURN COALESCE(result, '{}'::jsonb);
END;
$$;

NOTIFY pgrst, 'reload schema';
