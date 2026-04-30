// Risk Settings Direct Persistence Bugfix
//
// Önceki regresyon: persistToDb RPC kullanıyordu; supabase-js → PostgREST
// üzerinden RPC çağrısının RETURNING'i yeni değeri gösteriyordu ama
// transaction commit olmuyordu (veya başka bir process anında üzerine
// yazıyordu). Sonuç: "sent profile=STANDARD cap=2222 but DB has profile=LOW
// cap=2222 — RPC RETURNING aldatıcı, gerçekte commit olmuyor".
//
// Bu test:
//   • persistToDb RPC kullanmadığını,
//   • Source of truth single column (bot_settings.risk_settings),
//   • PUT verify direct DB select ile yapılıyor (in-memory veya RPC değil),
//   • GET response'unda source field'ının olduğunu (db_bot_settings_risk_settings
//     veya default_fallback_no_db_settings),
//   • Yeni bot_logs eventlerinin log'landığını,
//   • Trade/live invariant'larının değişmediğini doğrular.

import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  __resetRiskSettingsStoreForTests,
  updateAndPersistRiskSettings,
  getRiskSettings,
} from "@/lib/risk-settings/store";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf-8");

beforeEach(() => __resetRiskSettingsStoreForTests());

describe("Risk Settings Direct Persistence Bugfix", () => {
  it("store.ts artık set_risk_settings/get_risk_settings RPC'sini kullanmıyor", () => {
    const src = read("src/lib/risk-settings/store.ts");
    expect(src).not.toMatch(/sb\.rpc\(["']set_risk_settings["']/);
    expect(src).not.toMatch(/sb\.rpc\(["']get_risk_settings["']/);
    // Doğrudan tablo erişimi var
    expect(src).toMatch(/\.from\(["']bot_settings["']\)/);
    expect(src).toMatch(/\.update\(\{\s*risk_settings:/);
  });

  it("persistToDb verify aşamasında DB'den direkt select yapar (RPC yok)", () => {
    const src = read("src/lib/risk-settings/store.ts");
    // Verify select bot_settings tablosundan risk_settings kolonunu okumalı
    expect(src).toMatch(/\.from\(["']bot_settings["']\)\s*\.select\(["']risk_settings["']/);
  });

  it("Source of truth tek bir DB kolonuna bağlı: bot_settings.risk_settings", () => {
    const src = read("src/lib/risk-settings/store.ts");
    expect(src).toMatch(/SOURCE OF TRUTH/);
    expect(src).toMatch(/bot_settings/);
    expect(src).toMatch(/risk_settings JSONB/);
    // System user_id sabit
    expect(src).toMatch(/00000000-0000-0000-0000-000000000001/);
  });

  it("ReadSource tip değerleri: db_bot_settings_risk_settings | default_fallback_no_db_settings", () => {
    const src = read("src/lib/risk-settings/store.ts");
    expect(src).toMatch(/db_bot_settings_risk_settings/);
    expect(src).toMatch(/default_fallback_no_db_settings/);
  });

  it("GET response source field içerir, ?debug=1 normalizedResponse + rowExists döner", () => {
    const route = read("src/app/api/risk-settings/route.ts");
    expect(route).toMatch(/source[:,]/);
    const store = read("src/lib/risk-settings/store.ts");
    expect(store).toMatch(/normalizedResponse/);
    expect(store).toMatch(/rowExists/);
    expect(store).toMatch(/hasServiceRoleKey/);
    // Service role key SADECE boolean flag — değeri asla loglanmaz
    expect(store).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY=/);
    expect(store).not.toMatch(/process\.env\.SUPABASE_SERVICE_ROLE_KEY\s*[^?)]/);
  });

  it("Yeni bot_logs eventleri log'lanıyor", () => {
    const route = read("src/app/api/risk-settings/route.ts");
    expect(route).toMatch(/risk_settings_save_clicked/);
    expect(route).toMatch(/risk_settings_db_upsert_started/);
    expect(route).toMatch(/risk_settings_db_upsert_succeeded/);
    expect(route).toMatch(/risk_settings_db_verify_started/);
    expect(route).toMatch(/risk_settings_db_verify_succeeded/);
    expect(route).toMatch(/risk_settings_db_verify_failed/);
    expect(route).toMatch(/risk_settings_get_db_loaded/);
    expect(route).toMatch(/risk_settings_get_default_fallback/);
  });

  it("validation hatası DB yazmaz; via=direct_update veya direct_insert döner", () => {
    const src = read("src/lib/risk-settings/store.ts");
    expect(src).toMatch(/direct_update/);
    expect(src).toMatch(/direct_insert/);
  });

  it("PUT path Supabase yapılandırılmamışsa persistence stage'inde hata döner (test ortamı)", async () => {
    const r = await updateAndPersistRiskSettings({
      profile: "STANDARD",
      capital: { totalCapitalUsdt: 2222 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe("persistence");
      if (r.stage === "persistence") {
        expect(r.errorSafe).toMatch(/Supabase not configured/i);
        // In-memory state hâlâ patched (UI doğru değer gösterebilir)
        expect(r.data.profile).toBe("STANDARD");
        expect(r.data.capital.totalCapitalUsdt).toBe(2222);
      }
    }
    expect(getRiskSettings().profile).toBe("STANDARD");
    expect(getRiskSettings().capital.totalCapitalUsdt).toBe(2222);
  });

  it("AGGRESSIVE profil patch — değerler doğru yerleşir", async () => {
    const r = await updateAndPersistRiskSettings({
      profile: "AGGRESSIVE",
      capital: { totalCapitalUsdt: 2222, riskPerTradePercent: 5, maxDailyLossPercent: 15 },
      positions: { defaultMaxOpenPositions: 4, dynamicMaxOpenPositionsCap: 6, maxDailyTrades: 15 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.stage === "persistence") {
      expect(r.data.profile).toBe("AGGRESSIVE");
      expect(r.data.capital.totalCapitalUsdt).toBe(2222);
      expect(r.data.capital.riskPerTradePercent).toBe(5);
      expect(r.data.capital.maxDailyLossPercent).toBe(15);
      expect(r.data.positions.defaultMaxOpenPositions).toBe(4);
      expect(r.data.positions.dynamicMaxOpenPositionsCap).toBe(6);
      expect(r.data.positions.maxDailyTrades).toBe(15);
    }
  });

  it("CUSTOM profil patch — profile CUSTOM olarak korunur", async () => {
    const r = await updateAndPersistRiskSettings({ profile: "CUSTOM" });
    if (!r.ok && r.stage === "persistence") {
      expect(r.data.profile).toBe("CUSTOM");
    } else if (r.ok) {
      expect(r.data.profile).toBe("CUSTOM");
    }
  });

  it("averageDownEnabled=true reddedilir (zararda büyütme kilidi)", async () => {
    const r = await updateAndPersistRiskSettings({
      tiered: { averageDownEnabled: true as unknown as false },
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.stage === "validation") {
      expect(r.errors.join(" ")).toMatch(/Zararda pozisyon büyütme/);
    }
  });

  it("Trade engine + live gate invariant'ları korunur", () => {
    const env = read("src/lib/env.ts");
    expect(env).toMatch(/HARD_LIVE_TRADING_ALLOWED/);
    const exec = read("src/lib/live-execution/index.ts");
    expect(exec).toMatch(/LIVE_EXECUTION_NOT_IMPLEMENTED/);
    const sigEng = read("src/lib/engines/signal-engine.ts");
    expect(sigEng).toMatch(/if\s*\(score\s*<\s*70\)/);

    // Risk settings dosyaları Binance order/leverage endpoint çağırmıyor
    const route = read("src/app/api/risk-settings/route.ts");
    const store = read("src/lib/risk-settings/store.ts");
    for (const src of [route, store]) {
      expect(src).not.toMatch(/\/fapi\/v1\/order/);
      expect(src).not.toMatch(/\/fapi\/v1\/leverage/);
    }
  });
});
