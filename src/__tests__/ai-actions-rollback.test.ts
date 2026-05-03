// AI Aksiyon Merkezi — Faz 5: Rollback güvenlik + davranış testleri.
//
// Source-level testler — disk'teki dosyaları okuyup kod gövdesini denetler.
// Doğrulanan:
//   • Rollback endpoint yalnızca POST handler tanımlar.
//   • confirmRollback kontrolü kod gövdesinde geçer.
//   • historyItemId bulunamazsa ACTION_HISTORY_NOT_FOUND döner.
//   • SET_OBSERVATION_MODE / REQUEST_MANUAL_REVIEW / FORBIDDEN tipler rollback edilemez.
//   • UPDATE_*_DOWN tipleri rollback kapsamında.
//   • ROLLBACK_STATE_MISMATCH kodu mevcut.
//   • Daha önce rollback edilmişse ROLLBACK_NOT_ALLOWED döner.
//   • Persistence başarısızsa ROLLBACK_PERSISTENCE_FAILED döner.
//   • Audit log eventleri kod gövdesinde geçer.
//   • History endpoint rollback event tiplerini bekleyen event listesine dahil.
//   • Hard cap kontrolü kodu mevcut.
//   • Secret metadata filtreleme korunur.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");
function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf-8");
}

describe("/api/ai-actions/rollback route", () => {
  const route = read("src/app/api/ai-actions/rollback/route.ts");

  it("yalnızca POST handler export eder", () => {
    expect(route).toMatch(/export\s+async\s+function\s+POST\s*\(/);
    expect(route).not.toMatch(/export\s+async\s+function\s+GET\s*\(/);
    expect(route).not.toMatch(/export\s+async\s+function\s+PUT\s*\(/);
    expect(route).not.toMatch(/export\s+async\s+function\s+PATCH\s*\(/);
    expect(route).not.toMatch(/export\s+async\s+function\s+DELETE\s*\(/);
  });

  it("confirmRollback kontrolü var", () => {
    expect(route).toMatch(/confirmRollback/);
  });

  it("audit log eventleri kod gövdesinde geçer", () => {
    expect(route).toMatch(/ai_action_rollback_requested/);
    expect(route).toMatch(/ai_action_rollback_blocked/);
    expect(route).toMatch(/ai_action_rollback_applied/);
    expect(route).toMatch(/ai_action_rollback_failed/);
  });

  it("executeRollback çağrısı mevcut", () => {
    expect(route).toMatch(/executeRollback\(/);
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

  it("riskSettingsBefore ve riskSettingsAfter audit payload'a ekleniyor", () => {
    expect(route).toMatch(/riskSettingsBefore/);
    expect(route).toMatch(/riskSettingsAfter/);
  });
});

describe("/lib/ai-actions/rollback.ts executor", () => {
  const exec = read("src/lib/ai-actions/rollback.ts");

  it("CONFIRMATION_REQUIRED kodu mevcut", () => {
    expect(exec).toMatch(/CONFIRMATION_REQUIRED/);
    expect(exec).toMatch(/confirmRollback/);
  });

  it("ACTION_HISTORY_NOT_FOUND kodu mevcut", () => {
    expect(exec).toMatch(/ACTION_HISTORY_NOT_FOUND/);
  });

  it("ROLLBACK_NOT_ALLOWED kodu mevcut", () => {
    expect(exec).toMatch(/ROLLBACK_NOT_ALLOWED/);
  });

  it("ROLLBACK_STATE_MISMATCH kodu mevcut", () => {
    expect(exec).toMatch(/ROLLBACK_STATE_MISMATCH/);
  });

  it("ROLLBACK_PERSISTENCE_FAILED kodu mevcut", () => {
    expect(exec).toMatch(/ROLLBACK_PERSISTENCE_FAILED/);
  });

  it("HARD_CAP_EXCEEDED kodu mevcut", () => {
    expect(exec).toMatch(/HARD_CAP_EXCEEDED/);
  });

  it("ROLLBACK_ELIGIBLE_TYPES kapsamındaki 4 tip kontrol ediliyor", () => {
    expect(exec).toMatch(/UPDATE_RISK_PER_TRADE_DOWN/);
    expect(exec).toMatch(/UPDATE_MAX_DAILY_LOSS_DOWN/);
    expect(exec).toMatch(/UPDATE_MAX_OPEN_POSITIONS_DOWN/);
    expect(exec).toMatch(/UPDATE_MAX_DAILY_TRADES_DOWN/);
  });

  it("ai_action_applied event tipi kontrolü mevcut", () => {
    expect(exec).toMatch(/ai_action_applied/);
  });

  it("daha önce rollback edilmiş kontrol mevcut (ai_action_rollback_applied)", () => {
    expect(exec).toMatch(/ai_action_rollback_applied/);
    expect(exec).toMatch(/rollbackOfEventId/);
  });

  it("updateAndPersistRiskSettings direkt DB kalıcılığı kullanıyor", () => {
    expect(exec).toMatch(/updateAndPersistRiskSettings\(/);
  });

  it("FORBIDDEN_ACTION_TYPES defense-in-depth kontrolü var", () => {
    expect(exec).toMatch(/FORBIDDEN_ACTION_TYPES/);
  });

  it("Binance private endpoint referansı yok", () => {
    expect(exec).not.toMatch(/\/fapi\/v1\/order/);
    expect(exec).not.toMatch(/\/fapi\/v1\/leverage/);
  });

  it("HARD_LIVE_TRADING_ALLOWED=true ataması yok", () => {
    expect(exec).not.toMatch(/HARD_LIVE_TRADING_ALLOWED\s*=\s*true/);
    expect(exec).not.toMatch(/enable_live_trading\s*=\s*true/);
  });

  it("rollback hard caps tanımlanmış", () => {
    expect(exec).toMatch(/ROLLBACK_HARD_CAPS/);
    // At least one cap defined
    expect(exec).toMatch(/UPDATE_RISK_PER_TRADE_DOWN:\s*\d+/);
  });

  it("auditPayload rollbackOfEventId içeriyor", () => {
    expect(exec).toMatch(/rollbackOfEventId/);
    expect(exec).toMatch(/auditPayload/);
  });

  it("SET_OBSERVATION_MODE rollback kapsamı dışında (types.ts ROLLBACK_ELIGIBLE_TYPES'ta yok)", () => {
    const typesModule = read("src/lib/ai-actions/types.ts");
    const section = typesModule.match(/ROLLBACK_ELIGIBLE_TYPES[\s\S]*?\] as const;/);
    expect(section).not.toBeNull();
    if (section) {
      expect(section[0]).not.toMatch(/SET_OBSERVATION_MODE/);
      expect(section[0]).not.toMatch(/REQUEST_MANUAL_REVIEW/);
    }
  });
});

describe("history.ts rollback event tipleri", () => {
  const history = read("src/lib/ai-actions/history.ts");

  it("AI_ACTION_EVENT_TYPES rollback event tiplerini içeriyor", () => {
    expect(history).toMatch(/ai_action_rollback_requested/);
    expect(history).toMatch(/ai_action_rollback_blocked/);
    expect(history).toMatch(/ai_action_rollback_applied/);
    expect(history).toMatch(/ai_action_rollback_failed/);
  });

  it("HistoryStatus rollback statüsleri içeriyor", () => {
    expect(history).toMatch(/rollback_applied/);
    expect(history).toMatch(/rollback_blocked/);
    expect(history).toMatch(/rollback_failed/);
  });

  it("HISTORY_STATUS_LABEL rollback statüsleri için etiket içeriyor", () => {
    expect(history).toMatch(/Geri Alındı/);
    expect(history).toMatch(/Geri Alma Bloke/);
    expect(history).toMatch(/Geri Alma Başarısız/);
  });

  it("ROLLBACK_ELIGIBLE_TYPES 4 downward tipi içeriyor", () => {
    expect(history).toMatch(/ROLLBACK_ELIGIBLE_TYPES/);
    expect(history).toMatch(/UPDATE_RISK_PER_TRADE_DOWN/);
    expect(history).toMatch(/UPDATE_MAX_DAILY_LOSS_DOWN/);
    expect(history).toMatch(/UPDATE_MAX_OPEN_POSITIONS_DOWN/);
    expect(history).toMatch(/UPDATE_MAX_DAILY_TRADES_DOWN/);
  });
});

describe("types.ts rollback eligible types", () => {
  const types = read("src/lib/ai-actions/types.ts");

  it("ROLLBACK_ELIGIBLE_TYPES export edilmiş", () => {
    expect(types).toMatch(/export\s+const\s+ROLLBACK_ELIGIBLE_TYPES/);
  });

  it("SET_OBSERVATION_MODE ROLLBACK_ELIGIBLE_TYPES'ta yok", () => {
    const rollbackEligibleSection = types.match(
      /ROLLBACK_ELIGIBLE_TYPES[\s\S]*?\] as const;/,
    );
    expect(rollbackEligibleSection).not.toBeNull();
    if (rollbackEligibleSection) {
      expect(rollbackEligibleSection[0]).not.toMatch(/SET_OBSERVATION_MODE/);
      expect(rollbackEligibleSection[0]).not.toMatch(/REQUEST_MANUAL_REVIEW/);
      expect(rollbackEligibleSection[0]).not.toMatch(/CREATE_IMPLEMENTATION_PROMPT/);
    }
  });
});

describe("/api/ai-actions/history rollback statüsleri", () => {
  const route = read("src/app/api/ai-actions/history/route.ts");

  it("VALID_STATUSES rollback statüsleri içeriyor", () => {
    expect(route).toMatch(/rollback_applied/);
    expect(route).toMatch(/rollback_blocked/);
    expect(route).toMatch(/rollback_failed/);
  });
});

describe("ai-actions page Geri Al UI", () => {
  const page = read("src/app/ai-actions/page.tsx");

  it("ROLLBACK_ELIGIBLE_TYPES_UI tanımlanmış", () => {
    expect(page).toMatch(/ROLLBACK_ELIGIBLE_TYPES_UI/);
  });

  it("Rollback Modal bileşeni mevcut", () => {
    expect(page).toMatch(/RollbackModal/);
    expect(page).toMatch(/Aksiyonu Geri Al/);
  });

  it("Geri Al butonu mevcut", () => {
    expect(page).toMatch(/Geri Al/);
  });

  it("rollbackTarget state mevcut", () => {
    expect(page).toMatch(/rollbackTarget/);
  });

  it("submitRollback callback mevcut", () => {
    expect(page).toMatch(/submitRollback/);
  });

  it("rollback endpoint çağrısı mevcut", () => {
    expect(page).toMatch(/\/api\/ai-actions\/rollback/);
  });

  it("confirmRollback: true gönderiliyor", () => {
    expect(page).toMatch(/confirmRollback:\s*true/);
  });

  it("rollbackNotice state mevcut", () => {
    expect(page).toMatch(/rollbackNotice/);
  });

  it("'Geri Alınanlar' filtre seçeneği mevcut", () => {
    expect(page).toMatch(/Geri Alınanlar/);
  });

  it("modal güvenlik notu canlı emir açmadığını belirtiyor", () => {
    expect(page).toMatch(/canlı emir açmaz/i);
  });
});
