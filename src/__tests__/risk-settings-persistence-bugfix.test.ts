// Risk Settings Persistence Bugfix — guard against the regression where
// hard refresh wiped user-saved values (profile, capital, risk %, daily
// loss limit) back to defaults.
//
// Root cause: persistToDb used UPDATE keyed on user_id; on a fresh DB
// (no row for the system user) UPDATE matched 0 rows and silently
// no-op'd, while the API path called persist as void fire-and-forget.
// After Vercel cold start, the in-memory store re-hydrated to defaults
// because nothing was ever stored.
//
// This test pins the fix:
//   • PUT path must use upsert + await persistence.
//   • API must surface persistence success/failure (no phantom success).
//   • Trade/live invariants must remain untouched.

import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  __resetRiskSettingsStoreForTests,
  updateAndPersistRiskSettings,
  getPersistenceStatus,
  getRiskSettings,
} from "@/lib/risk-settings/store";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf-8");

beforeEach(() => __resetRiskSettingsStoreForTests());

describe("Risk Settings Persistence Bugfix", () => {
  it("persistToDb uses upsert (not bare update) so a missing row is created", () => {
    const src = read("src/lib/risk-settings/store.ts");
    expect(src).toMatch(/\.upsert\(/);
    expect(src).toMatch(/onConflict:\s*"user_id"/);
    // The old fire-and-forget call is gone.
    expect(src).not.toMatch(/void persistToDb\(/);
  });

  it("PUT path is awaited; validation succeeds, persistence is unconfigured under tests", async () => {
    const r = await updateAndPersistRiskSettings({
      profile: "LOW",
      capital: { totalCapitalUsdt: 1000 },
    });
    // No Supabase env in tests → persistence stage reports failure honestly
    // rather than silently claiming success.
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe("persistence");
      if (r.stage === "persistence") {
        expect(r.errorSafe).toMatch(/Supabase not configured/i);
        // In-memory state was still updated so the page can show the
        // intended values, but persistenceStatus reflects fallback.
        expect(r.data.profile).toBe("LOW");
        expect(r.data.capital.totalCapitalUsdt).toBe(1000);
      }
    }
    expect(getRiskSettings().profile).toBe("LOW");
    expect(getRiskSettings().capital.totalCapitalUsdt).toBe(1000);
  });

  it("averageDownEnabled=true is rejected even via the persisting API path", async () => {
    const r = await updateAndPersistRiskSettings({
      tiered: { averageDownEnabled: true as unknown as false },
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.stage === "validation") {
      expect(r.errors.join(" ")).toMatch(/Zararda pozisyon büyütme/);
    }
  });

  it("getPersistenceStatus exposes a state machine the UI can consume", () => {
    const s = getPersistenceStatus();
    expect(["pending", "ok", "fallback", "unconfigured"]).toContain(s.state);
  });

  it("API GET response includes persistenceStatus + persistenceErrorSafe", () => {
    const route = read("src/app/api/risk-settings/route.ts");
    expect(route).toMatch(/persistenceStatus/);
    expect(route).toMatch(/persistenceErrorSafe/);
  });

  it("API PUT awaits persistence and returns 500 when DB write fails", () => {
    const route = read("src/app/api/risk-settings/route.ts");
    expect(route).toMatch(/await\s+updateAndPersistRiskSettings/);
    expect(route).toMatch(/500/);
    expect(route).toMatch(/persistenceStatus:\s*"saved"/);
  });

  it("UI shows save state feedback (Kaydediliyor / Kaydedildi / Kaydetme başarısız)", () => {
    const page = read("src/app/risk/page.tsx");
    expect(page).toMatch(/Kaydediliyor/);
    expect(page).toMatch(/Kaydedildi/);
    expect(page).toMatch(/Kaydetme başarısız/);
    expect(page).toMatch(/RİSK AYARLARI KALICI KAYITTAN OKUNAMADI/);
  });

  it("Migration 0014 seeds the system user row + ensures risk_settings JSONB column", () => {
    const mig = read("supabase/migrations/0014_risk_settings_seed_row.sql");
    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS risk_settings JSONB/i);
    expect(mig).toMatch(/INSERT INTO public\.bot_settings/i);
    expect(mig).toMatch(/ON CONFLICT \(user_id\) DO NOTHING/i);
  });

  it("GET path force-reloads from DB so warm Vercel lambdas don't serve stale defaults", () => {
    const store = read("src/lib/risk-settings/store.ts");
    const route = read("src/app/api/risk-settings/route.ts");
    // Store exposes a force-reload helper that bypasses the per-process
    // hydrated flag. This is the runtime fix: without it, instance B can
    // serve stale defaults after instance A persisted new values.
    expect(store).toMatch(/export async function forceReloadFromDb/);
    // GET API uses the force-reload helper, not just ensureHydrated().
    expect(route).toMatch(/forceReloadFromDb\(\)/);
  });

  it("PUT path verifies the DB write actually landed (no phantom success)", () => {
    const store = read("src/lib/risk-settings/store.ts");
    // After update we read back the row independently to confirm
    // risk_settings is non-null AND echoes what we sent. If empty or
    // mismatched, persist reports failure rather than success.
    expect(store).toMatch(/DB verify (boş|mismatch)/);
    // Direct table fallback — when row missing, INSERT path is used.
    expect(store).toMatch(/direct_update|direct_insert|\.insert\(/);
  });

  it("GET ?debug=1 exposes safe persistence diagnostics", () => {
    const route = read("src/app/api/risk-settings/route.ts");
    const store = read("src/lib/risk-settings/store.ts");
    expect(route).toMatch(/debug.*=\s*url\.searchParams\.get\("debug"\)/);
    expect(store).toMatch(/getDebugSnapshot/);
    // Debug snapshot must include the diagnostic fields the spec requires.
    // Note: rowExists is the new spec name; dbRowFound was the legacy name.
    expect(store).toMatch(/rowExists|dbRowFound/);
    expect(store).toMatch(/dbRiskSettingsPresent/);
    expect(store).toMatch(/dbRiskSettingsProfile/);
    expect(store).toMatch(/dbRiskSettingsCapital/);
    expect(store).toMatch(/hasSupabaseConfigured/);
    expect(store).toMatch(/selectedUserId/);
    // Debug snapshot must NOT leak the actual service role key value.
    // hasServiceRoleKey BOOLEAN flag is allowed; the key value is never logged.
    expect(store).not.toMatch(/apiKey\s*[:=]/i);
    expect(store).not.toMatch(/api_key\s*[:=]/i);
  });

  it("Save events are logged to bot_logs (clicked / success / failed)", () => {
    const route = read("src/app/api/risk-settings/route.ts");
    expect(route).toMatch(/risk_settings_save_clicked/);
    expect(route).toMatch(/risk_settings_save_success/);
    expect(route).toMatch(/risk_settings_save_failed/);
  });

  it("Trade engine + live gate invariants remain untouched", () => {
    const env = read("src/lib/env.ts");
    expect(env).toMatch(/HARD_LIVE_TRADING_ALLOWED/);

    const exec = read("src/lib/live-execution/index.ts");
    expect(exec).toMatch(/LIVE_EXECUTION_NOT_IMPLEMENTED/);

    const sigEng = read("src/lib/engines/signal-engine.ts");
    expect(sigEng).toMatch(/if\s*\(score\s*<\s*70\)/);

    // No Binance order/leverage endpoints introduced by this bugfix.
    const route = read("src/app/api/risk-settings/route.ts");
    expect(route).not.toMatch(/\/fapi\/v1\/order/);
    expect(route).not.toMatch(/\/fapi\/v1\/leverage/);
    const store = read("src/lib/risk-settings/store.ts");
    expect(store).not.toMatch(/\/fapi\/v1\/order/);
    expect(store).not.toMatch(/\/fapi\/v1\/leverage/);
  });
});
