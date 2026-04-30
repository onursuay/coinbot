-- 0022 — write_risk_settings: set_risk_settings PostgREST cache sorununu aşmak için yeni isim.
--
-- set_risk_settings da get_risk_settings gibi PostgREST cache'inde eski stub
-- OID'siyle kilitli kalmış. Yazma işlemi DB'ye ulaşmıyor; RAISE EXCEPTION da
-- tetiklenmiyor (stub olduğu için affected=0'a düşmüyor).
--
-- read_risk_settings yeniden adlandırması okuma için çalıştı. Aynı yöntem
-- yazma için uygulanıyor: yeni isim, PostgREST cache yok, direkt DB yazması.
--
-- Supabase Dashboard → SQL Editor'a yapıştır ve çalıştır.

CREATE OR REPLACE FUNCTION public.write_risk_settings(
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
    RAISE EXCEPTION 'write_risk_settings: user_id % için hiç satır yazılamadı', p_user_id;
  END IF;

  RETURN result;
END;
$$;

NOTIFY pgrst, 'reload schema';
