// Phase 13 — Performans Karar Özeti.
//
// Tüm alt analizleri (score band, shadow threshold, missed opportunities,
// trade reviews, stop-loss kalitesi, risk advisory) toplayıp tek bir
// üst seviye özet üretir. Bu özet UI'da Performans Karar Özeti kartını
// besler ve paper/live ayrımı yalnızca `tradeMode` rozetinde gözükür.
//
// KESİN KURAL: appliedToTradeEngine her zaman `false`'dur — bu modül
// hiçbir ayarı, eşiği, stop-loss kuralını veya canlı trading gate'ini
// otomatik değiştirmez. Tek görevi gözlem ve öneri üretmektir.

import type {
  DecisionSummary,
  DecisionStatus,
  DecisionActionType,
  ScoreBandReport,
  ShadowThresholdReport,
  MissedOpportunityReport,
  TradeReviewResult,
  StopLossQualityResult,
  RiskAdvisoryItem,
  TradeMode,
} from "./types";

export interface DecisionSummaryInputs {
  /** Hangi mod analiz edildiyse o (UI rozeti için). */
  tradeMode: TradeMode;
  closedTradeCount: number;
  scoreBands: ScoreBandReport[];
  shadowThresholds: ShadowThresholdReport;
  missed: MissedOpportunityReport;
  tradeReviews: TradeReviewResult[];
  stopLossReviews: StopLossQualityResult[];
  riskAdvisory: RiskAdvisoryItem[];
  /** Toplam trade sayısı, kapalı + açık. */
  totalTradeCount: number;
  /** Mevcut win rate (0–100). */
  paperWinRatePercent: number;
}

const MIN_DECISION_TRADES = 5;
const DEFAULT_OBSERVE_DAYS = 7;

export function buildDecisionSummary(p: DecisionSummaryInputs): DecisionSummary {
  // ── Veri yetersiz ──
  if (p.closedTradeCount < MIN_DECISION_TRADES) {
    return {
      status: "DATA_INSUFFICIENT",
      tradeMode: p.tradeMode,
      mainFinding: "Karar verecek kadar işlem oluşmadı.",
      systemInterpretation: `Şu ana kadar ${p.closedTradeCount} kapalı işlem var; analiz için ≥${MIN_DECISION_TRADES} öneriliyor.`,
      recommendation: "Gözlem devam etsin; bot çalışırken otomatik veri birikiyor.",
      actionType: "DATA_INSUFFICIENT",
      confidence: 30,
      requiresUserApproval: false,
      observeDays: 0,
      appliedToTradeEngine: false,
    };
  }

  // ── Sinyal/davranış analizi ──
  const earlyStops = p.tradeReviews.filter((r) => r.tag === "POSSIBLE_EARLY_STOP").length;
  const badRr = p.tradeReviews.filter((r) => r.tag === "POSSIBLE_BAD_RR").length;
  const riskTooHigh = p.tradeReviews.filter((r) => r.tag === "POSSIBLE_RISK_TOO_HIGH").length;
  const exitTooEarly = p.tradeReviews.filter((r) => r.tag === "POSSIBLE_EXIT_TOO_EARLY").length;
  const goodWins = p.tradeReviews.filter((r) => r.tag === "GOOD_WIN").length;

  const slQuality = p.stopLossReviews;
  const tightSl = slQuality.filter((s) => s.tag === "SL_TOO_TIGHT").length;
  const earlySl = slQuality.filter((s) => s.tag === "EARLY_STOP_SUSPECT").length;

  const opportunityRatio = p.missed.missedOpportunityCount > 0
    ? p.missed.missedOpportunityCount / Math.max(1, p.totalTradeCount + p.missed.missedOpportunityCount)
    : 0;

  // ── Karar tablosu ──
  let actionType: DecisionActionType = "NO_ACTION";
  let status: DecisionStatus = "HEALTHY";
  let mainFinding = "Bot performansı sağlıklı görünüyor.";
  let systemInterpretation = `Toplam ${p.closedTradeCount} kapalı işlem, win rate ${p.paperWinRatePercent.toFixed(1)}%.`;
  let recommendation = "Aksiyon önerilmiyor — mevcut ayarlarla çalışmaya devam.";
  let confidence = 60;
  let observeDays = 0;
  let requiresUserApproval = false;

  if (earlySl >= 2 || tightSl >= 2) {
    actionType = "REVIEW_STOP_LOSS";
    status = "ATTENTION_NEEDED";
    mainFinding = `Stop-loss kalitesinde uyarı: ${earlySl} erken stop, ${tightSl} dar SL.`;
    systemInterpretation = "Volatiliteye göre SL mesafesi yetersiz olabilir; kullanıcı incelemesi öneriliyor.";
    recommendation = "Risk Yönetimi → Stop-loss bölümünü gözden geçir; bu öneriyi onaylamadıkça hiçbir ayar değişmez.";
    confidence = 70;
    requiresUserApproval = true;
  } else if (badRr >= 3) {
    actionType = "REVIEW_STOP_LOSS";
    status = "WATCH";
    mainFinding = `${badRr} işlem R:R zayıf bandında kapandı.`;
    systemInterpretation = "R:R'ı 1:2 altına düşen işlemler birikiyor; SL stratejisi gözden geçirilmeli.";
    recommendation = "Stop-loss kalitesini gözlem altına al; varsayılan 7 gün izleme öneriliyor.";
    confidence = 65;
    observeDays = DEFAULT_OBSERVE_DAYS;
  } else if (riskTooHigh >= 2) {
    actionType = "REVIEW_RISK_SETTINGS";
    status = "ATTENTION_NEEDED";
    mainFinding = `${riskTooHigh} işlemde zarar tutarı yüksek seyretti.`;
    systemInterpretation = "İşlem başı risk yüzdesi mevcut performansla uyumsuz olabilir.";
    recommendation = "Risk Yönetimi → İşlem başı risk yüzdesini gözden geçir; otomatik değişiklik yapılmadı.";
    confidence = 70;
    requiresUserApproval = true;
  } else if (
    p.shadowThresholds.rows.find((r) => r.threshold === 75)?.hypotheticalTradeCount === 0
    && p.shadowThresholds.rows.find((r) => r.threshold === 70)?.hypotheticalTradeCount === 0
    && (p.shadowThresholds.rows.find((r) => r.threshold === 65)?.hypotheticalTradeCount ?? 0) > 0
  ) {
    actionType = "REVIEW_THRESHOLD";
    status = "WATCH";
    mainFinding = "Mevcut eşikte (70) hiç sinyal açılmadı, 65'te birden fazla aday var.";
    systemInterpretation = "Eşik için gözlem önerilebilir; ancak sistem kendiliğinden eşik değiştirmez.";
    recommendation = "REVIEW_THRESHOLD: 65 eşiği gözlem altına alınabilir; canlı eşik 70 olarak korunuyor.";
    confidence = 55;
    observeDays = DEFAULT_OBSERVE_DAYS;
  } else if (p.missed.missedOpportunityCount >= 5 && opportunityRatio >= 0.5) {
    actionType = "REVIEW_POSITION_LIMITS";
    status = "WATCH";
    mainFinding = `${p.missed.missedOpportunityCount} kaçan fırsat tespit edildi.`;
    systemInterpretation = p.missed.possibleAdjustmentArea;
    recommendation = "Pozisyon limitleri ve risk gate gözlem altına alınabilir.";
    confidence = 55;
    observeDays = DEFAULT_OBSERVE_DAYS;
  } else if (exitTooEarly >= 2) {
    actionType = "REVIEW_SIGNAL_QUALITY";
    status = "WATCH";
    mainFinding = `${exitTooEarly} işlem TP'ye ulaşmadan manuel kapanmış.`;
    systemInterpretation = "Take-profit stratejisi veya manuel müdahale gözden geçirilebilir.";
    recommendation = "Gözlem önerilir.";
    confidence = 55;
    observeDays = DEFAULT_OBSERVE_DAYS;
  } else if (goodWins >= 3 && p.paperWinRatePercent >= 60) {
    actionType = "NO_ACTION";
    status = "HEALTHY";
    mainFinding = `${goodWins} güçlü kazanç, win rate ${p.paperWinRatePercent.toFixed(1)}%.`;
    systemInterpretation = "Sinyal/risk dengesi sağlıklı görünüyor.";
    recommendation = "Aksiyon önerilmiyor — gözlem sürdürülsün.";
    confidence = 75;
  } else if (p.paperWinRatePercent < 40 && p.closedTradeCount >= 10) {
    actionType = "OBSERVE";
    status = "WATCH";
    mainFinding = `Win rate düşük (${p.paperWinRatePercent.toFixed(1)}%).`;
    systemInterpretation = "Tek bir alan değil, genel performans gözlem gerektiriyor.";
    recommendation = "Gözlem süresi varsayılan 7 gün — sistem hiçbir ayarı değiştirmez.";
    confidence = 60;
    observeDays = DEFAULT_OBSERVE_DAYS;
  } else {
    actionType = "NO_ACTION";
    status = "HEALTHY";
  }

  // earlyStops referansı tutuldu — şu an sadece tightSl/earlySl üzerinden karar
  // veriliyor; ileride OBSERVE'a katkı için açılabilir. Lint için no-op.
  void earlyStops;

  return {
    status,
    tradeMode: p.tradeMode,
    mainFinding,
    systemInterpretation,
    recommendation,
    actionType,
    confidence,
    requiresUserApproval,
    observeDays,
    appliedToTradeEngine: false,
  };
}
