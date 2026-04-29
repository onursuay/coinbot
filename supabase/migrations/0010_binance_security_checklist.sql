-- Faz 17 — Binance Security Checklist
-- JSONB column on bot_settings to persist the manual checklist state
-- (withdraw permission disabled, IP restriction, futures permission, extra permissions reviewed).
-- Schema is intentionally minimal; nothing in this migration changes trading behavior.

ALTER TABLE bot_settings
  ADD COLUMN IF NOT EXISTS binance_security_checklist JSONB
  DEFAULT '{
    "withdrawPermissionDisabled": "unknown",
    "ipRestrictionConfigured": "unknown",
    "futuresPermissionConfirmed": "unknown",
    "extraPermissionsReviewed": "unknown",
    "updatedAt": null
  }'::jsonb;
