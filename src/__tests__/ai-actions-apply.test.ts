// AI Aksiyon Merkezi — Faz 3: apply endpoint + UI safety invariants.
//
// Source-level testler. Build sonucu disk'e yazılan dosyaları okur.
// Doğrulanan:
//   • POST /api/ai-actions/apply yalnızca POST handler tanımlar.
//   • Binance private endpoint (/fapi/v1/order, /fapi/v1/leverage) yok.
//   • HARD_LIVE_TRADING_ALLOWED=true ataması yok.
//   • Audit log eventleri kod gövdesinde geçer.
//   • UI Apply butonu APPLICABLE_TYPES için aktif, diğerleri için disabled.
//   • Modal ikinci onay olmadan apply çağırmaz (confirmApply: true literal).

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");
function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf-8");
}

describe("/api/ai-actions/apply route safety", () => {
  const route = read("src/app/api/ai-actions/apply/route.ts");

  it("yalnızca POST handler export eder", () => {
    expect(route).toMatch(/export\s+async\s+function\s+POST\s*\(/);
    expect(route).not.toMatch(/export\s+async\s+function\s+GET\s*\(/);
    expect(route).not.toMatch(/export\s+async\s+function\s+PUT\s*\(/);
    expect(route).not.toMatch(/export\s+async\s+function\s+PATCH\s*\(/);
    expect(route).not.toMatch(/export\s+async\s+function\s+DELETE\s*\(/);
  });

  it("Binance private endpoint referansı yok", () => {
    expect(route).not.toMatch(/\/fapi\/v1\/order/);
    expect(route).not.toMatch(/\/fapi\/v1\/leverage/);
  });

  it("HARD_LIVE_TRADING_ALLOWED=true veya enable_live_trading=true ataması yok", () => {
    expect(route).not.toMatch(/HARD_LIVE_TRADING_ALLOWED\s*=\s*true/);
    expect(route).not.toMatch(/enable_live_trading\s*=\s*true/);
    expect(route).not.toMatch(/trading_mode\s*=\s*['"]live['"]/);
  });

  it("audit log eventleri kod gövdesinde geçer", () => {
    expect(route).toMatch(/ai_action_apply_requested/);
    expect(route).toMatch(/ai_action_apply_blocked/);
    expect(route).toMatch(/ai_action_applied/);
    expect(route).toMatch(/ai_action_apply_failed/);
    expect(route).toMatch(/ai_action_observation_set/);
  });

  it("apply yalnızca executor üzerinden ilerler (UI'dan gelen değere kör güvenmez)", () => {
    expect(route).toMatch(/executeAction\(/);
  });
});

describe("/lib/ai-actions/executor.ts safety", () => {
  const exec = read("src/lib/ai-actions/executor.ts");

  it("FORBIDDEN_ACTION_TYPES check kodu içerir", () => {
    expect(exec).toMatch(/FORBIDDEN_ACTION_TYPES/);
    expect(exec).toMatch(/FORBIDDEN_ACTION/);
  });

  it("APPLICABLE_ACTION_TYPES whitelist olarak tanımlı (sadece downward + observation)", () => {
    expect(exec).toMatch(/APPLICABLE_ACTION_TYPES/);
    expect(exec).toMatch(/UPDATE_RISK_PER_TRADE_DOWN/);
    expect(exec).toMatch(/UPDATE_MAX_DAILY_LOSS_DOWN/);
    expect(exec).toMatch(/UPDATE_MAX_OPEN_POSITIONS_DOWN/);
    expect(exec).toMatch(/UPDATE_MAX_DAILY_TRADES_DOWN/);
    expect(exec).toMatch(/SET_OBSERVATION_MODE/);
  });

  it("Binance private endpoint referansı yok", () => {
    expect(exec).not.toMatch(/\/fapi\/v1\/order/);
    expect(exec).not.toMatch(/\/fapi\/v1\/leverage/);
  });

  it("HARD_LIVE_TRADING_ALLOWED=true ataması yok", () => {
    expect(exec).not.toMatch(/HARD_LIVE_TRADING_ALLOWED\s*=\s*true/);
  });

  it("server-side plan re-validation (buildAIActionsResult) çağrılır", () => {
    expect(exec).toMatch(/buildAIActionsResult\(/);
  });

  it("recommendedValue plan ile karşılaştırılır (PLAN_VALUE_MISMATCH)", () => {
    expect(exec).toMatch(/PLAN_VALUE_MISMATCH/);
    expect(exec).toMatch(/recommendedValue/);
  });

  it("downward guard — NOT_A_DOWNWARD_CHANGE", () => {
    expect(exec).toMatch(/NOT_A_DOWNWARD_CHANGE/);
    // newValue < currentValue check
    expect(exec).toMatch(/newValue\s*<\s*currentValue/);
  });

  it("SET_OBSERVATION_MODE risk settings'e dokunmaz", () => {
    // Audit-only branch: updateAndPersistRiskSettings çağrısı bu branch'te
    // yapılmamalı. Kod observed döndüren kısa-devre içermeli.
    expect(exec).toMatch(/SET_OBSERVATION_MODE[\s\S]*observed/);
  });

  it("CONFIRMATION_REQUIRED guard ilk kontrol", () => {
    expect(exec).toMatch(/CONFIRMATION_REQUIRED/);
    expect(exec).toMatch(/confirmApply\s*!==\s*true/);
  });
});

describe("/ai-actions UI — Apply button + modal safety", () => {
  const page = read("src/app/ai-actions/page.tsx");

  it("APPLICABLE_TYPES tanımı UI'da var", () => {
    expect(page).toMatch(/APPLICABLE_TYPES/);
    expect(page).toMatch(/UPDATE_RISK_PER_TRADE_DOWN/);
    expect(page).toMatch(/SET_OBSERVATION_MODE/);
  });

  it("Apply butonu uygulanamaz tipler için disabled gösterir", () => {
    expect(page).toMatch(/Sadece İnceleme/);
    expect(page).toMatch(/Engelli/);
    expect(page).toMatch(/applyBtnDisabled/);
  });

  it("modal apply çağrısı confirmApply: true literal'i ile yapar", () => {
    expect(page).toMatch(/confirmApply:\s*true/);
  });

  it("modal güvenlik notu içerir", () => {
    expect(page).toMatch(/canlı emir açmaz/i);
  });

  it("modal Vazgeç ve Onayla ve Uygula butonlarını içerir", () => {
    expect(page).toMatch(/Vazgeç/);
    expect(page).toMatch(/Onayla ve Uygula/);
  });

  it("apply endpoint /api/ai-actions/apply'a POST eder", () => {
    expect(page).toMatch(/\/api\/ai-actions\/apply/);
    expect(page).toMatch(/method:\s*["']POST["']/);
  });

  it("UI doğrudan Binance veya live trading endpoint çağırmaz", () => {
    expect(page).not.toMatch(/\/fapi\/v1\/order/);
    expect(page).not.toMatch(/\/fapi\/v1\/leverage/);
    expect(page).not.toMatch(/HARD_LIVE_TRADING_ALLOWED\s*=\s*true/);
  });

  it("Pozisyon limiti modalı açık pozisyonların zorla kapatılmadığını belirtir", () => {
    expect(page).toMatch(/zorla kapat/i);
  });
});
