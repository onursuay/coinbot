// Phase 10 — Risk Yönetimi config tipleri ve varsayılanları.
//
// SCOPE: scaffold + UI altyapısı. Bu modül yalnızca config/data
// modelidir; trade engine, signal engine, risk engine execution veya
// canlı trading gate üzerinde HİÇBİR etkisi YOKTUR. Bu fazda
// `applyToTradeEngine = false` invariant'i korunur — kayıtlar yalnızca
// gelecekteki bir fazda execution path'ine bağlanmaya hazır altyapı
// olarak saklanır.

// ── Profil tipleri ─────────────────────────────────────────────────────
export type RiskProfileKey = "LOW" | "STANDARD" | "AGGRESSIVE" | "CUSTOM";

export const RISK_PROFILE_LABEL: Record<RiskProfileKey, string> = {
  LOW: "DÜŞÜK",
  STANDARD: "STANDART",
  AGGRESSIVE: "AGRESİF",
  CUSTOM: "ÖZEL",
};

// ── Stop-loss modu ─────────────────────────────────────────────────────
//
// SİSTEM BELİRLESİN — bot kendi kuralına göre stop seviyesini koyar.
// SIKI / STANDART / GENİŞ — kullanıcı tercihi (gelecekte signal/risk
// engine'e geçirilecek). Bu fazda execution'a bağlanmaz.
export type StopLossMode = "SYSTEM" | "TIGHT" | "STANDARD" | "WIDE";

// ── Kaldıraç bucket'ları ───────────────────────────────────────────────
//
// Teknik field kodları:
//   CCMNKL    Core Coin Min Kaldıraç
//   CCMXKL    Core Coin Max Kaldıraç
//   GNMRMNKL  Genel Market Min Kaldıraç
//   GNMRMXKL  Genel Market Max Kaldıraç
//   MNLSTMNKL Manuel Liste Min Kaldıraç
//   MNLSTMXKL Manuel Liste Max Kaldıraç
export interface LeverageRange {
  min: number;
  max: number;
}
export interface LeverageRanges {
  /** Core coin (TIER_1/TIER_2 sabit liste). */
  CC: LeverageRange;
  /** Genel Market Taraması (WIDE_MARKET / MOMENTUM havuzu). */
  GNMR: LeverageRange;
  /** Manuel İzleme Listesi. */
  MNLST: LeverageRange;
}

// ── Sermaye / zarar / pozisyon limitleri ───────────────────────────────
export interface CapitalLimits {
  /** Toplam bot referans sermayesi (USDT). 0 = tanımsız (yüzdeler özet için). */
  totalCapitalUsdt: number;
  /** İşlem başı risk yüzdesi (% bakiye). */
  riskPerTradePercent: number;
  /** Günlük maksimum zarar yüzdesi (% bakiye). */
  maxDailyLossPercent: number;
}

export interface PositionLimits {
  /** Aynı anda varsayılan açılabilen pozisyon sayısı. */
  defaultMaxOpenPositions: number;
  /** Dinamik açılan pozisyonların üst sınırı. */
  dynamicMaxOpenPositionsCap: number;
  /** Günlük maksimum işlem sayısı. */
  maxDailyTrades: number;
}

// ── Long / Short ───────────────────────────────────────────────────────
export interface DirectionConfig {
  longEnabled: boolean;
  shortEnabled: boolean;
}

// ── Kademeli yönetim ───────────────────────────────────────────────────
export interface TieredManagement {
  /** Kâr sürerken kademeli ekleme (UI/config altyapısı; bu fazda execution'a bağlı değil). */
  scaleInProfitEnabled: boolean;
  /**
   * Zararda pozisyon büyütme. **DAİMA false**, UI tarafında kilitli.
   * Bu alan `true` yapılamaz — validation reddeder.
   */
  averageDownEnabled: false;
}

// ── Toplam Risk Settings ───────────────────────────────────────────────
export interface RiskSettings {
  profile: RiskProfileKey;
  capital: CapitalLimits;
  positions: PositionLimits;
  leverage: LeverageRanges;
  direction: DirectionConfig;
  stopLoss: { mode: StopLossMode };
  tiered: TieredManagement;
  /**
   * Saf güvenlik invariant'i: bu config'in trade engine'e uygulanıp
   * uygulanmadığını gösterir. Faz 10'da DAİMA false. Sadece okuma —
   * UI'da "config-only / not applied to live engine" rozetini sağlar.
   */
  appliedToTradeEngine: false;
  /** Son güncelleme zaman damgası (epoch ms). */
  updatedAt: number;
}

// ── Sabit eşikler ──────────────────────────────────────────────────────
//
// Bu sabitler **policy** sabitidir; UI ve validation aynı kaynaktan
// okur. Trading davranışını değiştirmezler — yalnızca config kabul
// eşikleridir.
export const POLICY = {
  /** Maksimum kaldıraç (sistemce desteklenen). */
  hardLeverageCap: 30,
  /** Varsayılan üst limit (profil seçicide görünen). */
  defaultLeverageCap: 20,
  /** Mutlak alt limit. */
  minLeverage: 1,
  /** Risk uyarı eşikleri (kırmızı badge için). */
  warnings: {
    riskPerTradePercent: 3,
    maxDailyLossPercent: 10,
    dynamicMaxOpenPositionsCap: 5,
    maxDailyTrades: 10,
    leverageMaxWarn: 20,
    leverageMaxCritical: 30,
  },
} as const;

// ── Profil varsayılanları ──────────────────────────────────────────────
//
// Standart varsayılanlar — küçük/orta sermaye için kontrollü
// agresif değerler. UI bu defaultları profil seçimi/sıfırlama için
// kullanır.
export const STANDARD_DEFAULTS: Omit<RiskSettings, "appliedToTradeEngine" | "updatedAt"> = {
  profile: "STANDARD",
  capital: {
    totalCapitalUsdt: 0,
    riskPerTradePercent: 3,
    maxDailyLossPercent: 10,
  },
  positions: {
    defaultMaxOpenPositions: 3,
    dynamicMaxOpenPositionsCap: 5,
    maxDailyTrades: 10,
  },
  leverage: {
    CC:    { min: 3,  max: 20 },
    GNMR:  { min: 10, max: 20 },
    MNLST: { min: 10, max: 20 },
  },
  direction: { longEnabled: true, shortEnabled: true },
  stopLoss: { mode: "SYSTEM" },
  tiered:   { scaleInProfitEnabled: false, averageDownEnabled: false },
};

export const LOW_DEFAULTS: Omit<RiskSettings, "appliedToTradeEngine" | "updatedAt"> = {
  ...STANDARD_DEFAULTS,
  profile: "LOW",
  capital: { totalCapitalUsdt: 0, riskPerTradePercent: 2, maxDailyLossPercent: 6 },
  positions: { defaultMaxOpenPositions: 2, dynamicMaxOpenPositionsCap: 3, maxDailyTrades: 6 },
};

export const AGGRESSIVE_DEFAULTS: Omit<RiskSettings, "appliedToTradeEngine" | "updatedAt"> = {
  ...STANDARD_DEFAULTS,
  profile: "AGGRESSIVE",
  capital: { totalCapitalUsdt: 0, riskPerTradePercent: 5, maxDailyLossPercent: 15 },
  positions: { defaultMaxOpenPositions: 4, dynamicMaxOpenPositionsCap: 6, maxDailyTrades: 15 },
};

export function profileDefaults(p: RiskProfileKey): Omit<RiskSettings, "appliedToTradeEngine" | "updatedAt"> {
  switch (p) {
    case "LOW": return LOW_DEFAULTS;
    case "AGGRESSIVE": return AGGRESSIVE_DEFAULTS;
    case "CUSTOM":
    case "STANDARD":
    default: return { ...STANDARD_DEFAULTS, profile: p };
  }
}

/** Gerçek başlangıç state'i — STANDART, executionToTrade=false.
 * Deep-clone yapılır; kullanıcının mutate ettiği nesne `STANDARD_DEFAULTS`
 * sabitlerini bozmamalı. */
export function defaultRiskSettings(): RiskSettings {
  return {
    profile: STANDARD_DEFAULTS.profile,
    capital: { ...STANDARD_DEFAULTS.capital },
    positions: { ...STANDARD_DEFAULTS.positions },
    leverage: {
      CC:    { ...STANDARD_DEFAULTS.leverage.CC },
      GNMR:  { ...STANDARD_DEFAULTS.leverage.GNMR },
      MNLST: { ...STANDARD_DEFAULTS.leverage.MNLST },
    },
    direction: { ...STANDARD_DEFAULTS.direction },
    stopLoss: { ...STANDARD_DEFAULTS.stopLoss },
    tiered: { ...STANDARD_DEFAULTS.tiered },
    appliedToTradeEngine: false,
    updatedAt: 0,
  };
}
