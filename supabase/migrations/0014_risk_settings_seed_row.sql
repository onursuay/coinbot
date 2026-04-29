-- Faz 19 follow-up — Risk Settings persistence seed row.
--
-- 0011 migration added bot_settings.risk_settings JSONB. But persistence path
-- used UPDATE keyed on user_id; on a fresh DB (no row for the single-tenant
-- system user) UPDATE matched 0 rows and silently no-op'd. After a Vercel
-- cold start the in-memory store re-hydrated to defaults, which is what the
-- user observed as "Kaydet does nothing on hard refresh".
--
-- Two-part fix: persist path is switched to upsert (see store.ts), and this
-- migration ensures the system user's row exists. Idempotent.

ALTER TABLE bot_settings
  ADD COLUMN IF NOT EXISTS risk_settings JSONB;

INSERT INTO public.bot_settings (user_id)
VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (user_id) DO NOTHING;
