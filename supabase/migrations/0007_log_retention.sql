-- Log retention cleanup function.
-- Deletes old log rows based on severity/type. NEVER touches trade data.
--
-- Retention rules:
--   bot_logs level=debug|info          → 7 days
--   bot_logs level=warn                → 14 days
--   bot_logs level=error               → 30 days
--   bot_logs event_type LIKE kill_switch|safety|live_gate → 90 days (override)
--   risk_events severity=info          → 7 days
--   risk_events severity=warning       → 14 days
--   risk_events severity=critical      → 30 days
--   monitoring_reports                 → 30 days
--
-- Protected tables (never touched): paper_trades, order_lifecycle,
--   strategy_health, exchange_credentials, bot_settings, watched_symbols,
--   signals, exchange_accounts, worker_heartbeats

create or replace function public.cleanup_old_logs()
returns jsonb
language plpgsql
security definer
as $$
declare
  v_bot_logs_debug_info  int := 0;
  v_bot_logs_warn        int := 0;
  v_bot_logs_error       int := 0;
  v_risk_info            int := 0;
  v_risk_warning         int := 0;
  v_risk_critical        int := 0;
  v_monitoring           int := 0;
  v_total                int := 0;
begin

  -- bot_logs: kill_switch/safety/live_gate events keep 90 days regardless of level
  -- debug/info: 7 days (exclude long-retention events)
  delete from public.bot_logs
  where level in ('debug', 'info')
    and created_at < now() - interval '7 days'
    and event_type not ilike '%kill_switch%'
    and event_type not ilike '%safety%'
    and event_type not ilike '%live_gate%';
  get diagnostics v_bot_logs_debug_info = row_count;

  -- warn: 14 days (exclude long-retention events)
  delete from public.bot_logs
  where level = 'warn'
    and created_at < now() - interval '14 days'
    and event_type not ilike '%kill_switch%'
    and event_type not ilike '%safety%'
    and event_type not ilike '%live_gate%';
  get diagnostics v_bot_logs_warn = row_count;

  -- error: 30 days (exclude long-retention events)
  delete from public.bot_logs
  where level = 'error'
    and created_at < now() - interval '30 days'
    and event_type not ilike '%kill_switch%'
    and event_type not ilike '%safety%'
    and event_type not ilike '%live_gate%';
  get diagnostics v_bot_logs_error = row_count;

  -- risk_events: info → 7d, warning → 14d, critical → 30d
  delete from public.risk_events
  where severity = 'info'
    and created_at < now() - interval '7 days';
  get diagnostics v_risk_info = row_count;

  delete from public.risk_events
  where severity = 'warning'
    and created_at < now() - interval '14 days';
  get diagnostics v_risk_warning = row_count;

  delete from public.risk_events
  where severity = 'critical'
    and created_at < now() - interval '30 days';
  get diagnostics v_risk_critical = row_count;

  -- monitoring_reports: 30 days
  delete from public.monitoring_reports
  where created_at < now() - interval '30 days';
  get diagnostics v_monitoring = row_count;

  v_total := v_bot_logs_debug_info + v_bot_logs_warn + v_bot_logs_error
           + v_risk_info + v_risk_warning + v_risk_critical + v_monitoring;

  return jsonb_build_object(
    'deleted_total',           v_total,
    'bot_logs_debug_info',     v_bot_logs_debug_info,
    'bot_logs_warn',           v_bot_logs_warn,
    'bot_logs_error',          v_bot_logs_error,
    'risk_events_info',        v_risk_info,
    'risk_events_warning',     v_risk_warning,
    'risk_events_critical',    v_risk_critical,
    'monitoring_reports',      v_monitoring,
    'ran_at',                  now()
  );
end;
$$;

-- Allow service role to call this function
grant execute on function public.cleanup_old_logs() to service_role;
