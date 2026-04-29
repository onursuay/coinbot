// Phase 10 — Risk Yönetimi sayfası ve güvenli config altyapısı testleri.
//
// Bu testler:
// - Varsayılan profil/değerleri ve teknik field kodlarını doğrular.
// - Validation kurallarını (kaldıraç, sermaye, pozisyon limitleri,
//   30x özel profil kuralı, zararda pozisyon yasağı) sınar.
// - Trading invariant'lerinin (HARD_LIVE_TRADING_ALLOWED, paper mode,
//   MIN_SIGNAL_CONFIDENCE=70, yeni Binance fetch yok) korunduğunu
//   ve risk ayarlarının trade engine'e bağlanmadığını kanıtlar.

import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  STANDARD_DEFAULTS,
  LOW_DEFAULTS,
  AGGRESSIVE_DEFAULTS,
  POLICY,
  RISK_PROFILE_LABEL,
  defaultRiskSettings,
  profileDefaults,
  type RiskSettings,
} from "@/lib/risk-settings/types";
import {
  validateRiskSettings,
  computeWarnings,
  isExtremeLeverageAllowed,
} from "@/lib/risk-settings/validation";
import {
  getRiskSettings,
  updateRiskSettings,
  __resetRiskSettingsStoreForTests,
} from "@/lib/risk-settings/store";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

const ENG_BOT = read("src/lib/engines/bot-orchestrator.ts");
const RISK_PAGE = read("src/app/risk/page.tsx");
const RISK_TYPES = read("src/lib/risk-settings/types.ts");
const RISK_VALIDATION = read("src/lib/risk-settings/validation.ts");
const ROUTE = read("src/app/api/risk-settings/route.ts");

beforeEach(() => __resetRiskSettingsStoreForTests());

// ── 1. Profil etiketleri + varsayılan profil ───────────────────────────
describe("Phase 10 — varsayılan profil STANDART", () => {
  it("defaultRiskSettings().profile === 'STANDARD'", () => {
    expect(defaultRiskSettings().profile).toBe("STANDARD");
  });

  it("Profil etiketleri Türkçe", () => {
    expect(RISK_PROFILE_LABEL.LOW).toBe("DÜŞÜK");
    expect(RISK_PROFILE_LABEL.STANDARD).toBe("STANDART");
    expect(RISK_PROFILE_LABEL.AGGRESSIVE).toBe("AGRESİF");
    expect(RISK_PROFILE_LABEL.CUSTOM).toBe("ÖZEL");
  });
});

// ── 2. STANDART defaultları doğru ──────────────────────────────────────
describe("Phase 10 — STANDART profil değerleri", () => {
  it("İşlem başı risk %3, günlük max zarar %10, varsayılan açık 3, dinamik üst sınır 5, günlük işlem 10", () => {
    expect(STANDARD_DEFAULTS.capital.riskPerTradePercent).toBe(3);
    expect(STANDARD_DEFAULTS.capital.maxDailyLossPercent).toBe(10);
    expect(STANDARD_DEFAULTS.positions.defaultMaxOpenPositions).toBe(3);
    expect(STANDARD_DEFAULTS.positions.dynamicMaxOpenPositionsCap).toBe(5);
    expect(STANDARD_DEFAULTS.positions.maxDailyTrades).toBe(10);
  });

  it("LOW: %2, %6, 2, 3, 6", () => {
    expect(LOW_DEFAULTS.capital.riskPerTradePercent).toBe(2);
    expect(LOW_DEFAULTS.capital.maxDailyLossPercent).toBe(6);
    expect(LOW_DEFAULTS.positions.defaultMaxOpenPositions).toBe(2);
    expect(LOW_DEFAULTS.positions.dynamicMaxOpenPositionsCap).toBe(3);
    expect(LOW_DEFAULTS.positions.maxDailyTrades).toBe(6);
  });

  it("AGGRESSIVE: %5, %15, 4, 6, 15", () => {
    expect(AGGRESSIVE_DEFAULTS.capital.riskPerTradePercent).toBe(5);
    expect(AGGRESSIVE_DEFAULTS.capital.maxDailyLossPercent).toBe(15);
    expect(AGGRESSIVE_DEFAULTS.positions.defaultMaxOpenPositions).toBe(4);
    expect(AGGRESSIVE_DEFAULTS.positions.dynamicMaxOpenPositionsCap).toBe(6);
    expect(AGGRESSIVE_DEFAULTS.positions.maxDailyTrades).toBe(15);
  });

  it("CUSTOM defaultları STANDART'tan başlar", () => {
    const cd = profileDefaults("CUSTOM");
    expect(cd.capital.riskPerTradePercent).toBe(STANDARD_DEFAULTS.capital.riskPerTradePercent);
    expect(cd.capital.maxDailyLossPercent).toBe(STANDARD_DEFAULTS.capital.maxDailyLossPercent);
  });
});

// ── 3. Kaldıraç defaultları + teknik field kodları ────────────────────
describe("Phase 10 — kaldıraç defaultları ve teknik field kodları", () => {
  it("CC 3-20, GNMR 10-20, MNLST 10-20", () => {
    expect(STANDARD_DEFAULTS.leverage.CC).toEqual({ min: 3, max: 20 });
    expect(STANDARD_DEFAULTS.leverage.GNMR).toEqual({ min: 10, max: 20 });
    expect(STANDARD_DEFAULTS.leverage.MNLST).toEqual({ min: 10, max: 20 });
  });

  it("Teknik field kodları docstring/UI'da açıkça yer alır: CCMNKL, CCMXKL, GNMRMNKL, GNMRMXKL, MNLSTMNKL, MNLSTMXKL", () => {
    for (const code of ["CCMNKL", "CCMXKL", "GNMRMNKL", "GNMRMXKL", "MNLSTMNKL", "MNLSTMXKL"]) {
      expect(RISK_TYPES.includes(code)).toBe(true);
      expect(RISK_PAGE.includes(code)).toBe(true);
    }
  });

  it("Hard cap 30x, varsayılan 20x", () => {
    expect(POLICY.hardLeverageCap).toBe(30);
    expect(POLICY.defaultLeverageCap).toBe(20);
  });
});

// ── 4. 30x sadece ÖZEL profilde kabul edilir ──────────────────────────
describe("Phase 10 — 30x kuralı", () => {
  it("isExtremeLeverageAllowed: STANDART'ta 30x reddedilir, ÖZEL'de kabul edilir", () => {
    expect(isExtremeLeverageAllowed("STANDARD", 30)).toBe(false);
    expect(isExtremeLeverageAllowed("STANDARD", 20)).toBe(true);
    expect(isExtremeLeverageAllowed("CUSTOM", 30)).toBe(true);
    expect(isExtremeLeverageAllowed("CUSTOM", 31)).toBe(false);
  });

  it("STANDART profilde max>20 kaydı validation hatası verir", () => {
    const s = defaultRiskSettings();
    s.leverage.CC.max = 30;
    const r = validateRiskSettings(s);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/ÖZEL/);
  });

  it("ÖZEL profilde max=30 kabul edilir", () => {
    const s = defaultRiskSettings();
    s.profile = "CUSTOM";
    s.leverage.CC.max = 30;
    s.leverage.CC.min = 3;
    expect(validateRiskSettings(s).ok).toBe(true);
  });

  it("30x seçilince LEVERAGE_MAX_CRITICAL kırmızı uyarısı çıkar", () => {
    const s = defaultRiskSettings();
    s.profile = "CUSTOM";
    s.leverage.GNMR.max = 30;
    const w = computeWarnings(s);
    const codes = w.map((x) => x.code);
    expect(codes).toContain("LEVERAGE_MAX_CRITICAL");
    expect(w.find((x) => x.code === "LEVERAGE_MAX_CRITICAL")?.severity).toBe("critical");
  });
});

// ── 5. Yüksek değer uyarıları ─────────────────────────────────────────
describe("Phase 10 — kırmızı uyarı eşikleri", () => {
  it("İşlem başı risk > %3 kırmızı uyarı", () => {
    const s = defaultRiskSettings();
    s.profile = "CUSTOM";
    s.capital.riskPerTradePercent = 4;
    const codes = computeWarnings(s).map((x) => x.code);
    expect(codes).toContain("RISK_PER_TRADE_HIGH");
  });

  it("Günlük max zarar > %10 kırmızı uyarı", () => {
    const s = defaultRiskSettings();
    s.profile = "CUSTOM";
    s.capital.maxDailyLossPercent = 12;
    const codes = computeWarnings(s).map((x) => x.code);
    expect(codes).toContain("MAX_DAILY_LOSS_HIGH");
  });

  it("Dinamik üst sınır > 5 kırmızı uyarı", () => {
    const s = defaultRiskSettings();
    s.profile = "CUSTOM";
    s.positions.dynamicMaxOpenPositionsCap = 6;
    const codes = computeWarnings(s).map((x) => x.code);
    expect(codes).toContain("DYNAMIC_CAP_HIGH");
  });

  it("Max günlük işlem > 10 kırmızı uyarı", () => {
    const s = defaultRiskSettings();
    s.profile = "CUSTOM";
    s.positions.maxDailyTrades = 15;
    const codes = computeWarnings(s).map((x) => x.code);
    expect(codes).toContain("MAX_DAILY_TRADES_HIGH");
  });

  it("Max kaldıraç > 20 (ama < 30) yüksek uyarı çıkarır (CUSTOM profilde)", () => {
    const s = defaultRiskSettings();
    s.profile = "CUSTOM";
    s.leverage.GNMR.max = 25;
    const codes = computeWarnings(s).map((x) => x.code);
    expect(codes).toContain("LEVERAGE_MAX_HIGH");
  });

  it("Standart varsayılanlar uyarı üretmez", () => {
    expect(computeWarnings(defaultRiskSettings())).toEqual([]);
  });
});

// ── 6. Validation reddetme kuralları ──────────────────────────────────
describe("Phase 10 — validation kuralları", () => {
  it("Min kaldıraç max kaldıraçtan büyük olamaz", () => {
    const s = defaultRiskSettings();
    s.leverage.CC.min = 15;
    s.leverage.CC.max = 10;
    const r = validateRiskSettings(s);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/min kaldıraç max kaldıraçtan büyük/);
  });

  it("Kaldıraç 1-30 dışındaki değer reddedilir", () => {
    const s = defaultRiskSettings();
    s.profile = "CUSTOM";
    s.leverage.CC.max = 31;
    expect(validateRiskSettings(s).ok).toBe(false);
    s.leverage.CC.max = 0;
    expect(validateRiskSettings(s).ok).toBe(false);
  });

  it("Risk yüzdesi negatif olamaz", () => {
    const s = defaultRiskSettings();
    s.capital.riskPerTradePercent = -1;
    expect(validateRiskSettings(s).ok).toBe(false);
  });

  it("Günlük max zarar 0'dan büyük olmalı", () => {
    const s = defaultRiskSettings();
    s.capital.maxDailyLossPercent = 0;
    expect(validateRiskSettings(s).ok).toBe(false);
  });

  it("Dinamik üst sınır varsayılan açık pozisyondan düşük olamaz", () => {
    const s = defaultRiskSettings();
    s.positions.defaultMaxOpenPositions = 5;
    s.positions.dynamicMaxOpenPositionsCap = 3;
    const r = validateRiskSettings(s);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/Dinamik açık pozisyon üst sınırı/);
  });

  it("Max günlük işlem 1'den küçük olamaz", () => {
    const s = defaultRiskSettings();
    s.positions.maxDailyTrades = 0;
    expect(validateRiskSettings(s).ok).toBe(false);
  });

  it("Toplam sermaye negatif olamaz", () => {
    const s = defaultRiskSettings();
    s.capital.totalCapitalUsdt = -100;
    expect(validateRiskSettings(s).ok).toBe(false);
  });
});

// ── 7. Zararda pozisyon büyütme kilitli ───────────────────────────────
describe("Phase 10 — zararda pozisyon büyütme kilitli", () => {
  it("Type sistemde averageDownEnabled literal false", () => {
    // Compile-time guarantee — runtime test sadece TS literal'i okuyamaz,
    // store seviyesinde inceliyoruz.
    expect(RISK_TYPES).toMatch(/averageDownEnabled:\s*false/);
  });

  it("Store: averageDownEnabled true patch reddedilir", () => {
    const r = updateRiskSettings({
      tiered: { averageDownEnabled: true as unknown as false },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join(" ")).toMatch(/Zararda pozisyon büyütme/);
    }
  });

  it("Validation: averageDownEnabled = true reddedilir", () => {
    const s = defaultRiskSettings();
    (s.tiered as { averageDownEnabled: boolean }).averageDownEnabled = true;
    const r = validateRiskSettings(s);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/kilitli güvenlik kuralı/);
  });

  it("UI'da KİLİTLİ rozeti gösterilir", () => {
    expect(RISK_PAGE).toMatch(/ZARARDA POZİSYON ARTIRMA/);
    expect(RISK_PAGE).toMatch(/locked/);
    expect(RISK_PAGE).toMatch(/KİLİTLİ/);
  });
});

// ── 8. Store + API entegrasyonu (saf) ─────────────────────────────────
describe("Phase 10 — store ve API kontratı", () => {
  it("Profil değişimi defaultları yükler ama totalCapital'i korur", () => {
    updateRiskSettings({ capital: { totalCapitalUsdt: 1000 } });
    const r = updateRiskSettings({ profile: "AGGRESSIVE" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.profile).toBe("AGGRESSIVE");
      expect(r.data.capital.riskPerTradePercent).toBe(5);
      expect(r.data.capital.totalCapitalUsdt).toBe(1000);
    }
  });

  it("Sıfırla → STANDART", () => {
    updateRiskSettings({ profile: "AGGRESSIVE" });
    const r = updateRiskSettings({ profile: "STANDARD" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.profile).toBe("STANDARD");
  });

  it("appliedToTradeEngine her zaman false (execution'a bağlanma yok)", () => {
    updateRiskSettings({ capital: { riskPerTradePercent: 2 } });
    const s = getRiskSettings();
    expect(s.appliedToTradeEngine).toBe(false);
  });

  it("API route GET + PUT export ediyor", () => {
    expect(ROUTE).toMatch(/export async function GET/);
    expect(ROUTE).toMatch(/export async function PUT/);
  });

  it("API route averageDownEnabled için z.literal(false) kullanır", () => {
    expect(ROUTE).toMatch(/averageDownEnabled:\s*z\.literal\(false\)/);
  });
});

// ── 9. Trading & live gate invariant'leri ─────────────────────────────
describe("Phase 10 — trading invariant'leri korunur", () => {
  it("MIN_SIGNAL_CONFIDENCE eşiği 70 (signal-engine)", () => {
    const eng = read("src/lib/engines/signal-engine.ts");
    expect(eng).toMatch(/if\s*\(score\s*<\s*70\)/);
  });

  it("HARD_LIVE_TRADING_ALLOWED env'de tanımlı", () => {
    const env = read("src/lib/env.ts");
    expect(env).toMatch(/HARD_LIVE_TRADING_ALLOWED/);
  });

  it("Risk Yönetimi sayfası bot-orchestrator import etmez (execution coupling yok)", () => {
    expect(RISK_PAGE).not.toMatch(/bot-orchestrator/);
    expect(RISK_PAGE).not.toMatch(/risk-engine/);
    expect(RISK_PAGE).not.toMatch(/openTrade|tradeEngine/);
  });

  it("Risk-settings lib bot-orchestrator import etmez", () => {
    expect(RISK_TYPES).not.toMatch(/bot-orchestrator|signal-engine|risk-engine/);
    expect(RISK_VALIDATION).not.toMatch(/bot-orchestrator|signal-engine|risk-engine/);
  });

  it("Risk-settings lib bot-orchestrator'a bağlandı (Faz 20 bilerek yapılmış)", () => {
    // Faz 10: execution decoupled. Faz 20: buildRiskExecutionConfig/ensureHydrated
    // bilerek import edildi — position sizing + daily loss + max positions lifecycle
    // bağlantısı. Bu test Faz 20'de güncellendi; eski "import etmez" guard kalktı.
    expect(ENG_BOT).toMatch(/from\s+["']@\/lib\/risk-settings/);
  });

  it("Risk Yönetimi sayfası yeni Binance API çağrısı eklemiyor", () => {
    expect(RISK_PAGE).not.toMatch(/fapi\.binance\.com/);
    expect(RISK_PAGE).not.toMatch(/api\.binance\.com/);
    expect(RISK_PAGE).not.toMatch(/import\s+axios/);
  });

  it("API route Binance API çağrısı içermez", () => {
    expect(ROUTE).not.toMatch(/fapi\.binance\.com/);
    expect(ROUTE).not.toMatch(/api\.binance\.com/);
    expect(ROUTE).not.toMatch(/import\s+axios/);
  });
});

// ── 10. Sayfa kurulum + sidebar etiketi ───────────────────────────────
describe("Phase 10 — sayfa ve menü", () => {
  it("Sidebar etiketi 'Risk Yönetimi' (eski 'Risk Ayarları' değil)", () => {
    const sidebar = read("src/components/Sidebar.tsx");
    expect(sidebar).toMatch(/label:\s*'Risk Yönetimi'/);
    expect(sidebar).not.toMatch(/label:\s*'Risk Ayarları'/);
  });

  it("Sayfa başlığı 'RİSK YÖNETİMİ' büyük harf", () => {
    expect(RISK_PAGE).toMatch(/RİSK YÖNETİMİ/);
  });

  it("Kart grupları doğru sırada", () => {
    const expected = [
      "1. RİSK PROFİLİ",
      "2. SERMAYE VE ZARAR LİMİTLERİ",
      "3. POZİSYON LİMİTLERİ",
      "4. KALDIRAÇ ARALIKLARI",
      "5. STOP-LOSS VE POZİSYON YÖNETİMİ",
      "6. GÜVENLİK UYARILARI",
    ];
    let lastIdx = -1;
    for (const t of expected) {
      const i = RISK_PAGE.indexOf(t);
      expect(i).toBeGreaterThan(lastIdx);
      lastIdx = i;
    }
  });

  it("Stop-loss varsayılanı SİSTEM BELİRLESİN", () => {
    expect(STANDARD_DEFAULTS.stopLoss.mode).toBe("SYSTEM");
    expect(RISK_PAGE).toMatch(/SİSTEM BELİRLESİN/);
  });
});

// ── 11. Diğer Faz sayfaları bozulmadı ─────────────────────────────────
describe("Phase 10 — Faz 8/9 sayfaları korundu", () => {
  it("Piyasa Tarayıcı (Faz 8) imzası ve Binance fetch yokluğu", () => {
    const scanner = read("src/app/scanner/page.tsx");
    expect(scanner).toMatch(/Phase 8 — Piyasa Tarayıcı/);
    expect(scanner).not.toMatch(/fapi\.binance\.com/);
  });

  it("Tarama Modları sayfası mevcut (refactor yok)", () => {
    const sm = read("src/app/scan-modes/page.tsx");
    expect(sm.length).toBeGreaterThan(0);
  });

  it("Dashboard kartları (Faz 9) hâlâ mevcut", () => {
    const cards = read("src/components/dashboard/Cards.tsx");
    expect(cards).toMatch(/POZİSYON KARAR MERKEZİ/);
    expect(cards).toMatch(/PİYASA NABZI/);
    expect(cards).toMatch(/FIRSAT RADARI/);
  });
});

// ── helper ─────────────────────────────────────────────────────────────
// Test-only — bu dosyada şu an kullanılmıyor; ileride çıkarılabilir.
function _typeAssert<T extends RiskSettings>(s: T): T { return s; }
void _typeAssert;
