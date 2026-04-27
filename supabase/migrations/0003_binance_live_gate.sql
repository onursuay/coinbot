-- Triple-gate live trading + Binance default + heartbeat + LLM analysis tables.
-- Run after 0002_scanner_settings.sql

-- ============================================================
-- bot_settings: triple-gate live trading + tier config + worker
-- ============================================================
alter table public.bot_settings
  add column if not exists enable_live_trading boolean not null default false,
  add column if not exists allowed_symbols text[] not null default array[
    'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT',
    'AVAXUSDT','LINKUSDT','DOGEUSDT','ADAUSDT','LTCUSDT'
  ],
  add column if not exists max_consecutive_losses int not null default 3,
  add column if not exists min_strategy_health_score_to_trade int not null default 60,
  add column if not exists kill_switch_reason text,
  add column if not exists last_heartbeat timestamptz,
  add column if not exists worker_id text,
  add column if not exists worker_status text default 'offline', -- offline | running_paper | running_live | safe_mode | error
  add column if not exists websocket_status text default 'disconnected',
  add column if not exists binance_api_status text default 'unknown',
  add column if not exists last_error text,
  add column if not exists updated_by text default 'system';

-- Bot_status now supports extended states. Existing values preserved (running | paused | stopped | kill_switch).
-- New states are interpreted by orchestrator: running_paper | running_live | safe_mode | kill_switch_triggered | error.
-- We do NOT add a constraint here to avoid breaking existing rows.

-- Default active_exchange flip to binance (existing rows untouched; new rows get binance)
alter table public.bot_settings alter column active_exchange set default 'binance';

-- ============================================================
-- worker_heartbeat: separate table for high-frequency heartbeat updates
-- (avoids row contention on bot_settings)
-- ============================================================
create table if not exists public.worker_heartbeat (
  id uuid primary key default gen_random_uuid(),
  worker_id text not null unique,
  status text not null,
  active_mode text,             -- paper | live
  active_exchange text,
  websocket_status text,
  binance_api_status text,
  open_positions_count int default 0,
  last_error text,
  last_heartbeat timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_worker_heartbeat_last on public.worker_heartbeat (last_heartbeat desc);

-- ============================================================
-- ai_analysis_runs: LLM output (analysis only, no execution)
-- ============================================================
create table if not exists public.ai_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  run_type text not null,        -- daily_summary | weekly_review | trade_journal | risk_insight | strategy_review
  prompt_template text not null,
  model text not null,
  status text not null default 'pending',  -- pending | success | failed
  input_summary jsonb,
  output_text text,
  output_recommendations jsonb,  -- structured recommendations (not auto-applied)
  approved_by_human boolean not null default false,
  approved_at timestamptz,
  applied boolean not null default false,
  applied_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists idx_ai_runs_user_created on public.ai_analysis_runs (user_id, created_at desc);

-- ============================================================
-- order_lifecycle: track every order from submission to settlement
-- ============================================================
create table if not exists public.order_lifecycle (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  client_order_id text not null unique,
  exchange_order_id text,
  exchange_name text not null,
  symbol text not null,
  side text not null,                -- BUY | SELL
  position_direction text not null,  -- LONG | SHORT
  order_type text not null,          -- MARKET | LIMIT | STOP_MARKET | TAKE_PROFIT_MARKET
  reduce_only boolean not null default false,
  is_protective boolean not null default false,  -- true for SL/TP
  parent_position_id uuid,           -- ref to paper_trades.id or live position id
  status text not null default 'submitted', -- submitted | filled | partially_filled | cancelled | rejected | expired | failed
  requested_qty numeric,
  filled_qty numeric default 0,
  remaining_qty numeric,
  avg_fill_price numeric,
  trading_mode text not null,        -- paper | live
  submitted_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  filled_at timestamptz,
  cancelled_at timestamptz,
  last_check_at timestamptz,
  reconciled boolean not null default false,
  reconciliation_note text,
  raw_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_order_lifecycle_user_status on public.order_lifecycle (user_id, status);
create index if not exists idx_order_lifecycle_position on public.order_lifecycle (parent_position_id);

-- ============================================================
-- strategy_health: daily score tracking
-- ============================================================
create table if not exists public.strategy_health (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  date date not null,
  score int not null,                 -- 0-100
  win_rate numeric,
  profit_factor numeric,
  max_drawdown_percent numeric,
  consecutive_losses int,
  stop_loss_hit_rate numeric,
  take_profit_hit_rate numeric,
  api_stability_score numeric,
  websocket_stability_score numeric,
  metrics_json jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, date)
);
create index if not exists idx_strategy_health_user_date on public.strategy_health (user_id, date desc);
