// Phase 10 — Risk Yönetimi validation + uyarı türetimi.
//
// Saf fonksiyonlar: girdiyi inceler, hata mesajlarını ve kırmızı uyarı
// kodlarını döner. Hiçbir trade veya execution davranışı değiştirilmez.

import {
  POLICY,
  type RiskProfileKey,
  type RiskSettings,
} from "./types";

export type WarningCode =
  | "RISK_PER_TRADE_HIGH"
  | "MAX_DAILY_LOSS_HIGH"
  | "DYNAMIC_CAP_HIGH"
  | "MAX_DAILY_TRADES_HIGH"
  | "LEVERAGE_MAX_HIGH"
  | "LEVERAGE_MAX_CRITICAL"
  | "AVERAGE_DOWN_BLOCKED";

export interface WarningEntry {
  code: WarningCode;
  /** "warning" sarı, "critical" kırmızı; UI tonu. */
  severity: "warning" | "critical";
  /** Kullanıcıya gösterilecek kısa Türkçe etiket. */
  message: string;
}

const LEVERAGE_KEYS = ["CC", "GNMR", "MNLST"] as const;

/** Validation sonucu — error varsa kayıt reddedilmeli. */
export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateRiskSettings(s: RiskSettings): ValidationResult {
  const errors: string[] = [];

  // ── Sermaye / yüzdeler ──────────────────────────────────────────────
  if (s.capital.totalCapitalUsdt < 0) {
    errors.push("Toplam bot sermayesi negatif olamaz.");
  }
  if (s.capital.riskPerTradePercent < 0) {
    errors.push("İşlem başı risk yüzdesi negatif olamaz.");
  }
  if (s.capital.maxDailyLossPercent <= 0) {
    errors.push("Günlük maksimum zarar 0'dan büyük olmalı.");
  }

  // ── Pozisyon limitleri ──────────────────────────────────────────────
  if (s.positions.maxDailyTrades < 1) {
    errors.push("Maksimum günlük işlem sayısı 1'den küçük olamaz.");
  }
  if (s.positions.defaultMaxOpenPositions < 1) {
    errors.push("Varsayılan açık pozisyon en az 1 olmalı.");
  }
  if (s.positions.dynamicMaxOpenPositionsCap < s.positions.defaultMaxOpenPositions) {
    errors.push("Dinamik açık pozisyon üst sınırı, varsayılan açık pozisyondan düşük olamaz.");
  }

  // ── Kaldıraç min/max ─────────────────────────────────────────────────
  for (const k of LEVERAGE_KEYS) {
    const r = s.leverage[k];
    if (r.min < POLICY.minLeverage || r.min > POLICY.hardLeverageCap) {
      errors.push(`${k} min kaldıraç ${POLICY.minLeverage}-${POLICY.hardLeverageCap} aralığında olmalı.`);
    }
    if (r.max < POLICY.minLeverage || r.max > POLICY.hardLeverageCap) {
      errors.push(`${k} max kaldıraç ${POLICY.minLeverage}-${POLICY.hardLeverageCap} aralığında olmalı.`);
    }
    if (r.min > r.max) {
      errors.push(`${k} min kaldıraç max kaldıraçtan büyük olamaz.`);
    }
  }

  // ── 30x sadece ÖZEL profilde ────────────────────────────────────────
  // hardLeverageCap = 30. Eğer bir bucket 30'a çıkmışsa profil ÖZEL olmalı.
  const wantsExtreme = LEVERAGE_KEYS.some(
    (k) => s.leverage[k].max > POLICY.defaultLeverageCap,
  );
  if (wantsExtreme && s.profile !== "CUSTOM") {
    errors.push(
      `Maksimum kaldıraç ${POLICY.defaultLeverageCap}x üstüne yalnızca ÖZEL profilde çıkılabilir.`,
    );
  }

  // ── Zararda pozisyon büyütme yasak (kilitli kural) ──────────────────
  if ((s.tiered as { averageDownEnabled?: boolean }).averageDownEnabled === true) {
    errors.push("Zararda pozisyon büyütme açılamaz (kilitli güvenlik kuralı).");
  }

  // ── Execution invariant ─────────────────────────────────────────────
  if (s.appliedToTradeEngine !== false) {
    errors.push("Risk ayarları bu fazda trade engine'e uygulanamaz (appliedToTradeEngine=false).");
  }

  return { ok: errors.length === 0, errors };
}

/** Profil seviyesini de gözeterek uyarı kodlarını üretir. */
export function computeWarnings(s: RiskSettings): WarningEntry[] {
  const out: WarningEntry[] = [];
  const w = POLICY.warnings;

  if (s.capital.riskPerTradePercent > w.riskPerTradePercent) {
    out.push({
      code: "RISK_PER_TRADE_HIGH",
      severity: "critical",
      message: `İşlem başı risk %${s.capital.riskPerTradePercent} — %${w.riskPerTradePercent} üzeri yüksek risktir.`,
    });
  }
  if (s.capital.maxDailyLossPercent > w.maxDailyLossPercent) {
    out.push({
      code: "MAX_DAILY_LOSS_HIGH",
      severity: "critical",
      message: `Günlük maksimum zarar %${s.capital.maxDailyLossPercent} — %${w.maxDailyLossPercent} üzeri tehlikeli olabilir.`,
    });
  }
  if (s.positions.dynamicMaxOpenPositionsCap > w.dynamicMaxOpenPositionsCap) {
    out.push({
      code: "DYNAMIC_CAP_HIGH",
      severity: "critical",
      message: `Dinamik açık pozisyon üst sınırı ${s.positions.dynamicMaxOpenPositionsCap} — ${w.dynamicMaxOpenPositionsCap} üstü yüksek risktir.`,
    });
  }
  if (s.positions.maxDailyTrades > w.maxDailyTrades) {
    out.push({
      code: "MAX_DAILY_TRADES_HIGH",
      severity: "critical",
      message: `Günlük işlem sayısı ${s.positions.maxDailyTrades} — ${w.maxDailyTrades} üstü aşırı işlem riskidir.`,
    });
  }

  // Kaldıraç uyarıları (her bucket için).
  for (const k of LEVERAGE_KEYS) {
    const max = s.leverage[k].max;
    if (max >= w.leverageMaxCritical) {
      out.push({
        code: "LEVERAGE_MAX_CRITICAL",
        severity: "critical",
        message: `${k} max kaldıraç ${max}x — sadece ÖZEL profil için, çok yüksek tasfiye riski.`,
      });
    } else if (max > w.leverageMaxWarn) {
      out.push({
        code: "LEVERAGE_MAX_HIGH",
        severity: "critical",
        message: `${k} max kaldıraç ${max}x — varsayılan üst limit ${w.leverageMaxWarn}x üstüdür.`,
      });
    }
  }

  // Zararda pozisyon büyütme açılmaya çalışılırsa uyarı.
  if ((s as { tiered?: { averageDownEnabled?: boolean } }).tiered?.averageDownEnabled === true) {
    out.push({
      code: "AVERAGE_DOWN_BLOCKED",
      severity: "critical",
      message: "Zararda pozisyon büyütme açılamaz — kilitli güvenlik kuralı.",
    });
  }

  return out;
}

/** Profil seçimine uyumluluk: profil != ÖZEL ise 30x'lere izin verilmez. */
export function isExtremeLeverageAllowed(profile: RiskProfileKey, max: number): boolean {
  if (max <= POLICY.defaultLeverageCap) return true;
  return profile === "CUSTOM" && max <= POLICY.hardLeverageCap;
}
