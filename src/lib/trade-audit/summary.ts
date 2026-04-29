// Faz 22 — Trade Audit Summary.
// Tüm alt denetimlerin çıktısını birleştirip üst seviye karar kartı üretir.
// Hiçbir ayarı otomatik DEĞİŞTİRMEZ. appliedToTradeEngine daima false.

import type {
  TradeAuditSummary,
  TradeAuditReport,
  TradeAuditInput,
  AuditActionType,
  TradeMode,
} from "./types";
import { reviewTradeQualityBatch } from "./trade-quality";
import { auditStopLossBatch } from "./stop-loss-audit";
import { auditTakeProfitBatch } from "./take-profit-audit";
import { calibrateRisk } from "./risk-calibration";
import { auditPositionSizing } from "./position-sizing-audit";
import { calibrateLimits } from "./limit-calibration";
import { calibrateLeverage } from "./leverage-calibration";
import { auditMissedOpportunities } from "./missed-opportunity-audit";
import { calibrateThreshold } from "./threshold-calibration";

export function buildTradeAuditReport(input: TradeAuditInput): TradeAuditReport {
  const { trades, scanRows, riskConfig, mode } = input;

  const modeFilter: TradeMode | undefined =
    mode === "paper" ? "paper"
    : mode === "live" ? "live"
    : undefined;

  const filtered = modeFilter ? trades.filter((t) => t.tradeMode === modeFilter) : trades;
  const closed = filtered.filter((t) => t.status === "closed");
  const open = filtered.filter((t) => t.status === "open");
  const tradeMode: TradeMode = mode === "live" ? "live" : "paper";

  const tradeQuality = reviewTradeQualityBatch(filtered);
  const stopLossAudit = auditStopLossBatch(filtered);
  const takeProfitAudit = auditTakeProfitBatch(filtered);
  const riskCalibration = calibrateRisk({ closedTrades: closed, riskConfig });
  const positionSizingAudit = auditPositionSizing({ closedTrades: closed, riskConfig });
  const limitCalibration = calibrateLimits({ trades: filtered, riskConfig });
  const leverageCalibration = calibrateLeverage({ closedTrades: closed, riskConfig });
  const missedOpportunityAudit = auditMissedOpportunities(scanRows);
  const thresholdCalibration = calibrateThreshold({ trades: filtered, scanRows });

  const summary = buildSummary({
    tradeMode,
    tradeQuality,
    stopLossAudit,
    takeProfitAudit,
    riskCalibration,
    positionSizingAudit,
    limitCalibration,
    leverageCalibration,
    missedOpportunityAudit,
    thresholdCalibration,
    closedCount: closed.length,
  });

  return {
    summary,
    tradeQuality,
    stopLossAudit,
    takeProfitAudit,
    riskCalibration,
    positionSizingAudit,
    limitCalibration,
    leverageCalibration,
    missedOpportunityAudit,
    thresholdCalibration,
    meta: {
      tradeCount: filtered.length,
      closedTradeCount: closed.length,
      openTradeCount: open.length,
      mode,
      analyzedAt: new Date().toISOString(),
    },
  };
}

interface SummaryCtx {
  tradeMode: TradeMode;
  tradeQuality: ReturnType<typeof reviewTradeQualityBatch>;
  stopLossAudit: ReturnType<typeof auditStopLossBatch>;
  takeProfitAudit: ReturnType<typeof auditTakeProfitBatch>;
  riskCalibration: ReturnType<typeof calibrateRisk>;
  positionSizingAudit: ReturnType<typeof auditPositionSizing>;
  limitCalibration: ReturnType<typeof calibrateLimits>;
  leverageCalibration: ReturnType<typeof calibrateLeverage>;
  missedOpportunityAudit: ReturnType<typeof auditMissedOpportunities>;
  thresholdCalibration: ReturnType<typeof calibrateThreshold>;
  closedCount: number;
}

function buildSummary(ctx: SummaryCtx): TradeAuditSummary {
  const { tradeMode, closedCount } = ctx;

  if (closedCount < 3) {
    return {
      status: "DATA_INSUFFICIENT",
      tradeMode,
      mainFinding: "Yeterli kapanan işlem verisi yok. Analiz bekliyor.",
      riskFinding: ctx.riskCalibration.mainFinding,
      stopLossFinding: "Yeterli veri yok.",
      positionSizingFinding: "Yeterli veri yok.",
      thresholdFinding: "70 eşiği korunuyor.",
      missedOpportunityFinding: ctx.missedOpportunityAudit.mainFinding,
      leverageFinding: "Yeterli veri yok.",
      recommendation: "Bot çalışmaya devam ettikçe veri birikiyor; tekrar kontrol edin.",
      actionType: "DATA_INSUFFICIENT",
      confidence: 0,
      requiresUserApproval: false,
      observeDays: 7,
      appliedToTradeEngine: false,
    };
  }

  const criticalSL = ctx.stopLossAudit.filter((r) => r.severity === "critical").length;
  const criticalTP = ctx.takeProfitAudit.filter((r) => r.severity === "critical").length;
  const criticalQuality = ctx.tradeQuality.filter((r) => r.severity === "critical").length;
  const positionCritical = ctx.positionSizingAudit.severity === "critical";
  const riskCritical = ctx.riskCalibration.severity === "critical";
  const leverageCritical = ctx.leverageCalibration.severity === "critical";

  const totalCritical = criticalSL + criticalTP + criticalQuality +
    (positionCritical ? 1 : 0) + (riskCritical ? 1 : 0) + (leverageCritical ? 1 : 0);

  const warnSL = ctx.stopLossAudit.filter((r) => r.severity === "warning").length;
  const warnTP = ctx.takeProfitAudit.filter((r) => r.severity === "warning").length;
  const warnQuality = ctx.tradeQuality.filter((r) => r.severity === "warning").length;
  const positionWarn = ctx.positionSizingAudit.severity === "warning";
  const riskWarn = ctx.riskCalibration.severity === "warning";
  const limitWarn = ctx.limitCalibration.severity === "warning";
  const leverageWarn = ctx.leverageCalibration.severity === "warning";

  const totalWarning = warnSL + warnTP + warnQuality +
    (positionWarn ? 1 : 0) + (riskWarn ? 1 : 0) + (limitWarn ? 1 : 0) + (leverageWarn ? 1 : 0);

  let status: TradeAuditSummary["status"];
  let actionType: AuditActionType;

  if (totalCritical >= 2) {
    status = "ATTENTION_NEEDED";
    actionType = determineAction(ctx);
  } else if (totalCritical >= 1 || totalWarning >= 3) {
    status = "WATCH";
    actionType = determineAction(ctx);
  } else if (totalWarning >= 1) {
    status = "WATCH";
    actionType = "OBSERVE";
  } else {
    status = "HEALTHY";
    actionType = "NO_ACTION";
  }

  const confidence = Math.min(100, Math.round(
    (closedCount / 20) * 60 +
    (totalCritical === 0 && totalWarning === 0 ? 40 : totalCritical === 0 ? 20 : 0),
  ));

  const stopLossTag = ctx.stopLossAudit.filter((r) => r.tag !== "NORMAL_STOP" && r.tag !== "DATA_INSUFFICIENT")[0]?.tag;
  const stopLossFinding = warnSL + criticalSL > 0
    ? `${warnSL + criticalSL} işlemde SL sorunu saptandı${stopLossTag ? ` (${stopLossTag})` : ""}.`
    : "SL denetimi normal.";

  return {
    status,
    tradeMode,
    mainFinding: buildMainFinding(status, totalCritical, totalWarning, closedCount),
    riskFinding: ctx.riskCalibration.mainFinding,
    stopLossFinding,
    positionSizingFinding: ctx.positionSizingAudit.mainFinding,
    thresholdFinding: ctx.thresholdCalibration.mainFinding,
    missedOpportunityFinding: ctx.missedOpportunityAudit.mainFinding,
    leverageFinding: ctx.leverageCalibration.mainFinding,
    recommendation: buildRecommendation(status, actionType),
    actionType,
    confidence,
    requiresUserApproval: status === "ATTENTION_NEEDED",
    observeDays: 7,
    appliedToTradeEngine: false,
  };
}

function determineAction(ctx: SummaryCtx): AuditActionType {
  if (
    ctx.positionSizingAudit.tag === "STOP_DISTANCE_INFLATED_NOTIONAL" ||
    ctx.positionSizingAudit.tag === "POSITION_SIZE_TOO_LARGE"
  ) return "REVIEW_POSITION_SIZE";
  if (ctx.riskCalibration.tag === "REDUCE_RISK" || ctx.riskCalibration.tag === "REVIEW_DAILY_LOSS") {
    return "REVIEW_RISK";
  }
  if (ctx.stopLossAudit.some((r) => r.severity === "critical")) return "REVIEW_STOP_LOSS";
  if (ctx.leverageCalibration.tag === "BLOCK_30X") return "REVIEW_LEVERAGE";
  if (ctx.limitCalibration.tag === "OVERTRADE_RISK") return "REVIEW_LIMITS";
  if (ctx.thresholdCalibration.tag === "REVIEW_THRESHOLD_LATER") return "REVIEW_THRESHOLD";
  return "OBSERVE";
}

function buildMainFinding(
  status: TradeAuditSummary["status"],
  critical: number,
  warning: number,
  closedCount: number,
): string {
  if (status === "ATTENTION_NEEDED") {
    return `${closedCount} kapatılan işlemde ${critical} kritik, ${warning} uyarı bulgular saptandı.`;
  }
  if (status === "WATCH") {
    return `${closedCount} işlem analiz edildi. ${warning} uyarı noktası gözlem gerektiriyor.`;
  }
  return `${closedCount} kapatılan işlem analiz edildi. Önemli sorun saptanmadı.`;
}

function buildRecommendation(
  status: TradeAuditSummary["status"],
  actionType: AuditActionType,
): string {
  const actionText: Record<AuditActionType, string> = {
    NO_ACTION: "Mevcut stratejiyi koruyun. Gözleme devam edin.",
    OBSERVE: "7 gün boyunca sonuçları izleyin.",
    REVIEW_RISK: "Risk yüzdesini ve günlük zarar sınırını gözden geçirin.",
    REVIEW_STOP_LOSS: "Stop-loss seviyelerini ve mesafelerini değerlendirin.",
    REVIEW_POSITION_SIZE: "Pozisyon büyüklüğü hesabını ve SL mesafelerini kontrol edin.",
    REVIEW_LIMITS: "Max açık pozisyon ve günlük işlem limitlerini gözden geçirin.",
    REVIEW_LEVERAGE: "Kaldıraç aralıklarını ve 30x kullanımını değerlendirin.",
    REVIEW_THRESHOLD: "Sinyal eşiği performansını 7 gün daha gözlemleyin.",
    DATA_INSUFFICIENT: "Daha fazla işlem birikmesi bekleniyor.",
  };
  return `[${status}] ${actionText[actionType]}`;
}
