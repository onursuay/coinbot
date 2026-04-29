-- Faz 19 — Risk Settings persistence.
-- JSONB column on bot_settings to persist user-configured risk profile across worker restarts.
-- Pure config store. Trading behavior is unaffected by this migration.

ALTER TABLE bot_settings
  ADD COLUMN IF NOT EXISTS risk_settings JSONB;
