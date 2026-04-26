-- Multi-Exchange Futures Trading Bot — initial schema
-- Default trading mode: PAPER. Live trading is gated by env LIVE_TRADING=true and risk engine checks.

create extension if not exists "pgcrypto";

-- =====================================================================
-- Supported exchanges (catalog)
-- =====================================================================
create table if not exists public.supported_exchanges (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text,
  supports_spot boolean not null default true,
  supports_futures boolean not null default true,
  supports_websocket boolean not null default true,
  requires_passphrase boolean not null default false,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.supported_exchanges (name, slug, supports_spot, supports_futures, supports_websocket, requires_passphrase)
values
  ('MEXC', 'mexc', true, true, true, false),
  ('Binance', 'binance', true, true, true, false),
  ('OKX', 'okx', true, true, true, true),
  ('Bybit', 'bybit', true, true, true, false)
on conflict (slug) do nothing;

-- =====================================================================
-- Encrypted exchange credentials (server-side AES-GCM)
-- =====================================================================
create table if not exists public.exchange_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  exchange_name text not null,
  api_key_encrypted text not null,
  api_secret_encrypted text not null,
  api_passphrase_encrypted text,
  permissions jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  last_validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, exchange_name)
);

create index if not exists idx_exchange_credentials_user on public.exchange_credentials (user_id);

-- =====================================================================
-- Bot settings (per user)
-- =====================================================================
create table if not exists public.bot_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  active_exchange text not null default 'mexc',
  trading_mode text not null default 'paper',           -- paper | live
  market_type text not null default 'futures',          -- futures | spot
  margin_mode text not null default 'isolated',         -- isolated | cross
  bot_status text not null default 'stopped',           -- running | paused | stopped | kill_switch
  max_leverage numeric not null default 3,
  max_allowed_leverage numeric not null default 5,
  risk_per_trade_percent numeric not null default 1,
  max_daily_loss_percent numeric not null default 5,
  max_weekly_loss_percent numeric not null default 10,
  daily_profit_target_usd numeric not null default 20,
  max_open_positions int not null default 2,
  min_risk_reward_ratio numeric not null default 2,
  conservative_mode_enabled boolean not null default false,
  kill_switch_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =====================================================================
-- Watched symbols
-- =====================================================================
create table if not exists public.watched_symbols (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  exchange_name text not null,
  market_type text not null default 'futures',
  symbol text not null,
  is_active boolean not null default true,
  min_volume_usd numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, exchange_name, market_type, symbol)
);

-- =====================================================================
-- Market snapshots (rolling cache)
-- =====================================================================
create table if not exists public.market_snapshots (
  id uuid primary key default gen_random_uuid(),
  exchange_name text not null,
  market_type text not null,
  symbol text not null,
  timeframe text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_snap_lookup on public.market_snapshots (exchange_name, market_type, symbol, timeframe, created_at desc);

-- =====================================================================
-- Signals
-- =====================================================================
create table if not exists public.signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  exchange_name text not null,
  market_type text not null default 'futures',
  margin_mode text not null default 'isolated',
  symbol text not null,
  timeframe text not null,
  signal_type text not null,                            -- LONG | SHORT | WAIT | EXIT_LONG | EXIT_SHORT | NO_TRADE
  signal_score numeric not null default 0,
  entry_price numeric,
  stop_loss numeric,
  take_profit numeric,
  leverage numeric,
  margin_used numeric,
  estimated_liquidation_price numeric,
  risk_reward_ratio numeric,
  reasons jsonb not null default '[]'::jsonb,
  rejected_reason text,
  created_at timestamptz not null default now()
);
create index if not exists idx_signals_user_time on public.signals (user_id, created_at desc);

-- =====================================================================
-- Paper trades (futures-first)
-- =====================================================================
create table if not exists public.paper_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  exchange_name text not null,
  market_type text not null default 'futures',
  margin_mode text not null default 'isolated',
  symbol text not null,
  direction text not null,                              -- LONG | SHORT
  entry_price numeric not null,
  exit_price numeric,
  stop_loss numeric not null,
  take_profit numeric not null,
  leverage numeric not null,
  position_size numeric not null,
  margin_used numeric not null,
  risk_amount numeric not null,
  risk_reward_ratio numeric not null,
  estimated_liquidation_price numeric,
  signal_score numeric,
  entry_reason text,
  exit_reason text,
  pnl numeric default 0,
  pnl_percent numeric default 0,
  fees_estimated numeric default 0,
  funding_estimated numeric default 0,
  slippage_estimated numeric default 0,
  status text not null default 'open',                  -- open | closed | frozen
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_paper_trades_user on public.paper_trades (user_id, status, opened_at desc);

-- =====================================================================
-- Risk events
-- =====================================================================
create table if not exists public.risk_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  exchange_name text,
  symbol text,
  event_type text not null,
  severity text not null default 'info',                -- info | warning | critical
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_risk_events_user on public.risk_events (user_id, created_at desc);

-- =====================================================================
-- Bot logs
-- =====================================================================
create table if not exists public.bot_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  exchange_name text,
  level text not null default 'info',                   -- debug | info | warn | error
  event_type text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_bot_logs_user on public.bot_logs (user_id, created_at desc);

-- =====================================================================
-- Bot sessions (lifecycle)
-- =====================================================================
create table if not exists public.bot_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  status text not null default 'stopped',
  started_at timestamptz,
  stopped_at timestamptz,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- Daily performance
-- =====================================================================
create table if not exists public.daily_performance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  exchange_name text,
  date date not null,
  starting_balance numeric default 0,
  ending_balance numeric default 0,
  realized_pnl numeric default 0,
  unrealized_pnl numeric default 0,
  total_trades int default 0,
  winning_trades int default 0,
  losing_trades int default 0,
  win_rate numeric default 0,
  profit_factor numeric default 0,
  max_drawdown numeric default 0,
  daily_target_hit boolean default false,
  daily_loss_limit_hit boolean default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, exchange_name, date)
);

-- =====================================================================
-- Open positions (live or paper canonical view)
-- =====================================================================
create table if not exists public.open_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  exchange_name text not null,
  market_type text not null default 'futures',
  margin_mode text not null default 'isolated',
  symbol text not null,
  direction text not null,
  entry_price numeric not null,
  position_size numeric not null,
  leverage numeric not null,
  stop_loss numeric not null,
  take_profit numeric not null,
  estimated_liquidation_price numeric,
  source text not null default 'paper',                 -- paper | live
  paper_trade_id uuid references public.paper_trades(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =====================================================================
-- Strategy configs
-- =====================================================================
create table if not exists public.strategy_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  description text,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

-- =====================================================================
-- updated_at trigger
-- =====================================================================
create or replace function public.tg_set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

do $$ declare t text; begin
  for t in select unnest(array[
    'supported_exchanges','exchange_credentials','bot_settings','watched_symbols',
    'paper_trades','daily_performance','open_positions','strategy_configs'
  ]) loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.tg_set_updated_at()', t);
  end loop;
end $$;
