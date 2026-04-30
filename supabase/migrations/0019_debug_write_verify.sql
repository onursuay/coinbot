-- 0019 — Tek transaction içinde yaz+oku tanı fonksiyonu.
--
-- set_risk_settings çağrısının ardından get_risk_settings eski değeri
-- döndürüyor. İki olasılık var:
--   A) Yazma gerçekten çalışıyor ama okuma farklı bir bağlantı/replica'dan geliyor.
--   B) Yazma hiç çalışmıyor (RETURNING değeri yanıltıcı).
--
-- Bu fonksiyon HER İKİSİNİ de aynı transaction içinde test eder:
--   1) risk_settings.capital.totalCapitalUsdt → p_cap yazar
--   2) Hemen aynı transaction'da SELECT ile okur
--   3) Her ikisini de döndürür
--
-- match=true  → yazma DB'de çalışıyor, sorun okuma yolunda (get_risk_settings / PostgREST cache)
-- match=false → yazma DB'de çalışmıyor; tablo/RLS/trigger sorunu var
--
-- Supabase Dashboard → SQL Editor'a yapıştır ve çalıştır.

CREATE OR REPLACE FUNCTION public.debug_write_verify(
  p_user_id uuid,
  p_cap     numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_settings  jsonb;
  returning_val numeric;
  select_val    numeric;
  row_before    jsonb;
BEGIN
  -- mevcut değeri kaydet
  SELECT risk_settings INTO row_before
    FROM public.bot_settings
   WHERE user_id = p_user_id;

  -- capital.totalCapitalUsdt alanını p_cap ile yaz
  UPDATE public.bot_settings
     SET risk_settings = jsonb_set(
           COALESCE(risk_settings, '{}'::jsonb),
           '{capital,totalCapitalUsdt}',
           to_jsonb(p_cap)
         )
   WHERE user_id = p_user_id
  RETURNING risk_settings INTO new_settings;

  returning_val := (new_settings -> 'capital' ->> 'totalCapitalUsdt')::numeric;

  -- AYNI transaction içinde hemen SELECT ile oku
  SELECT (risk_settings -> 'capital' ->> 'totalCapitalUsdt')::numeric
    INTO select_val
    FROM public.bot_settings
   WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'before',         (row_before -> 'capital' ->> 'totalCapitalUsdt')::numeric,
    'returning_val',  returning_val,
    'select_val',     select_val,
    'match',          (returning_val = select_val AND select_val = p_cap),
    'wrote_cap',      p_cap
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
