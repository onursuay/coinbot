-- ============================================================
-- SCHEMA VERIFICATION — run after manual_apply_0003_0005_combined.sql
-- Copy-paste into Supabase SQL Editor → Run
-- All queries are read-only (SELECT only). Safe to run any time.
-- Expected: every result column should be "PRESENT" or "✓"
-- ============================================================

-- ── 1. bot_settings: required columns ───────────────────────
SELECT
  column_name,
  data_type,
  column_default,
  is_nullable,
  CASE WHEN column_name IS NOT NULL THEN 'PRESENT' ELSE 'MISSING' END AS status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'bot_settings'
  AND column_name IN (
    -- base (0001)
    'user_id', 'active_exchange', 'trading_mode', 'bot_status',
    'kill_switch_active', 'max_leverage', 'max_allowed_leverage',
    -- 0002
    'scan_universe', 'scanner_timeframe', 'scanner_cursor',
    -- 0003
    'enable_live_trading', 'allowed_symbols', 'max_consecutive_losses',
    'min_strategy_health_score_to_trade', 'kill_switch_reason',
    'last_heartbeat', 'worker_id', 'worker_status',
    'websocket_status', 'binance_api_status', 'last_error', 'updated_by',
    -- 0004
    'min_paper_trades_before_live', 'min_profit_factor_for_live',
    'max_drawdown_for_live_percent', 'min_win_rate_for_live',
    -- 0005
    'last_tick_at', 'last_tick_summary'
  )
ORDER BY column_name;

-- ── 2. bot_settings: active_exchange default is 'binance' ───
SELECT
  column_name,
  column_default,
  CASE
    WHEN column_default LIKE '%binance%' THEN '✓ default=binance'
    ELSE '✗ default is NOT binance: ' || COALESCE(column_default, 'NULL')
  END AS check_result
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'bot_settings'
  AND column_name  = 'active_exchange';

-- ── 3. paper_trades: enriched columns ───────────────────────
SELECT
  column_name,
  data_type,
  CASE WHEN column_name IS NOT NULL THEN 'PRESENT' ELSE 'MISSING' END AS status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'paper_trades'
  AND column_name IN (
    'tier', 'spread_percent', 'atr_percent', 'funding_rate',
    'is_paper', 'signal_confidence', 'risk_percent'
  )
ORDER BY column_name;

-- ── 4. tables: 0003 new tables present ──────────────────────
SELECT
  table_name,
  CASE WHEN table_name IS NOT NULL THEN '✓ EXISTS' ELSE '✗ MISSING' END AS status
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'worker_heartbeat',
    'ai_analysis_runs',
    'order_lifecycle',
    'strategy_health'
  )
ORDER BY table_name;

-- ── 5. worker_heartbeat: column check ───────────────────────
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'worker_heartbeat'
ORDER BY ordinal_position;

-- ── 6. strategy_health: unique constraint (user_id, date) ───
SELECT
  tc.constraint_name,
  tc.constraint_type,
  kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
WHERE tc.table_schema = 'public'
  AND tc.table_name   = 'strategy_health'
  AND tc.constraint_type = 'UNIQUE'
ORDER BY kcu.ordinal_position;

-- ── 7. indexes present ───────────────────────────────────────
SELECT indexname, tablename
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_worker_heartbeat_last',
    'idx_ai_runs_user_created',
    'idx_order_lifecycle_user_status',
    'idx_order_lifecycle_position',
    'idx_strategy_health_user_date'
  )
ORDER BY indexname;

-- ── 8. row count check (all tables should exist and be queryable) ──
SELECT
  'bot_settings'       AS tbl, count(*) FROM public.bot_settings
UNION ALL SELECT
  'worker_heartbeat'   AS tbl, count(*) FROM public.worker_heartbeat
UNION ALL SELECT
  'paper_trades'       AS tbl, count(*) FROM public.paper_trades
UNION ALL SELECT
  'strategy_health'    AS tbl, count(*) FROM public.strategy_health
UNION ALL SELECT
  'order_lifecycle'    AS tbl, count(*) FROM public.order_lifecycle
UNION ALL SELECT
  'ai_analysis_runs'   AS tbl, count(*) FROM public.ai_analysis_runs
UNION ALL SELECT
  'signals'            AS tbl, count(*) FROM public.signals
UNION ALL SELECT
  'bot_logs'           AS tbl, count(*) FROM public.bot_logs;

-- ── EXPECTED RESULTS ─────────────────────────────────────────
-- Query 1 (bot_settings columns): all 30 rows should show PRESENT
-- Query 2 (active_exchange default): ✓ default=binance
-- Query 3 (paper_trades enriched): all 7 rows should show PRESENT
-- Query 4 (new tables): 4 rows — worker_heartbeat, ai_analysis_runs,
--           order_lifecycle, strategy_health — all showing ✓ EXISTS
-- Query 5 (worker_heartbeat columns): ~10 columns
-- Query 6 (strategy_health unique): user_id + date both listed
-- Query 7 (indexes): 5 index rows present
-- Query 8 (row counts): all tables return 0 (empty is expected, no errors)
