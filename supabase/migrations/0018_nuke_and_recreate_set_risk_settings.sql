-- 0018 — set_risk_settings tüm overload'larını sil ve sıfırdan oluştur.
--
-- 0017'deki DROP FUNCTION IF EXISTS public.set_risk_settings(uuid, jsonb)
-- yalnızca argüman tipleri tam olarak (uuid, jsonb) olan overload'ı siler.
-- Production'daki stub farklı tiplerle tanımlanmışsa DROP sessizce atlanır.
--
-- Bu migration pg_proc'dan TÜM overload'ları listeleyip hepsini siler,
-- ardından tek doğru implementasyonu oluşturur.
-- Supabase Dashboard → SQL Editor'a yapıştır ve çalıştır.

-- 1) Tüm overload'ları sil
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT pg_get_function_identity_arguments(oid) AS args
      FROM pg_proc
     WHERE proname = 'set_risk_settings'
       AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.set_risk_settings(%s)', r.args);
  END LOOP;
END;
$$;

-- 2) Sıfırdan doğru implementasyonu oluştur.
--    GET DIAGNOSTICS ile kaç satır yazıldığını sayar;
--    sıfırsa EXCEPTION fırlatır — artık sessiz stub imkansız.
CREATE FUNCTION public.set_risk_settings(
  p_user_id uuid,
  p_settings jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result   jsonb;
  affected int := 0;
BEGIN
  UPDATE public.bot_settings
     SET risk_settings = p_settings
   WHERE user_id = p_user_id
  RETURNING risk_settings INTO result;

  GET DIAGNOSTICS affected = ROW_COUNT;

  IF affected = 0 THEN
    INSERT INTO public.bot_settings (user_id, risk_settings)
    VALUES (p_user_id, p_settings)
    RETURNING risk_settings INTO result;

    GET DIAGNOSTICS affected = ROW_COUNT;
  END IF;

  IF affected = 0 THEN
    RAISE EXCEPTION 'set_risk_settings: user_id % için hiç satır yazılamadı', p_user_id;
  END IF;

  RETURN result;
END;
$$;

-- 3) PostgREST schema cache'ini yenile
NOTIFY pgrst, 'reload schema';
