// AI Aksiyon Merkezi — Faz 2: Deterministic ActionPlan generator.
//
// MUTLAK KURALLAR:
//   • Bu modül HİÇBİR ayarı uygulamaz. Yalnızca ActionPlan[] döndürür.
//   • Üretilen her aksiyon ALLOWED_ACTION_TYPES içinden seçilir; aksi
//     durumda runtime guard plan'i `allowed=false` ile bloklar.
//   • Risk artırma, kaldıraç artırma, live trading açma, learning/force
//     bypass açma, SL/TP algoritma değiştirme öneren bir plan ÜRETİLMEZ.
//   • AI yorumu summary/reason zenginleştirebilir; safety alanları
//     (type, allowed, riskLevel, recommendedValue) deterministik kalır.

import {
  ALLOWED_ACTION_TYPES,
  type ActionPlan,
  type ActionPlanGeneratorInput,
  type ActionPlanRiskLevel,
  type ActionPlanType,
} from "./types";

/** Veri yetersizlik eşiği — paper learning hedefi 100 trade. */
const MIN_TRADES_FOR_PARAM_ADJUSTMENT = 25;
const MIN_TRADES_FOR_DECISION = 5;

/** Risk per trade — bu fazda yalnızca "%-1.0" gibi düşürme önerisi üretilir. */
const RISK_PER_TRADE_DECREMENT = 1.0;
const RISK_PER_TRADE_FLOOR = 1.0;

/** Daily max loss düşürme adımı. */
const DAILY_LOSS_DECREMENT = 1.0;
const DAILY_LOSS_FLOOR = 2.0;

/** Position cap düşürme — tek seferde 1 azaltılır. */
const POSITIONS_DECREMENT = 1;
const POSITIONS_FLOOR = 1;

/** Daily trades düşürme — tek seferde 1 azaltılır (öneri). */
const DAILY_TRADES_DECREMENT = 1;
const DAILY_TRADES_FLOOR = 3;

function planId(prefix: string, seed: string | number): string {
  return `${prefix}:${seed}`;
}

function clampConfidence(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function buildPlan(input: {
  id: string;
  source: ActionPlan["source"];
  type: ActionPlanType;
  title: string;
  summary: string;
  reason: string;
  currentValue: string | null;
  recommendedValue: string | null;
  impact: string;
  riskLevel: ActionPlanRiskLevel;
  confidence: number;
  generatedAt: string;
}): ActionPlan {
  const allowed = ALLOWED_ACTION_TYPES.includes(input.type);
  return {
    id: input.id,
    source: input.source,
    type: input.type,
    title: input.title,
    summary: input.summary,
    reason: input.reason,
    currentValue: input.currentValue,
    recommendedValue: input.recommendedValue,
    impact: input.impact,
    riskLevel: input.riskLevel,
    confidence: clampConfidence(input.confidence),
    requiresApproval: true,
    allowed,
    blockedReason: allowed
      ? null
      : "Bu aksiyon tipi izinli liste dışı — generator otomatik bloke etti.",
    status: "ready",
    createdAt: input.generatedAt,
  };
}

/**
 * Generate ActionPlan[] from current system snapshot.
 *
 * Kurallar (sırayla değerlendirilir; çakışan koşullarda en kritik öne alınır):
 *
 * R1. closedTradeCount < MIN_TRADES_FOR_DECISION → SET_OBSERVATION_MODE.
 * R2. closedTradeCount >= 25 + profitFactor < 1 → UPDATE_RISK_PER_TRADE_DOWN.
 * R3. maxDrawdownPercent > 1.5×dailyMaxLossPercent → UPDATE_MAX_DAILY_LOSS_DOWN.
 * R4. openTradeCount >= dynamicMaxOpenPositions ve closedTradeCount >= 10 →
 *     UPDATE_MAX_OPEN_POSITIONS_DOWN VEYA REQUEST_MANUAL_REVIEW.
 * R5. winRate < 35 ve closedTradeCount >= 10 → UPDATE_RISK_PER_TRADE_DOWN.
 * R6. performanceDecision.actionType === "REVIEW_RISK_SETTINGS" →
 *     UPDATE_RISK_PER_TRADE_DOWN (mümkünse) ya da REQUEST_MANUAL_REVIEW.
 * R7. performanceDecision.actionType === "REVIEW_POSITION_LIMITS" →
 *     UPDATE_MAX_OPEN_POSITIONS_DOWN.
 * R8. performanceDecision.actionType === "REVIEW_THRESHOLD" |
 *     "REVIEW_SIGNAL_QUALITY" | "REVIEW_STOP_LOSS" → REQUEST_MANUAL_REVIEW.
 * R9. aiInterpretation varsa ve actionType=PROMPT → CREATE_IMPLEMENTATION_PROMPT.
 * R10. closedTradeCount < MIN_TRADES_FOR_PARAM_ADJUSTMENT ve hiçbir kural
 *      eşleşmediyse → SET_OBSERVATION_MODE.
 *
 * Aynı tip için duplicate plan üretilmez.
 */
export function generateActionPlans(
  input: ActionPlanGeneratorInput,
): ActionPlan[] {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const plans: ActionPlan[] = [];
  const seen = new Set<ActionPlanType>();

  const push = (plan: ActionPlan) => {
    if (seen.has(plan.type)) return;
    seen.add(plan.type);
    plans.push(plan);
  };

  // R1 — Veri çok az: kesin gözlem.
  if (input.closedTradeCount < MIN_TRADES_FOR_DECISION) {
    push(
      buildPlan({
        id: planId("observe", "data-insufficient"),
        source: "system",
        type: "SET_OBSERVATION_MODE",
        title: "Gözlem Modunda Kal",
        summary: `Yalnızca ${input.closedTradeCount} kapalı işlem var; karar için ≥${MIN_TRADES_FOR_DECISION} öneriliyor.`,
        reason:
          "Veri yetersizliğinde parametre değişikliği önermek istatistiksel olarak güvenilir değil.",
        currentValue: null,
        recommendedValue: null,
        impact: "Bot çalışmaya devam eder; veri biriktikçe öneriler etkinleşir.",
        riskLevel: "low",
        confidence: 90,
        generatedAt,
      }),
    );
    return finalizePlans(plans, input);
  }

  // R2 — Profit factor < 1 + yeterli veri → risk düşürme önerisi.
  if (
    input.closedTradeCount >= MIN_TRADES_FOR_PARAM_ADJUSTMENT &&
    Number.isFinite(input.profitFactor) &&
    input.profitFactor > 0 &&
    input.profitFactor < 1
  ) {
    push(makeRiskDownPlan(input, generatedAt, {
      reason: `Profit factor ${input.profitFactor.toFixed(2)} < 1: kazanç/zarar dengesizliği. Riski düşürmek drawdown'u sınırlandırır.`,
      riskLevel: "high",
      confidence: 78,
      seed: "pf-low",
    }));
  }

  // R3 — Drawdown daily limit'in 1.5 katından yüksekse loss limit düşür.
  const drawdownThreshold = input.riskSettings.dailyMaxLossPercent * 1.5;
  if (
    input.maxDrawdownPercent > 0 &&
    input.maxDrawdownPercent > drawdownThreshold
  ) {
    push(makeDailyLossDownPlan(input, generatedAt, {
      reason: `Maksimum drawdown %${input.maxDrawdownPercent.toFixed(1)} >> günlük loss limit %${input.riskSettings.dailyMaxLossPercent.toFixed(1)}.`,
      riskLevel: "high",
      confidence: 75,
    }));
  }

  // R4 — Open positions cap doluysa.
  if (
    input.openTradeCount >= input.riskSettings.dynamicMaxOpenPositions &&
    input.closedTradeCount >= 10
  ) {
    if (input.riskSettings.dynamicMaxOpenPositions > POSITIONS_FLOOR) {
      push(makePositionsDownPlan(input, generatedAt, {
        reason: `Açık pozisyon sayısı dinamik limite ulaştı (${input.openTradeCount}/${input.riskSettings.dynamicMaxOpenPositions}); pozisyon yönetimi gerilmiş.`,
        riskLevel: "medium",
        confidence: 65,
      }));
    } else {
      push(makeManualReviewPlan(generatedAt, {
        seed: "positions-cap-min",
        title: "Açık Pozisyon Yönetimi İncelemesi",
        reason:
          "Dinamik açık pozisyon limiti zaten minimum (1). Otomatik düşürme uygulanamaz; manuel inceleme öneriliyor.",
        riskLevel: "medium",
        confidence: 60,
      }));
    }
  }

  // R5 — Win rate çok düşük → risk düşürme.
  if (input.winRate > 0 && input.winRate < 35 && input.closedTradeCount >= 10) {
    push(makeRiskDownPlan(input, generatedAt, {
      reason: `Win rate %${input.winRate.toFixed(1)} < 35: tutarlılık zayıf. Risk düşürmek tek-trade kaybını sınırlandırır.`,
      riskLevel: "high",
      confidence: 70,
      seed: "winrate-low",
    }));
  }

  // R6 — performance decision risk inceleme.
  const pd = input.performanceDecision;
  if (pd?.actionType === "REVIEW_RISK_SETTINGS") {
    if (input.riskSettings.riskPerTradePercent > RISK_PER_TRADE_FLOOR) {
      push(makeRiskDownPlan(input, generatedAt, {
        reason: `Performans Karar Özeti: ${pd.mainFinding}`,
        riskLevel: "medium",
        confidence: clampConfidence(pd.confidence || 60),
        seed: "perf-decision-risk",
      }));
    } else {
      push(makeManualReviewPlan(generatedAt, {
        seed: "perf-decision-risk-floor",
        title: "Risk Ayarı Manuel İnceleme",
        reason: `İşlem başı risk zaten taban değer (%${RISK_PER_TRADE_FLOOR}). Performans Karar Özeti incelemesi: ${pd.mainFinding}`,
        riskLevel: "medium",
        confidence: clampConfidence(pd.confidence || 55),
      }));
    }
  }

  // R7 — performance decision pozisyon limitleri.
  if (pd?.actionType === "REVIEW_POSITION_LIMITS") {
    if (input.riskSettings.dynamicMaxOpenPositions > POSITIONS_FLOOR) {
      push(makePositionsDownPlan(input, generatedAt, {
        reason: `Performans Karar Özeti pozisyon limitleri inceliyor: ${pd.mainFinding}`,
        riskLevel: "medium",
        confidence: clampConfidence(pd.confidence || 60),
      }));
    } else {
      push(makeManualReviewPlan(generatedAt, {
        seed: "perf-decision-positions",
        title: "Pozisyon Limit Manuel İnceleme",
        reason: `Pozisyon limiti minimum; manuel inceleme öneriliyor. Karar: ${pd.mainFinding}`,
        riskLevel: "medium",
        confidence: clampConfidence(pd.confidence || 55),
      }));
    }
  }

  // R8 — diğer performans inceleme tipleri → manual review.
  if (
    pd?.actionType === "REVIEW_THRESHOLD" ||
    pd?.actionType === "REVIEW_SIGNAL_QUALITY" ||
    pd?.actionType === "REVIEW_STOP_LOSS"
  ) {
    push(makeManualReviewPlan(generatedAt, {
      seed: `perf-decision-${pd.actionType.toLowerCase()}`,
      title: pdReviewTitle(pd.actionType),
      reason: `Performans Karar Özeti: ${pd.mainFinding}`,
      riskLevel: "medium",
      confidence: clampConfidence(pd.confidence || 60),
    }));
  }

  // R9 — AI interpreter PROMPT öneriyor.
  if (input.aiInterpretation?.actionType === "PROMPT") {
    const ai = input.aiInterpretation;
    push(
      buildPlan({
        id: planId("ai-prompt", "interpreter"),
        source: "ai_interpreter",
        type: "CREATE_IMPLEMENTATION_PROMPT",
        title: "Claude Code Promptu Üret",
        summary: `AI yorum: ${ai.mainFinding}`,
        reason:
          "AI Karar Yorumlayıcı uygulanabilir prompt önerdi. Prompt manuel uygulanır; otomatik kod değişikliği yok.",
        currentValue: null,
        recommendedValue: null,
        impact:
          "Aksiyon tetiklenirse Claude Code'a uygulanabilir bir prompt üretilir; uygulama kullanıcı kontrolündedir.",
        riskLevel: aiRiskToPlanRisk(ai.riskLevel),
        confidence: clampConfidence(ai.confidence || 60),
        generatedAt,
      }),
    );
  }

  // R10 — Hiçbir spesifik kural eşleşmediyse + veri parametre değişikliği için yetersiz → gözlem.
  if (
    plans.length === 0 &&
    input.closedTradeCount < MIN_TRADES_FOR_PARAM_ADJUSTMENT
  ) {
    push(
      buildPlan({
        id: planId("observe", "low-data"),
        source: "system",
        type: "SET_OBSERVATION_MODE",
        title: "Daha Fazla Veri Topla",
        summary: `${input.closedTradeCount}/${MIN_TRADES_FOR_PARAM_ADJUSTMENT} kapalı işlem; parametre önerileri için biraz daha veri gerekli.`,
        reason:
          "Düşük örnek boyutu istatistiksel öneriler için yetersiz; gözlemi sürdürmek güvenli yol.",
        currentValue: null,
        recommendedValue: null,
        impact: "Bot çalışmaya devam; veri arttıkça öneriler tetiklenir.",
        riskLevel: "low",
        confidence: 70,
        generatedAt,
      }),
    );
  }

  return finalizePlans(plans, input);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRiskDownPlan(
  input: ActionPlanGeneratorInput,
  generatedAt: string,
  opts: {
    reason: string;
    riskLevel: ActionPlanRiskLevel;
    confidence: number;
    seed: string;
  },
): ActionPlan {
  const current = input.riskSettings.riskPerTradePercent;
  const recommended = Math.max(RISK_PER_TRADE_FLOOR, current - RISK_PER_TRADE_DECREMENT);
  const allowed = current > recommended;
  return buildPlan({
    id: planId("risk-down", opts.seed),
    source: "performance_decision",
    type: "UPDATE_RISK_PER_TRADE_DOWN",
    title: "İşlem Başı Riski Düşür",
    summary: `Risk per trade %${current.toFixed(1)} → %${recommended.toFixed(1)} önerisi.`,
    reason: opts.reason,
    currentValue: `%${current.toFixed(1)}`,
    recommendedValue: `%${recommended.toFixed(1)}`,
    impact: allowed
      ? "Tek-trade kaybı küçülür; toplam drawdown sınırlanır. Ortalama kazanç da küçülebilir."
      : "Mevcut değer zaten taban; öneri etkisiz.",
    riskLevel: opts.riskLevel,
    confidence: opts.confidence,
    generatedAt,
  });
}

function makeDailyLossDownPlan(
  input: ActionPlanGeneratorInput,
  generatedAt: string,
  opts: { reason: string; riskLevel: ActionPlanRiskLevel; confidence: number },
): ActionPlan {
  const current = input.riskSettings.dailyMaxLossPercent;
  const recommended = Math.max(DAILY_LOSS_FLOOR, current - DAILY_LOSS_DECREMENT);
  return buildPlan({
    id: planId("daily-loss-down", "drawdown"),
    source: "performance_decision",
    type: "UPDATE_MAX_DAILY_LOSS_DOWN",
    title: "Günlük Maks. Zararı Düşür",
    summary: `Daily max loss %${current.toFixed(1)} → %${recommended.toFixed(1)} önerisi.`,
    reason: opts.reason,
    currentValue: `%${current.toFixed(1)}`,
    recommendedValue: `%${recommended.toFixed(1)}`,
    impact: "Bot daha erken günü sonlandırır; drawdown kontrolü artar.",
    riskLevel: opts.riskLevel,
    confidence: opts.confidence,
    generatedAt,
  });
}

function makePositionsDownPlan(
  input: ActionPlanGeneratorInput,
  generatedAt: string,
  opts: { reason: string; riskLevel: ActionPlanRiskLevel; confidence: number },
): ActionPlan {
  const current = input.riskSettings.dynamicMaxOpenPositions;
  const recommended = Math.max(POSITIONS_FLOOR, current - POSITIONS_DECREMENT);
  return buildPlan({
    id: planId("positions-down", "cap-full"),
    source: "performance_decision",
    type: "UPDATE_MAX_OPEN_POSITIONS_DOWN",
    title: "Maks. Açık Pozisyonu Düşür",
    summary: `Dynamic max open positions ${current} → ${recommended} önerisi.`,
    reason: opts.reason,
    currentValue: String(current),
    recommendedValue: String(recommended),
    impact:
      "Eş zamanlı maruziyet azalır; pozisyon yönetimi rahatlar. Trade fırsat sayısı azalabilir.",
    riskLevel: opts.riskLevel,
    confidence: opts.confidence,
    generatedAt,
  });
}

function makeManualReviewPlan(
  generatedAt: string,
  opts: {
    seed: string;
    title: string;
    reason: string;
    riskLevel: ActionPlanRiskLevel;
    confidence: number;
  },
): ActionPlan {
  return buildPlan({
    id: planId("manual-review", opts.seed),
    source: "performance_decision",
    type: "REQUEST_MANUAL_REVIEW",
    title: opts.title,
    summary: "Manuel inceleme öneriliyor; otomatik aksiyon güvenli değil.",
    reason: opts.reason,
    currentValue: null,
    recommendedValue: null,
    impact:
      "Aksiyon tetiklenmez. Kullanıcı Risk Yönetimi / Strateji sayfasında ilgili ayarları manuel değerlendirir.",
    riskLevel: opts.riskLevel,
    confidence: opts.confidence,
    generatedAt,
  });
}

function pdReviewTitle(actionType: string): string {
  switch (actionType) {
    case "REVIEW_THRESHOLD":
      return "Sinyal Eşiği İnceleme";
    case "REVIEW_SIGNAL_QUALITY":
      return "Sinyal Kalitesi İnceleme";
    case "REVIEW_STOP_LOSS":
      return "Stop-Loss Davranışı İnceleme";
    default:
      return "Manuel İnceleme";
  }
}

function aiRiskToPlanRisk(level: string): ActionPlanRiskLevel {
  switch (level) {
    case "CRITICAL":
      return "critical";
    case "HIGH":
      return "high";
    case "MEDIUM":
      return "medium";
    default:
      return "low";
  }
}

function finalizePlans(
  plans: ActionPlan[],
  input: ActionPlanGeneratorInput,
): ActionPlan[] {
  // Audit guard: ALLOWED_ACTION_TYPES dışında bir tip varsa allowed=false bırak.
  // (buildPlan zaten yapıyor, ama defansif son kontrol.)
  return plans.map((p) =>
    ALLOWED_ACTION_TYPES.includes(p.type)
      ? p
      : {
          ...p,
          allowed: false,
          blockedReason: "Action type ALLOWED_ACTION_TYPES dışında.",
        },
  );
  // Suppress unused-input warning — input is consumed via closures above.
  void input;
}
