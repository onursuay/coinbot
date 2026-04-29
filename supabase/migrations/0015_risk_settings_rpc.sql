-- Risk Settings Persistence Runtime Fix — RPC bypass.
--
-- Background: After the upsert path was already correct (0014) and the system
-- user row + risk_settings JSONB column were verified present in production,
-- supabase-js upserts continued returning 200 OK while the column stayed NULL
-- — even after NOTIFY pgrst, 'reload schema'. Manual raw-SQL UPDATE on the
-- same row succeeded, proving the issue is in PostgREST's column resolution
-- for write paths (cached prepared statements vs. the freshly-added column),
-- not in the underlying schema or RLS.
--
-- Fix: route writes through a SECURITY DEFINER plpgsql function that executes
-- raw SQL inside the database. The function signature stays stable, so once
-- PostgREST caches it, subsequent calls always hit raw SQL — no column
-- resolution at the REST layer for the JSONB payload.
--
-- Pure config persistence. Trade engine, signal engine, risk engine
-- execution, live trading gate are NOT touched. No Binance API.

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
  -- Update first; if no row matches, insert. Stable across cold starts and
  -- never silently no-ops because RETURNING surfaces the actual stored value.
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

-- Make sure PostgREST picks up the new function definition.
NOTIFY pgrst, 'reload schema';
