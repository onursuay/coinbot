// AI Aksiyon Merkezi — Faz 2: route + UI safety invariants.
//
// Bu test source code seviyesinde "yasak pattern" araması yapar. Amaç:
//   • /api/ai-actions endpoint'i okuma dışında bir mutation yapmaz.
//   • /fapi/v1/order veya /fapi/v1/leverage referansı eklenmemiştir.
//   • UI "Uygula" butonu aktif (enabled) olarak render edilmez.

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");

function read(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), "utf-8");
}

describe("ai-actions/route — safety invariants", () => {
  const route = read("src/app/api/ai-actions/route.ts");

  it("Binance private endpoint referansı yok", () => {
    expect(route).not.toMatch(/\/fapi\/v1\/order/);
    expect(route).not.toMatch(/\/fapi\/v1\/leverage/);
  });

  it("DB write yapmaz: insert/update/upsert/delete çağrısı yok", () => {
    // Yalnızca .select() okuma izinli. Mutation çağrıları source'da geçmemeli.
    expect(route).not.toMatch(/\.insert\s*\(/);
    expect(route).not.toMatch(/\.update\s*\(/);
    expect(route).not.toMatch(/\.upsert\s*\(/);
    expect(route).not.toMatch(/\.delete\s*\(/);
    expect(route).not.toMatch(/\.rpc\s*\(\s*['"`]set_/);
  });

  it("HARD_LIVE_TRADING_ALLOWED veya enable_live_trading mutation yok", () => {
    expect(route).not.toMatch(/HARD_LIVE_TRADING_ALLOWED\s*=\s*true/);
    expect(route).not.toMatch(/enable_live_trading\s*=\s*true/);
    expect(route).not.toMatch(/trading_mode\s*=\s*['"]live['"]/);
  });

  it("yalnızca GET handler export eder", () => {
    expect(route).toMatch(/export\s+async\s+function\s+GET\s*\(/);
    expect(route).not.toMatch(/export\s+async\s+function\s+POST\s*\(/);
    expect(route).not.toMatch(/export\s+async\s+function\s+PUT\s*\(/);
    expect(route).not.toMatch(/export\s+async\s+function\s+PATCH\s*\(/);
    expect(route).not.toMatch(/export\s+async\s+function\s+DELETE\s*\(/);
  });
});

describe("ai-actions/page — UI safety invariants (Faz 3)", () => {
  const page = read("src/app/ai-actions/page.tsx");

  it("Apply butonu APPLICABLE_TYPES için aktif, diğer tipler için disabled", () => {
    expect(page).toMatch(/APPLICABLE_TYPES/);
    expect(page).toMatch(/Sadece İnceleme/);
    expect(page).toMatch(/Engelli/);
  });

  it("ikinci onay modalı zorunlu (confirmApply: true literal)", () => {
    expect(page).toMatch(/confirmApply:\s*true/);
  });

  it("Binance private endpoint referansı yok", () => {
    expect(page).not.toMatch(/\/fapi\/v1\/order/);
    expect(page).not.toMatch(/\/fapi\/v1\/leverage/);
  });

  it("HARD_LIVE_TRADING_ALLOWED=true ataması yok", () => {
    expect(page).not.toMatch(/HARD_LIVE_TRADING_ALLOWED\s*=\s*true/);
  });
});

describe("ai-actions/generator — safety invariants", () => {
  const gen = read("src/lib/ai-actions/generator.ts");

  it("yasak action type literal'leri kod gövdesinde geçmez", () => {
    // FORBIDDEN_ACTION_TYPES içindeki değerler generator gövdesinde
    // type literal olarak geçmemeli — yalnızca types.ts'deki listede tanımlı.
    expect(gen).not.toMatch(/"ENABLE_LIVE_TRADING"/);
    expect(gen).not.toMatch(/"PLACE_BINANCE_ORDER"/);
    expect(gen).not.toMatch(/"INCREASE_LEVERAGE"/);
    expect(gen).not.toMatch(/"INCREASE_RISK_PER_TRADE"/);
    expect(gen).not.toMatch(/"LOWER_MIN_SIGNAL_CONFIDENCE"/);
    expect(gen).not.toMatch(/"DISABLE_BTC_TREND_FILTER"/);
  });

  it("Binance API path referansı yok", () => {
    expect(gen).not.toMatch(/\/fapi\/v1\//);
  });
});

describe("ai-actions/prompt-builder — safety invariants", () => {
  const pb = read("src/lib/ai-actions/prompt-builder.ts");

  it("üretilen prompt güvenlik başlığı içerir", () => {
    expect(pb).toMatch(/HARD_LIVE_TRADING_ALLOWED=false korunmalı/);
    expect(pb).toMatch(/DEFAULT_TRADING_MODE=paper korunmalı/);
    expect(pb).toMatch(/MIN_SIGNAL_CONFIDENCE=70 düşürülmemeli/);
    expect(pb).toMatch(/BTC trend filtresi kapatılmamalı/);
  });

  it("prompt body'sinde live trading açma talimatı yok", () => {
    expect(pb).not.toMatch(/enable.*live_trading\s*=\s*true/i);
    expect(pb).not.toMatch(/HARD_LIVE_TRADING_ALLOWED\s*=\s*true/);
  });
});
