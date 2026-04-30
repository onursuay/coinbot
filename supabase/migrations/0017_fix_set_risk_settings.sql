-- 0017 — set_risk_settings fonksiyonunu yeniden oluştur.
--
-- Üretimdeki fonksiyon stub davranışı sergiliyor: p_settings'i
-- yazmadan geri döndürüyor. DROP + CREATE OR REPLACE ile düzeltilir.
--
-- Supabase Dashboard → SQL Editor'a yapıştır ve çalıştır.

DROP FUNCTION IF EXISTS public.set_risk_settings(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.set_risk_settings(
  p_user_id uuid,
  p_settings jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  UPDATE public.bot_settings
     SET risk_settings = p_settings
   WHERE user_id = p_user_id
  RETURNING risk_settings INTO result;

  IF NOT FOUND THEN
    INSERT INTO public.bot_settings (user_id, risk_settings)
    VALUES (p_user_id, p_settings)
    RETURNING risk_settings INTO result;
  END IF;

  RETURN result;
END;
$$;

NOTIFY pgrst, 'reload schema';
