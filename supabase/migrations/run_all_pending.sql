-- ============================================================
-- Pending migrations to run in Supabase SQL Editor
-- Copy-paste this entire file into Supabase → SQL Editor → Run
-- All statements are idempotent (safe to run multiple times)
-- ============================================================

-- ── 0003_binance_live_gate ───────────────────────────────────

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
  add column if not exists worker_status text default 'offline',
  add column if not exists websocket_status text default 'disconnected',
  add column if not exists binance_api_status text default 'unknown',
  add column if not exists last_error text,
  add column if not exists updated_by text default 'system';

alter table public.bot_settings alter column active_exchange set default 'binance';

create table if not exists public.worker_heartbeat (
  id uuid primary key default gen_random_uuid(),
  worker_id text not null unique,
  status text not null,
  active_mode text,
  active_exchange text,
  websocket_status text,
  binance_api_status text,
  open_positions_count int default 0,
  last_error text,
  last_heartbeat timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_worker_heartbeat_last on public.worker_heartbeat (last_heartbeat desc);

create table if not exists public.ai_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  run_type text not null,
  prompt_template text not null,
  model text not null,
  status text not null default 'pending',
  input_summary jsonb,
  output_text text,
  output_recommendations jsonb,
  approved_by_human boolean not null default false,
  approved_at timestamptz,
  applied boolean not null default false,
  applied_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists idx_ai_runs_user_created on public.ai_analysis_runs (user_id, created_at desc);

create table if not exists public.order_lifecycle (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  client_order_id text not null unique,
  exchange_order_id text,
  exchange_name text not null,
  symbol text not null,
  side text not null,
  position_direction text not null,
  order_type text not null,
  reduce_only boolean not null default false,
  is_protective boolean not null default false,
  parent_position_id uuid,
  status text not null default 'submitted',
  requested_qty numeric,
  filled_qty numeric default 0,
  remaining_qty numeric,
  avg_fill_price numeric,
  trading_mode text not null,
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

create table if not exists public.strategy_health (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  date date not null,
  score int not null,
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

-- ── 0004_paper_trades_enriched ───────────────────────────────

alter table public.paper_trades
  add column if not exists tier text,
  add column if not exists spread_percent numeric,
  add column if not exists atr_percent numeric,
  add column if not exists funding_rate numeric,
  add column if not exists is_paper boolean not null default true,
  add column if not exists signal_confidence numeric,
  add column if not exists risk_percent numeric;

alter table public.bot_settings
  add column if not exists min_paper_trades_before_live int not null default 100,
  add column if not exists min_profit_factor_for_live numeric not null default 1.3,
  add column if not exists max_drawdown_for_live_percent numeric not null default 10,
  add column if not exists min_win_rate_for_live numeric not null default 45;

-- ── 0005_tick_summary ────────────────────────────────────────

alter table public.bot_settings
  add column if not exists last_tick_at timestamptz,
  add column if not exists last_tick_summary jsonb;
