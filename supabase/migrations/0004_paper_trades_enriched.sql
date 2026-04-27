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
