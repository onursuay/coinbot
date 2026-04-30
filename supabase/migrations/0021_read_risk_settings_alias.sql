-- 0021 — read_risk_settings: get_risk_settings cache sorununu aşmak için yeni isim.
--
-- PostgREST birden fazla instance'da çalışıyor; NOTIFY pgrst, 'reload schema'
-- tüm instance'lara ulaşmıyor. get_risk_settings adı PostgREST cache'inde
-- eski stub'a kilitli kalmış. Yeni isimle fonksiyon oluşturulunca PostgREST
-- bu ismi ilk kez görür, cache yoktur, doğru implementasyonu çağırır.
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
   WHERE user_id = p_user_id;

  RETURN COALESCE(result, '{}'::jsonb);
END;
$$;

NOTIFY pgrst, 'reload schema';
