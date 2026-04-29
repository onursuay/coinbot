-- Faz 20 — Risk Engine Binding: paper_trades risk_metadata column.
-- Stores risk lifecycle metadata (riskAmountUsdt, stopDistancePercent,
-- positionNotionalUsdt, riskConfigSource, riskConfigBound) as JSONB.
-- Safe: ADD COLUMN IF NOT EXISTS; no backfill required for existing rows.

ALTER TABLE paper_trades
  ADD COLUMN IF NOT EXISTS risk_metadata JSONB;

COMMENT ON COLUMN paper_trades.risk_metadata IS
  'Faz 20 risk metadata: risk_amount_usdt, risk_per_trade_percent, '
  'position_notional_usdt, stop_distance_percent, risk_config_source, risk_config_bound';
