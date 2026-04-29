// Faz 23 — Live Readiness Summary.
// Tüm kategori check'lerini birleştirip üst seviye karar üretir.
// Live gate değerlerini DEĞİŞTİRMEZ.

import type {
  LiveReadinessInput,
  LiveReadinessSummary,
  ReadinessCheck,
  ReadinessNextAction,
  ReadinessStatus,
} from "./types";
import {
  checkPaperPerformance,
  checkRiskCalibration,
  checkTradeAudit,
  checkBinanceCredentials,
  checkApiSecurity,
  checkExecutionSafety,
  checkWebsocketReconciliation,
  checkSystemHealth,
  checkUserApproval,
} from "./checks";

export function buildLiveReadinessSummary(input: LiveReadinessInput): LiveReadinessSummary {
  const checks: ReadinessCheck[] = [
    ...checkPaperPerformance(input.paperPerformance),
    ...checkRiskCalibration(input.riskCalibration),
    ...checkTradeAudit(input.tradeAudit),
    ...checkBinanceCredentials(input.binanceCredentials),
    ...checkApiSecurity(input.apiSecurity),
    ...checkExecutionSafety(input.executionSafety),
    ...checkWebsocketReconciliation(input.websocketReconciliation),
    ...checkSystemHealth(input.systemHealth),
    ...checkUserApproval(input.userApproval),
  ];

  const blocking = checks.filter((c) => c.blocking);
  const warnings = checks.filter((c) => c.status === "warning" && !c.blocking);
  const passes = checks.filter((c) => c.status === "pass");

  // Skor: pass / total
  const total = checks.length;
  const readinessScore = total > 0 ? Math.round((passes.length / total) * 100) : 0;

  // Status hesabı:
  //  - Herhangi bir blocking → NOT_READY
  //  - Blocking yok ama warning var → OBSERVE
  //  - Blocking ve warning yok → READY (informational pending non-blocking
  //    check'ler READY'yi engellemez)
  let readinessStatus: ReadinessStatus;
  if (blocking.length > 0) {
    readinessStatus = "NOT_READY";
  } else if (warnings.length > 0) {
    readinessStatus = "OBSERVE";
  } else {
    readinessStatus = "READY";
  }

  // Main blocking reason — ilk kritik blocker
  const firstCritical = blocking.find((c) => c.severity === "critical") ?? blocking[0];
  const mainBlockingReason = firstCritical
    ? firstCritical.message
    : warnings[0]?.message ?? "Tüm kontroller geçti — final manuel aktivasyon kullanıcı sorumluluğunda.";

  // Next action belirleme
  const nextRequiredAction = determineNextAction(blocking, warnings, readinessStatus);

  return {
    readinessStatus,
    readinessScore,
    blockingIssuesCount: blocking.length,
    warningIssuesCount: warnings.length,
    mainBlockingReason,
    nextRequiredAction,
    checks,
    generatedAt: new Date().toISOString(),
    liveGateUnchanged: true,
    appliedToTradeEngine: false,
  };
}

function determineNextAction(
  blocking: ReadinessCheck[],
  warnings: ReadinessCheck[],
  status: ReadinessStatus,
): ReadinessNextAction {
  // Sırasıyla en önemli aksiyona göre belirle
  if (blocking.some((c) => c.id === "paper.min_trades" || c.id === "paper.metrics_insufficient")) {
    return "COMPLETE_PAPER_TRADES";
  }
  if (blocking.some((c) => c.category === "BINANCE_CREDENTIALS" || c.category === "API_SECURITY")) {
    return "FIX_API_SECURITY";
  }
  if (blocking.some((c) => c.category === "RISK_CALIBRATION" || c.category === "TRADE_AUDIT")) {
    return "FIX_RISK_CALIBRATION";
  }
  if (blocking.some((c) => c.category === "WEBSOCKET_RECONCILIATION")) {
    return "FIX_WEBSOCKET";
  }
  if (blocking.some((c) => c.category === "SYSTEM_HEALTH")) {
    return "FIX_SYSTEM_HEALTH";
  }
  if (blocking.some((c) => c.category === "USER_APPROVAL")) {
    return "AWAIT_USER_APPROVAL";
  }
  if (status === "OBSERVE") {
    return "OBSERVE_MORE_DAYS";
  }
  if (status === "READY") {
    return "MANUAL_FINAL_ACTIVATION";
  }
  return "DATA_INSUFFICIENT";
}
