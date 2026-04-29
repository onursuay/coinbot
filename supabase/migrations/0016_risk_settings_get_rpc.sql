-- Risk Settings Persistence Runtime Fix Part 2 — RPC-only read path.
--
-- Background: Even after 0015 introduced set_risk_settings(), the API
-- response still showed "Kaydetme başarısız" although the row in
-- bot_settings was correctly updated. Manual SQL SELECT in the dashboard
-- returned the row; supabase-js .select("risk_settings") returned the
-- column as undefined/null. That isolates the failure to PostgREST's
-- per-column schema cache for the freshly-added JSONB column — write
-- went through the RPC just fine, but the verify-read used the cached
-- column-level path and reported empty.
--
-- Fix: route reads through a SECURITY DEFINER plpgsql function as well.
-- Like 0015 for writes, this bypasses PostgREST column resolution. The
-- function name stays stable, so once cached PostgREST always reaches
-- raw SQL that does see the column.
--
-- Pure config persistence. Trade engine, signal engine, risk engine
-- execution, live trading gate are NOT touched. No Binance API.

CREATE OR REPLACE FUNCTION public.get_risk_settings(
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
  RETURN result;
END;
$$;

NOTIFY pgrst, 'reload schema';
