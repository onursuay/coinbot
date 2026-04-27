-- Last tick summary + diagnostics state stored on bot_settings.
-- Persisted by orchestrator after each tick so dashboard can show scanner visibility
-- without a separate table or extra fetches.

alter table public.bot_settings
  add column if not exists last_tick_at timestamptz,
  add column if not exists last_tick_summary jsonb;
