-- 0020 — get_risk_settings tüm overload'larını sil ve sıfırdan oluştur.
--
-- debug_write_verify testi: DB'de 7777 var, get_risk_settings hâlâ 5555 döndürüyor.
-- Yazma fonksiyonu (set_risk_settings) 0018 ile düzeltildi ve çalışıyor.
-- Okuma fonksiyonu (get_risk_settings) stub olarak kalmış — DB'yi okumadan
-- eski değeri döndürüyor.
--
-- 0016'daki CREATE OR REPLACE farklı argüman tipli eski overload'ı atlıyor olabilir.
-- Bu migration pg_proc ile TÜM overload'ları siler, ardından doğru
-- implementasyonu CREATE FUNCTION ile kurar.
--
-- Supabase Dashboard → SQL Editor'a yapıştır ve çalıştır.

-- 1) Tüm overload'ları sil
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT pg_get_function_identity_arguments(oid) AS args
      FROM pg_proc
     WHERE proname = 'get_risk_settings'
       AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.get_risk_settings(%s)', r.args);
  END LOOP;
END;
$$;

-- 2) Doğru implementasyonu oluştur — NULL dönmez, satır yoksa boş obje döner
CREATE FUNCTION public.get_risk_settings(
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

-- 3) PostgREST schema cache'ini yenile
NOTIFY pgrst, 'reload schema';
