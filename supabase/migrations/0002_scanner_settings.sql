-- Scanner universe settings added to bot_settings
-- Run this migration in Supabase SQL Editor or via supabase db push

alter table public.bot_settings
  add column if not exists scan_universe text not null default 'all_futures',
  add column if not exists min_24h_volume_usd numeric not null default 500000,
  add column if not exists max_spread_percent numeric not null default 0.1,
  add column if not exists max_funding_rate_abs numeric not null default 0.003,
  add column if not exists max_symbols_per_tick int not null default 50,
  add column if not exists max_concurrent_requests int not null default 5,
  add column if not exists kline_limit int not null default 200,
  add column if not exists scanner_timeframe text not null default '5m',
  add column if not exists scanner_cursor text default '0';
