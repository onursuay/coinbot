// AI Aksiyon Merkezi — Faz 5: Rollback güvenlik invariantları.
//
// Sıkı güvenlik kuralları:
//   1. confirmRollback false ise reddedilir.
//   2. Forbidden action type'lar rollback edilemez.
//   3. Hard cap kontrolü mevcut.
//   4. Binance endpoint yok (/fapi/v1/order, /fapi/v1/leverage).
//   5. HARD_LIVE_TRADING_ALLOWED=true ataması yok.
//   6. enable_live_trading=true ataması yok.
//   7. Live safety invariantları korunuyor.
//   8. SET_OBSERVATION_MODE rollback edilemez.
//   9. REQUEST_MANUAL_REVIEW rollback edilemez.
//  10. Daha önce rollback edilmiş event tekrar rollback edilemez.
//  11. Secret metadata filtreleme korunuyor.
//  12. Worker trade-open mantığına dokunulmaz.
//  13. Signal/risk engine scoring mantığına dokunulmaz.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");
function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf-8");
}

describe("rollback live safety invariantları", () => {
  const files = [
    "src/lib/ai-actions/rollback.ts",
    "src/app/api/ai-actions/rollback/route.ts",
  ];

  it.each(files)("%s: Binance private endpoint referansı yok", (file) => {
    const src = read(file);
    expect(src).not.toMatch(/\/fapi\/v1\/order/);
    expect(src).not.toMatch(/\/fapi\/v1\/leverage/);
    expect(src).not.toMatch(/\/fapi\/v1\/positionRisk/);
    expect(src).not.toMatch(/\/api\/v3\/order/);
  });

  it.each(files)("%s: HARD_LIVE_TRADING_ALLOWED=true ataması yok", (file) => {
    const src = read(file);
    expect(src).not.toMatch(/HARD_LIVE_TRADING_ALLOWED\s*=\s*true/);
  });

  it.each(files)("%s: enable_live_trading=true ataması yok", (file) => {
    const src = read(file);
    expect(src).not.toMatch(/enable_live_trading\s*=\s*true/);
  });

  it.each(files)("%s: trading_mode=live ataması yok", (file) => {
    const src = read(file);
    expect(src).not.toMatch(/trading_mode\s*=\s*['"]live['"]/);
  });

  it.each(files)("%s: openLiveOrder çağrısı yok", (file) => {
    const src = read(file);
    expect(src).not.toMatch(/openLiveOrder\s*\(/);
  });
});

describe("rollback executor güvenlik kuralları", () => {
  const exec = read("src/lib/ai-actions/rollback.ts");

  it("confirmRollback !== true anında CONFIRMATION_REQUIRED döner", () => {
    expect(exec).toMatch(/confirmRollback\s*!==\s*true/);
    expect(exec).toMatch(/CONFIRMATION_REQUIRED/);
  });

  it("FORBIDDEN_ACTION_TYPES defense-in-depth kontrolü var", () => {
    expect(exec).toMatch(/FORBIDDEN_ACTION_TYPES/);
    expect(exec).toMatch(/includes\(actionType\)/);
    expect(exec).toMatch(/ROLLBACK_NOT_ALLOWED.*Yasak/s);
  });

  it("ROLLBACK_ELIGIBLE_TYPES dışındaki tipler reddediliyor", () => {
    expect(exec).toMatch(/ROLLBACK_ELIGIBLE_TYPES.*includes\(actionType\)/s);
    expect(exec).toMatch(/Bu aksiyon tipi rollback edilemez/);
  });

  it("SET_OBSERVATION_MODE rollback kapsamında değil (check edilmiyor olmasının güvencesi: ELIGIBLE_TYPES'ta yok)", () => {
    // The eligible types list should NOT contain SET_OBSERVATION_MODE
    const eligibleBlock = exec.match(/ROLLBACK_ELIGIBLE_TYPES[\s\S]*?\] as const;/);
    if (eligibleBlock) {
      expect(eligibleBlock[0]).not.toMatch(/SET_OBSERVATION_MODE/);
    }
  });

  it("state mismatch kontrolü mevcut (mevcut değer event.newValue ile karşılaştırılıyor)", () => {
    expect(exec).toMatch(/ROLLBACK_STATE_MISMATCH/);
    expect(exec).toMatch(/Math\.abs\(currentNumericValue\s*-\s*eventNewNumeric\)/);
  });

  it("zaten rollback edilmiş event kontrolü mevcut", () => {
    expect(exec).toMatch(/ai_action_rollback_applied/);
    expect(exec).toMatch(/rollbackOfEventId/);
    expect(exec).toMatch(/alreadyRolledBack/);
  });

  it("hard cap aşıldığında HARD_CAP_EXCEEDED döner", () => {
    expect(exec).toMatch(/HARD_CAP_EXCEEDED/);
    expect(exec).toMatch(/ROLLBACK_HARD_CAPS/);
    expect(exec).toMatch(/rollbackToNumeric\s*>\s*hardCap/);
  });

  it("updateAndPersistRiskSettings kullanıyor (RPC yok, direct DB)", () => {
    expect(exec).toMatch(/updateAndPersistRiskSettings\(/);
    expect(exec).not.toMatch(/rpc\s*\(/);
  });

  it("ROLLBACK_PERSISTENCE_FAILED başarısız persistens durumunu ele alıyor", () => {
    expect(exec).toMatch(/ROLLBACK_PERSISTENCE_FAILED/);
    expect(exec).toMatch(/persistResult\.ok/);
  });
});

describe("rollback kapsamı ve sınırları", () => {
  const exec = read("src/lib/ai-actions/rollback.ts");
  const types = read("src/lib/ai-actions/types.ts");

  it("ROLLBACK_ELIGIBLE_TYPES yalnızca 4 downward tipi kapsar", () => {
    const section = types.match(/ROLLBACK_ELIGIBLE_TYPES[\s\S]*?\] as const;/);
    expect(section).not.toBeNull();
    if (section) {
      const txt = section[0];
      expect(txt).toMatch(/UPDATE_RISK_PER_TRADE_DOWN/);
      expect(txt).toMatch(/UPDATE_MAX_DAILY_LOSS_DOWN/);
      expect(txt).toMatch(/UPDATE_MAX_OPEN_POSITIONS_DOWN/);
      expect(txt).toMatch(/UPDATE_MAX_DAILY_TRADES_DOWN/);
      // Non-eligible types absent
      expect(txt).not.toMatch(/SET_OBSERVATION_MODE/);
      expect(txt).not.toMatch(/REQUEST_MANUAL_REVIEW/);
      expect(txt).not.toMatch(/CREATE_IMPLEMENTATION_PROMPT/);
    }
  });

  it("FORBIDDEN_ACTION_TYPES'taki tipler ROLLBACK_ELIGIBLE_TYPES'ta yok", () => {
    const forbidden = [
      "ENABLE_LIVE_TRADING",
      "DISABLE_HARD_LIVE_GATE",
      "PLACE_BINANCE_ORDER",
      "MODIFY_BINANCE_LEVERAGE",
      "INCREASE_LEVERAGE",
      "INCREASE_RISK_PER_TRADE",
      "INCREASE_MAX_DAILY_LOSS",
      "INCREASE_MAX_OPEN_POSITIONS",
      "INCREASE_MAX_DAILY_TRADES",
      "ENABLE_PAPER_LEARNING_BYPASS",
      "ENABLE_FORCE_PAPER_ENTRY",
      "ENABLE_AGGRESSIVE_PAPER",
      "MODIFY_SL_TP_ALGORITHM",
      "LOWER_MIN_SIGNAL_CONFIDENCE",
      "DISABLE_BTC_TREND_FILTER",
    ];
    const section = types.match(/ROLLBACK_ELIGIBLE_TYPES[\s\S]*?\] as const;/);
    if (section) {
      for (const ft of forbidden) {
        expect(section[0]).not.toMatch(new RegExp(ft));
      }
    }
  });

  it("executor yalnızca risk_settings alanını değiştiriyor (bot_settings.risk_settings)", () => {
    // Rollback should only touch risk settings fields, not trading_mode or leverage gates
    expect(exec).toMatch(/capital:\s*\{/);
    expect(exec).not.toMatch(/trading_mode/);
    expect(exec).not.toMatch(/enable_live_trading/);
    expect(exec).not.toMatch(/hardLiveTradingAllowed/);
  });

  it("leverage execution değiştirmiyor (config-only kaldıraç dokunulmaz)", () => {
    expect(exec).not.toMatch(/leverage\s*:\s*\{/);
    expect(exec).not.toMatch(/SYSTEM_HARD_LEVERAGE_CAP/);
  });
});

describe("rollback history güvenliği", () => {
  const history = read("src/lib/ai-actions/history.ts");

  it("sanitizeMetadata hâlâ mevcut (secret filtreleme korunuyor)", () => {
    expect(history).toMatch(/sanitizeMetadata/);
    expect(history).toMatch(/SECRET_KEY_PATTERNS/);
    expect(history).toMatch(/REDACTED/);
  });

  it("rollback eventleri AI_ACTION_EVENT_TYPES içinde (history endpoint döndürür)", () => {
    expect(history).toMatch(/ai_action_rollback_requested/);
    expect(history).toMatch(/ai_action_rollback_blocked/);
    expect(history).toMatch(/ai_action_rollback_applied/);
    expect(history).toMatch(/ai_action_rollback_failed/);
  });
});

describe("worker + engine dokunulmadı", () => {
  it("bot-orchestrator değişmedi (rollback dosyalarında referans yok)", () => {
    const rollback = read("src/lib/ai-actions/rollback.ts");
    const route = read("src/app/api/ai-actions/rollback/route.ts");
    expect(rollback).not.toMatch(/bot-orchestrator/);
    expect(route).not.toMatch(/bot-orchestrator/);
  });

  it("signal-engine değişmedi (rollback dosyalarında referans yok)", () => {
    const rollback = read("src/lib/ai-actions/rollback.ts");
    expect(rollback).not.toMatch(/signal-engine/);
    expect(rollback).not.toMatch(/setupScore/);
    expect(rollback).not.toMatch(/MIN_SIGNAL_CONFIDENCE/);
  });

  it("risk-engine scoring değişmedi (rollback dosyalarında referans yok)", () => {
    const rollback = read("src/lib/ai-actions/rollback.ts");
    expect(rollback).not.toMatch(/risk-engine/);
    expect(rollback).not.toMatch(/calculateRisk/);
  });
});
