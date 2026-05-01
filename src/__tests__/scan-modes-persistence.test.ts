// Scan Modes Persistence Patch — kalıcılık testleri.
//
// Bu testler:
// - bot_settings.scan_modes_config migration'ının var olduğunu doğrular.
// - Store + route + orchestrator hydrate/persist hat kontrol noktalarını
//   kaynak seviyesinde sınar.
// - In-memory fallback davranışını (Supabase yapılandırılmamışken) test eder.
// - Manuel İzleme Listesi'nin pasif edilince symbols korunduğunu doğrular
//   (önceki ürün kuralı korundu).
// - Trading invariant'lerinin (MIN_SIGNAL_CONFIDENCE=70, hard live gate
//   kapalı, yeni Binance order/leverage endpoint yok) korunduğunu kanıtlar.

import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  getScanModesConfig,
  updateScanModesConfig,
  addManualSymbol,
  removeManualSymbol,
  ensureScanModesHydrated,
  __resetScanModesStoreForTests,
} from "@/lib/scan-modes/store";
import { DEFAULT_SCAN_MODES_CONFIG } from "@/lib/scan-modes/types";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

beforeEach(() => __resetScanModesStoreForTests());

// ── 1. Migration ───────────────────────────────────────────────────────
describe("Scan Modes Persistence — migration", () => {
  it("0013_scan_modes_persistence.sql var ve scan_modes_config JSONB ekliyor", () => {
    const sql = read("supabase/migrations/0013_scan_modes_persistence.sql");
    expect(sql).toMatch(/ALTER\s+TABLE\s+bot_settings/i);
    expect(sql).toMatch(/scan_modes_config\s+JSONB/i);
    expect(sql).toMatch(/IF\s+NOT\s+EXISTS/i);
  });
});

// ── 2. Store API yüzeyi ───────────────────────────────────────────────
describe("Scan Modes Persistence — store API", () => {
  it("ensureScanModesHydrated export edildi", () => {
    expect(typeof ensureScanModesHydrated).toBe("function");
  });

  it("ensureScanModesHydrated() Supabase yapılandırılmamışken bile çözümlenir (fallback)", async () => {
    // Test ortamında supabaseConfigured() false; hydrate fonksiyonu hata
    // fırlatmadan default config ile çalışmaya devam etmeli.
    await expect(ensureScanModesHydrated()).resolves.toBeUndefined();
    expect(getScanModesConfig()).toEqual(DEFAULT_SCAN_MODES_CONFIG);
  });

  it("hydrate idempotent — ikinci çağrı no-op", async () => {
    await ensureScanModesHydrated();
    await ensureScanModesHydrated();
    expect(getScanModesConfig()).toEqual(DEFAULT_SCAN_MODES_CONFIG);
  });
});

// ── 3. Manuel İzleme Listesi pasif edilince semboller korunur ─────────
describe("Scan Modes Persistence — Manuel Liste pasif/aktif semantiği", () => {
  it("manualList passive yapılınca symbols silinmez (ürün kuralı korundu)", () => {
    addManualSymbol("BTC/USDT");
    addManualSymbol("ETH/USDT");
    let cfg = updateScanModesConfig({ manualList: { active: true } });
    expect(cfg.manualList.symbols).toEqual(["BTC/USDT", "ETH/USDT"]);

    cfg = updateScanModesConfig({ manualList: { active: false } });
    expect(cfg.manualList.active).toBe(false);
    expect(cfg.manualList.symbols).toEqual(["BTC/USDT", "ETH/USDT"]);
  });

  it("wideMarket / momentum toggle bağımsız kaydedilir", () => {
    let cfg = updateScanModesConfig({ wideMarket: { active: false } });
    expect(cfg.wideMarket.active).toBe(false);
    expect(cfg.momentum.active).toBe(true);
    cfg = updateScanModesConfig({ momentum: { active: false } });
    expect(cfg.wideMarket.active).toBe(false);
    expect(cfg.momentum.active).toBe(false);
  });

  it("addManualSymbol / removeManualSymbol mevcut symbols'u doğru günceller", () => {
    addManualSymbol("SOL/USDT");
    addManualSymbol("BTC/USDT");
    expect(getScanModesConfig().manualList.symbols).toEqual(["SOL/USDT", "BTC/USDT"]);
    removeManualSymbol("SOL/USDT");
    expect(getScanModesConfig().manualList.symbols).toEqual(["BTC/USDT"]);
  });
});

// ── 4. Route handlers hydrate ediyor ──────────────────────────────────
describe("Scan Modes Persistence — route handlers hydrate ediyor", () => {
  const SCAN_MODES_ROUTE = read("src/app/api/scan-modes/route.ts");
  const MANUAL_LIST_ROUTE = read("src/app/api/scan-modes/manual-list/route.ts");
  const SNAPSHOT_ROUTE = read("src/app/api/candidate-pool/snapshot/route.ts");

  it("/api/scan-modes route handlers ensureScanModesHydrated() çağırıyor", () => {
    expect(SCAN_MODES_ROUTE).toMatch(/ensureScanModesHydrated/);
    // GET ve PUT akışlarının ikisi de hydrate hattını içeriyor.
    const occurrences = (SCAN_MODES_ROUTE.match(/ensureScanModesHydrated\(\)/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("/api/scan-modes/manual-list route ensureScanModesHydrated() çağırıyor", () => {
    expect(MANUAL_LIST_ROUTE).toMatch(/ensureScanModesHydrated/);
  });

  it("candidate-pool snapshot route hydrate ediyor", () => {
    expect(SNAPSHOT_ROUTE).toMatch(/ensureScanModesHydrated/);
  });

  it("DB hatası UI'yı kırmaz — JSON hata cevabı döner", () => {
    // try/catch ile sarılı olmalı ve fail() çağrısı içermeli.
    expect(SCAN_MODES_ROUTE).toMatch(/try\s*{/);
    expect(SCAN_MODES_ROUTE).toMatch(/fail\(/);
    expect(MANUAL_LIST_ROUTE).toMatch(/fail\(/);
  });
});

// ── 5. Worker / orchestrator persistent config'i okuyor ───────────────
describe("Scan Modes Persistence — worker uyumu", () => {
  const ORCHESTRATOR = read("src/lib/engines/bot-orchestrator.ts");
  const UCP = read("src/lib/engines/unified-candidate-provider.ts");

  it("bot-orchestrator tick içinde ensureScanModesHydrated çağırıyor", () => {
    expect(ORCHESTRATOR).toMatch(/ensureScanModesHydrated/);
  });

  it("unified-candidate-provider scanModes okumadan önce hydrate ediyor", () => {
    expect(UCP).toMatch(/ensureScanModesHydrated/);
    // Hydrate çağrısı getScanModesConfig'ten önce gelmeli (override yoksa).
    const idxHydrate = UCP.indexOf("ensureScanModesHydrated");
    const idxRead = UCP.indexOf("getScanModesConfig()");
    expect(idxHydrate).toBeGreaterThan(0);
    expect(idxRead).toBeGreaterThan(idxHydrate);
  });
});

// ── 6. Trading invariant'leri korundu ─────────────────────────────────
describe("Scan Modes Persistence — invariant'ler korundu", () => {
  it("signal-engine eşik 70 hâlâ kilitli", () => {
    const src = read("src/lib/engines/signal-engine.ts");
    expect(src).toMatch(/aggressiveMinScore\s*\?\?\s*70/);
  });

  it("env defaults: hard live trading off, paper default", () => {
    const src = read("src/lib/env.ts");
    expect(src).toMatch(/hardLiveTradingAllowed:\s*bool\(process\.env\.HARD_LIVE_TRADING_ALLOWED,\s*false\)/);
    expect(src).toMatch(/defaultTradingMode:\s*str\(process\.env\.DEFAULT_TRADING_MODE,\s*"paper"\)/);
  });

  it("settings/update endpoint enable_live_trading kabul etmiyor", () => {
    const src = read("src/app/api/settings/update/route.ts");
    expect(src).not.toMatch(/enable_live_trading/);
  });

  it("scan-modes route veya store dosyalarında /fapi/v1/order veya /fapi/v1/leverage YOK", () => {
    const files = [
      "src/lib/scan-modes/store.ts",
      "src/app/api/scan-modes/route.ts",
      "src/app/api/scan-modes/manual-list/route.ts",
    ].map(read);
    for (const src of files) {
      expect(src).not.toMatch(/\/fapi\/v1\/order/);
      expect(src).not.toMatch(/\/fapi\/v1\/leverage/);
    }
  });

  it("openLiveOrder hâlâ LIVE_EXECUTION_NOT_IMPLEMENTED döndürür", () => {
    const adapter = read("src/lib/live-execution/adapter.ts");
    expect(adapter).toMatch(/LIVE_EXECUTION_NOT_IMPLEMENTED/);
  });
});
