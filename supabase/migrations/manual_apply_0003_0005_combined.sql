-- ============================================================
-- MANUAL APPLY: migrations 0003 + 0004 + 0005 (combined, idempotent)
--
-- PRE-CONDITION: migrations 0001_init.sql and 0002_scanner_settings.sql
-- must already be applied to the Supabase project.
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New query
--   Paste this entire file → Run (F5)
--   All statements use IF NOT EXISTS / IF NOT EXISTS → safe to re-run.
--
-- DOES NOT:
--   - Drop any table or column
--   - Truncate any data
--   - Enable live trading (HARD_LIVE_TRADING_ALLOWED stays false)
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- 0003: bot_settings — triple-gate live trading columns
-- ════════════════════════════════════════════════════════════

alter table public.bot_settings
  add column if not exists enable_live_trading           boolean  not null default false,
  add column if not exists allowed_symbols               text[]   not null default array[
    'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT',
    'AVAXUSDT','LINKUSDT','DOGEUSDT','ADAUSDT','LTCUSDT'
  ],
  add column if not exists max_consecutive_losses        int      not null default 3,
  add column if not exists min_strategy_health_score_to_trade int not null default 60,
  add column if not exists kill_switch_reason            text,
  add column if not exists last_heartbeat                timestamptz,
  add column if not exists worker_id                     text,
  add column if not exists worker_status                 text              default 'offline',
  add column if not exists websocket_status              text              default 'disconnected',
  add column if not exists binance_api_status            text              default 'unknown',
  add column if not exists last_error                    text,
  add column if not exists updated_by                    text              default 'system';

-- Flip default exchange from mexc → binance for new rows only.
-- Existing rows are NOT changed by this ALTER.
alter table public.bot_settings
  alter column active_exchange set default 'binance';

-- ════════════════════════════════════════════════════════════
-- 0003: worker_heartbeat table
-- ════════════════════════════════════════════════════════════

create table if not exists public.worker_heartbeat (
  id                  uuid        primary key default gen_random_uuid(),
  worker_id           text        not null unique,
  status              text        not null,
  active_mode         text,                    -- paper | live
  active_exchange     text,
  websocket_status    text,
  binance_api_status  text,
  open_positions_count int                     default 0,
  last_error          text,
  last_heartbeat      timestamptz not null     default now(),
  created_at          timestamptz not null     default now()
);

create index if not exists idx_worker_heartbeat_last
  on public.worker_heartbeat (last_heartbeat desc);

-- ════════════════════════════════════════════════════════════
-- 0003: ai_analysis_runs table  (analysis-only, never executes orders)
-- ════════════════════════════════════════════════════════════

create table if not exists public.ai_analysis_runs (
  id                      uuid        primary key default gen_random_uuid(),
  user_id                 uuid        not null,
  run_type                text        not null,   -- daily_summary | weekly_review | risk_insight | strategy_review
  prompt_template         text        not null,
  model                   text        not null,
  status                  text        not null default 'pending', -- pending | success | failed
  input_summary           jsonb,
  output_text             text,
  output_recommendations  jsonb,
  approved_by_human       boolean     not null default false,
  approved_at             timestamptz,
  applied                 boolean     not null default false,
  applied_at              timestamptz,
  error                   text,
  created_at              timestamptz not null default now()
);

create index if not exists idx_ai_runs_user_created
  on public.ai_analysis_runs (user_id, created_at desc);

-- ════════════════════════════════════════════════════════════
-- 0003: order_lifecycle table  (future live order tracking)
-- ════════════════════════════════════════════════════════════

create table if not exists public.order_lifecycle (
  id                   uuid        primary key default gen_random_uuid(),
  user_id              uuid        not null,
  client_order_id      text        not null unique,
  exchange_order_id    text,
  exchange_name        text        not null,
  symbol               text        not null,
  side                 text        not null,           -- BUY | SELL
  position_direction   text        not null,           -- LONG | SHORT
  order_type           text        not null,           -- MARKET | LIMIT | STOP_MARKET | TAKE_PROFIT_MARKET
  reduce_only          boolean     not null default false,
  is_protective        boolean     not null default false,
  parent_position_id   uuid,
  status               text        not null default 'submitted',
  requested_qty        numeric,
  filled_qty           numeric                default 0,
  remaining_qty        numeric,
  avg_fill_price       numeric,
  trading_mode         text        not null,           -- paper | live
  submitted_at         timestamptz not null default now(),
  acknowledged_at      timestamptz,
  filled_at            timestamptz,
  cancelled_at         timestamptz,
  last_check_at        timestamptz,
  reconciled           boolean     not null default false,
  reconciliation_note  text,
  raw_response         jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_order_lifecycle_user_status
  on public.order_lifecycle (user_id, status);

create index if not exists idx_order_lifecycle_position
  on public.order_lifecycle (parent_position_id);

-- ════════════════════════════════════════════════════════════
-- 0003: strategy_health table
-- upsert conflict: (user_id, date) — one row per user per day
-- ════════════════════════════════════════════════════════════

create table if not exists public.strategy_health (
  id                          uuid  primary key default gen_random_uuid(),
  user_id                     uuid  not null,
  date                        date  not null,
  score                       int   not null,          -- 0-100
  win_rate                    numeric,
  profit_factor               numeric,
  max_drawdown_percent        numeric,
  consecutive_losses          int,
  stop_loss_hit_rate          numeric,
  take_profit_hit_rate        numeric,
  api_stability_score         numeric,
  websocket_stability_score   numeric,
  metrics_json                jsonb,
  created_at                  timestamptz not null default now(),
  unique (user_id, date)
);

create index if not exists idx_strategy_health_user_date
  on public.strategy_health (user_id, date desc);

-- ════════════════════════════════════════════════════════════
-- 0004: paper_trades — enriched columns for tier/spread/ATR/funding
-- ════════════════════════════════════════════════════════════

alter table public.paper_trades
  add column if not exists tier               text,
  add column if not exists spread_percent     numeric,
  add column if not exists atr_percent        numeric,
  add column if not exists funding_rate       numeric,
  add column if not exists is_paper           boolean  not null default true,
  add column if not exists signal_confidence  numeric,
  add column if not exists risk_percent       numeric;

-- ════════════════════════════════════════════════════════════
-- 0004: bot_settings — live readiness thresholds
-- ════════════════════════════════════════════════════════════

alter table public.bot_settings
  add column if not exists min_paper_trades_before_live   int     not null default 100,
  add column if not exists min_profit_factor_for_live     numeric not null default 1.3,
  add column if not exists max_drawdown_for_live_percent  numeric not null default 10,
  add column if not exists min_win_rate_for_live          numeric not null default 45;

-- ════════════════════════════════════════════════════════════
-- 0005: bot_settings — last_tick_at / last_tick_summary
-- Persisted by worker after each tick for dashboard visibility.
-- ════════════════════════════════════════════════════════════

alter table public.bot_settings
  add column if not exists last_tick_at       timestamptz,
  add column if not exists last_tick_summary  jsonb;

-- ════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES
-- After running, execute these SELECT statements to confirm:
-- ════════════════════════════════════════════════════════════

-- SELECT column_name, data_type, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'bot_settings'
--   AND column_name IN (
--     'enable_live_trading','allowed_symbols','kill_switch_reason',
--     'worker_status','last_tick_at','last_tick_summary',
--     'min_paper_trades_before_live','min_strategy_health_score_to_trade'
--   )
-- ORDER BY column_name;

-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN ('worker_heartbeat','ai_analysis_runs','order_lifecycle','strategy_health');
