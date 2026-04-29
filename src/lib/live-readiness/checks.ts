// Faz 23 — Live Readiness check fonksiyonları.
// Hepsi saf (pure) fonksiyondur. Live gate değiştirmez.

import type {
  ReadinessCheck,
  PaperPerformanceInput,
  RiskCalibrationInput,
  TradeAuditInput,
  BinanceCredentialsInput,
  ApiSecurityInput,
  ExecutionSafetyInput,
  WebsocketReconciliationInput,
  SystemHealthInput,
  UserApprovalInput,
} from "./types";
import {
  MIN_PAPER_TRADES_FOR_LIVE,
  MIN_WIN_RATE_PERCENT,
  MIN_PROFIT_FACTOR,
  MAX_DRAWDOWN_PERCENT,
  MAX_CONSECUTIVE_LOSSES,
} from "./types";
import { EXPECTED_VPS_IP } from "@/lib/binance-credentials/types";

// ── PAPER PERFORMANCE ────────────────────────────────────────────────────────
export function checkPaperPerformance(input: PaperPerformanceInput): ReadinessCheck[] {
  const out: ReadinessCheck[] = [];

  // Minimum 100 paper trade — blocker
  if (input.closedTradeCount < MIN_PAPER_TRADES_FOR_LIVE) {
    out.push({
      id: "paper.min_trades",
      category: "PAPER_PERFORMANCE",
      title: "Minimum kapanmış paper trade sayısı",
      status: input.closedTradeCount === 0 ? "pending" : "fail",
      severity: "critical",
      message: `Canlıya geçiş için en az ${MIN_PAPER_TRADES_FOR_LIVE} kapanmış paper trade gerekir.`,
      evidence: `Şu anda kapanan: ${input.closedTradeCount}/${MIN_PAPER_TRADES_FOR_LIVE}.`,
      blocking: true,
    });
  } else {
    out.push({
      id: "paper.min_trades",
      category: "PAPER_PERFORMANCE",
      title: "Minimum kapanmış paper trade sayısı",
      status: "pass",
      severity: "info",
      message: "Minimum paper trade şartı sağlandı.",
      evidence: `Kapanan: ${input.closedTradeCount} ≥ ${MIN_PAPER_TRADES_FOR_LIVE}.`,
      blocking: false,
    });
  }

  // Win rate
  if (input.closedTradeCount >= 20) {
    const wrPass = input.winRatePercent >= MIN_WIN_RATE_PERCENT;
    out.push({
      id: "paper.win_rate",
      category: "PAPER_PERFORMANCE",
      title: "Win rate eşiği",
      status: wrPass ? "pass" : "fail",
      severity: wrPass ? "info" : "warning",
      message: wrPass ? "Win rate kabul edilebilir." : "Win rate canlıya geçiş için düşük.",
      evidence: `Win rate: %${input.winRatePercent.toFixed(1)} (gerekli ≥%${MIN_WIN_RATE_PERCENT}).`,
      blocking: !wrPass && input.closedTradeCount >= MIN_PAPER_TRADES_FOR_LIVE,
    });

    // Profit factor
    const pfPass = input.profitFactor >= MIN_PROFIT_FACTOR;
    out.push({
      id: "paper.profit_factor",
      category: "PAPER_PERFORMANCE",
      title: "Profit factor eşiği",
      status: pfPass ? "pass" : "fail",
      severity: pfPass ? "info" : "warning",
      message: pfPass ? "Profit factor kabul edilebilir." : "Profit factor canlıya geçiş için düşük.",
      evidence: `PF: ${input.profitFactor.toFixed(2)} (gerekli ≥${MIN_PROFIT_FACTOR.toFixed(2)}).`,
      blocking: !pfPass && input.closedTradeCount >= MIN_PAPER_TRADES_FOR_LIVE,
    });

    // Max drawdown
    const ddPass = input.maxDrawdownPercent <= MAX_DRAWDOWN_PERCENT;
    out.push({
      id: "paper.drawdown",
      category: "PAPER_PERFORMANCE",
      title: "Maksimum drawdown",
      status: ddPass ? "pass" : "fail",
      severity: ddPass ? "info" : "critical",
      message: ddPass ? "Drawdown kabul edilebilir." : "Drawdown limiti aşıldı.",
      evidence: `Maks DD: %${input.maxDrawdownPercent.toFixed(1)} (limit ≤%${MAX_DRAWDOWN_PERCENT}).`,
      blocking: !ddPass,
    });

    // Consecutive losses
    const clPass = input.consecutiveLosses <= MAX_CONSECUTIVE_LOSSES;
    out.push({
      id: "paper.consecutive_losses",
      category: "PAPER_PERFORMANCE",
      title: "Ardışık kayıp",
      status: clPass ? "pass" : "warning",
      severity: clPass ? "info" : "warning",
      message: clPass ? "Ardışık kayıp limit içinde." : "Ardışık kayıp serisi yüksek.",
      evidence: `Maks ardışık kayıp: ${input.consecutiveLosses} (limit ≤${MAX_CONSECUTIVE_LOSSES}).`,
      blocking: false,
    });
  } else if (input.closedTradeCount > 0) {
    out.push({
      id: "paper.metrics_insufficient",
      category: "PAPER_PERFORMANCE",
      title: "Performans metriği için veri yetersiz",
      status: "pending",
      severity: "info",
      message: "Performans metrikleri en az 20 işlem sonrasında değerlendirilir.",
      evidence: `Kapanan: ${input.closedTradeCount}/20.`,
      blocking: true,
    });
  }

  return out;
}

// ── RISK CALIBRATION ─────────────────────────────────────────────────────────
export function checkRiskCalibration(input: RiskCalibrationInput): ReadinessCheck[] {
  const out: ReadinessCheck[] = [];

  // averageDownEnabled invariant
  if (input.averageDownEnabled !== false) {
    out.push({
      id: "risk.average_down_locked",
      category: "RISK_CALIBRATION",
      title: "Zararda büyütme kilidi",
      status: "fail",
      severity: "critical",
      message: "averageDownEnabled invariantı bozulmuş — canlıya geçiş engellenir.",
      evidence: `averageDownEnabled=${input.averageDownEnabled}.`,
      blocking: true,
    });
  } else {
    out.push({
      id: "risk.average_down_locked",
      category: "RISK_CALIBRATION",
      title: "Zararda büyütme kilidi",
      status: "pass",
      severity: "info",
      message: "Zararda büyütme kapalı (invariant korunuyor).",
      evidence: "averageDownEnabled=false.",
      blocking: false,
    });
  }

  // leverageExecutionBound invariant — true olmamalı (henüz canlıya hazır değil)
  if (input.leverageExecutionBound !== false) {
    out.push({
      id: "risk.leverage_execution",
      category: "RISK_CALIBRATION",
      title: "Kaldıraç execution durumu",
      status: "fail",
      severity: "critical",
      message: "Kaldıraç execution invariantı bozulmuş.",
      evidence: `leverageExecutionBound=${input.leverageExecutionBound}.`,
      blocking: true,
    });
  } else {
    out.push({
      id: "risk.leverage_execution",
      category: "RISK_CALIBRATION",
      title: "Kaldıraç execution durumu",
      status: "pass",
      severity: "info",
      message: "Kaldıraç execution bağlı değil (invariant korunuyor).",
      evidence: "leverageExecutionBound=false.",
      blocking: false,
    });
  }

  // Risk yüzdesi makul mü
  const riskHigh = input.riskPerTradePercent > 5;
  out.push({
    id: "risk.per_trade_percent",
    category: "RISK_CALIBRATION",
    title: "İşlem başı risk %",
    status: riskHigh ? "fail" : "pass",
    severity: riskHigh ? "critical" : "info",
    message: riskHigh
      ? "İşlem başı risk %5'in üzerinde — canlıya geçiş için yüksek."
      : "Risk yüzdesi kabul edilebilir.",
    evidence: `riskPerTradePercent: %${input.riskPerTradePercent}.`,
    blocking: riskHigh,
  });

  // Günlük max loss makul mü
  const dailyHigh = input.dailyMaxLossPercent > 15;
  out.push({
    id: "risk.daily_max_loss",
    category: "RISK_CALIBRATION",
    title: "Günlük maksimum zarar %",
    status: dailyHigh ? "fail" : "pass",
    severity: dailyHigh ? "warning" : "info",
    message: dailyHigh
      ? "Günlük maksimum zarar %15'in üzerinde."
      : "Günlük zarar limiti makul.",
    evidence: `dailyMaxLossPercent: %${input.dailyMaxLossPercent}.`,
    blocking: dailyHigh,
  });

  // Sermaye eksik mi (capital missing fallback)
  if (input.totalBotCapitalUsdt <= 0) {
    out.push({
      id: "risk.capital_missing",
      category: "RISK_CALIBRATION",
      title: "Toplam sermaye tanımı",
      status: "fail",
      severity: "critical",
      message: "Toplam sermaye tanımlı değil — pozisyon boyutu fallback'e düşer.",
      evidence: `totalBotCapitalUsdt: ${input.totalBotCapitalUsdt}.`,
      blocking: true,
    });
  } else {
    out.push({
      id: "risk.capital_missing",
      category: "RISK_CALIBRATION",
      title: "Toplam sermaye tanımı",
      status: "pass",
      severity: "info",
      message: "Toplam sermaye tanımlı.",
      evidence: `totalBotCapitalUsdt: ${input.totalBotCapitalUsdt} USDT.`,
      blocking: false,
    });
  }

  // 30x konfigüre ise warning
  if (input.has30xConfigured) {
    out.push({
      id: "risk.leverage_30x",
      category: "RISK_CALIBRATION",
      title: "30x kaldıraç konfigürasyonu",
      status: "warning",
      severity: "warning",
      message: "30x kaldıraç konfigürasyonda var — yüksek risk.",
      evidence: "leverageRanges içinde max ≥ 30x bucket bulunuyor.",
      blocking: false,
    });
  }

  return out;
}

// ── TRADE AUDIT ──────────────────────────────────────────────────────────────
export function checkTradeAudit(input: TradeAuditInput): ReadinessCheck[] {
  const out: ReadinessCheck[] = [];

  if (input.status === "DATA_INSUFFICIENT") {
    out.push({
      id: "audit.status",
      category: "TRADE_AUDIT",
      title: "Trade Audit durumu",
      status: "pending",
      severity: "info",
      message: "Trade audit henüz yeterli veriyle çalışmadı.",
      evidence: "Audit status: DATA_INSUFFICIENT.",
      blocking: true,
    });
    return out;
  }

  if (input.criticalCount > 0) {
    out.push({
      id: "audit.critical",
      category: "TRADE_AUDIT",
      title: "Kritik audit bulguları",
      status: "fail",
      severity: "critical",
      message: "Trade audit kritik bulgu(lar) saptadı — canlıya geçiş engellenir.",
      evidence: `Kritik: ${input.criticalCount}, Uyarı: ${input.warningCount}.`,
      blocking: true,
    });
  } else {
    out.push({
      id: "audit.critical",
      category: "TRADE_AUDIT",
      title: "Kritik audit bulguları",
      status: "pass",
      severity: "info",
      message: "Kritik audit bulgusu yok.",
      evidence: `Kritik: 0, Uyarı: ${input.warningCount}.`,
      blocking: false,
    });
  }

  if (input.positionSizingInflated) {
    out.push({
      id: "audit.position_sizing_inflated",
      category: "TRADE_AUDIT",
      title: "Pozisyon boyutu şişmesi",
      status: "fail",
      severity: "critical",
      message: "SL mesafesi pozisyon notional'ini şişiriyor.",
      evidence: "STOP_DISTANCE_INFLATED_NOTIONAL etiketi audit raporunda.",
      blocking: true,
    });
  }

  return out;
}

// ── BINANCE CREDENTIALS ──────────────────────────────────────────────────────
export function checkBinanceCredentials(input: BinanceCredentialsInput): ReadinessCheck[] {
  const out: ReadinessCheck[] = [];

  const hasKeys = input.apiKeyPresent && input.apiSecretPresent;
  out.push({
    id: "creds.presence",
    category: "BINANCE_CREDENTIALS",
    title: "API key/secret mevcut",
    status: hasKeys ? "pass" : "fail",
    severity: hasKeys ? "info" : "critical",
    message: hasKeys ? "API kimlik bilgileri mevcut." : "API key veya secret eksik.",
    evidence: `apiKeyPresent=${input.apiKeyPresent}, apiSecretPresent=${input.apiSecretPresent}.`,
    blocking: !hasKeys,
  });

  if (hasKeys) {
    out.push({
      id: "creds.futures_access",
      category: "BINANCE_CREDENTIALS",
      title: "Futures read erişimi",
      status: input.futuresAccessOk && input.accountReadOk ? "pass" : "fail",
      severity: input.futuresAccessOk && input.accountReadOk ? "info" : "critical",
      message: input.futuresAccessOk && input.accountReadOk
        ? "Futures public + account read erişimi onaylandı."
        : "Futures erişimi başarısız — credential / IP / izin kontrolü gerekir.",
      evidence: input.permissionError
        ? `Hata: ${input.permissionError}`
        : `futuresAccessOk=${input.futuresAccessOk}, accountReadOk=${input.accountReadOk}.`,
      blocking: !(input.futuresAccessOk && input.accountReadOk),
    });
  }

  return out;
}

// ── API SECURITY ─────────────────────────────────────────────────────────────
export function checkApiSecurity(input: ApiSecurityInput): ReadinessCheck[] {
  const out: ReadinessCheck[] = [];
  const c = input.checklist;

  const items: Array<{ id: string; field: keyof typeof c; label: string }> = [
    { id: "withdraw_disabled", field: "withdrawPermissionDisabled", label: "Withdraw izni kapalı" },
    { id: "ip_restriction", field: "ipRestrictionConfigured", label: "IP kısıtlaması yapılandırılmış" },
    { id: "futures_permission", field: "futuresPermissionConfirmed", label: "Futures izni onaylandı" },
    { id: "extra_permissions", field: "extraPermissionsReviewed", label: "Ek izinler gözden geçirildi" },
  ];

  for (const it of items) {
    const state = c[it.field] as "unknown" | "confirmed" | "failed";
    const isConfirmed = state === "confirmed";
    const isFailed = state === "failed";
    out.push({
      id: `security.${it.id}`,
      category: "API_SECURITY",
      title: it.label,
      status: isConfirmed ? "pass" : isFailed ? "fail" : "pending",
      severity: isFailed ? "critical" : isConfirmed ? "info" : "warning",
      message: isConfirmed
        ? `${it.label}: onaylandı.`
        : isFailed
        ? `${it.label}: başarısız — düzeltilmeden canlıya geçilmez.`
        : `${it.label}: henüz onaylanmadı.`,
      evidence: `state=${state}.`,
      blocking: !isConfirmed,
    });
  }

  out.push({
    id: "security.expected_vps_ip",
    category: "API_SECURITY",
    title: "VPS IP doğrulama",
    status: input.recommendedVpsIp === EXPECTED_VPS_IP ? "pass" : "warning",
    severity: "info",
    message: `Önerilen VPS IP: ${input.recommendedVpsIp}.`,
    evidence: `EXPECTED_VPS_IP=${EXPECTED_VPS_IP}.`,
    blocking: false,
  });

  return out;
}

// ── EXECUTION SAFETY ─────────────────────────────────────────────────────────
export function checkExecutionSafety(input: ExecutionSafetyInput): ReadinessCheck[] {
  const out: ReadinessCheck[] = [];

  // openLiveOrder hâlâ NOT_IMPLEMENTED — bu fazda zorunlu invariant
  out.push({
    id: "exec.open_live_order_not_implemented",
    category: "EXECUTION_SAFETY",
    title: "openLiveOrder durumu",
    status: input.openLiveOrderImplemented === false ? "pass" : "fail",
    severity: input.openLiveOrderImplemented === false ? "info" : "critical",
    message: input.openLiveOrderImplemented === false
      ? "openLiveOrder hâlâ LIVE_EXECUTION_NOT_IMPLEMENTED — invariant korunuyor."
      : "openLiveOrder gerçek emir gönderecek şekilde değiştirilmiş — kritik kural ihlali.",
    evidence: `openLiveOrderImplemented=${input.openLiveOrderImplemented}.`,
    blocking: input.openLiveOrderImplemented !== false,
  });

  // Triple-gate kapalı kalmalı
  const tripleGateClosed = !input.hardLiveTradingAllowed
    && !input.enableLiveTrading
    && input.defaultTradingMode === "paper";

  out.push({
    id: "exec.triple_gate",
    category: "EXECUTION_SAFETY",
    title: "Live execution triple-gate durumu",
    status: tripleGateClosed ? "pass" : "warning",
    severity: tripleGateClosed ? "info" : "warning",
    message: tripleGateClosed
      ? "Triple-gate kapalı — bu fazda canlı execution güvenli şekilde bloke."
      : "Triple-gate kısmen açık — final aktivasyon manuel olarak doğrulanmalı.",
    evidence: `hardLiveAllowed=${input.hardLiveTradingAllowed}, enableLive=${input.enableLiveTrading}, defaultMode=${input.defaultTradingMode}.`,
    blocking: false,
  });

  // Bilgilendirme: bu fazda canlı execution kapalı kalır
  out.push({
    id: "exec.activation_pending",
    category: "EXECUTION_SAFETY",
    title: "Final canlı aktivasyon",
    status: "pending",
    severity: "info",
    message: "Canlı execution henüz aktif değil; final aktivasyon ayrı manuel adımdır.",
    evidence: "openLiveOrder=NOT_IMPLEMENTED + manuel kullanıcı aktivasyonu beklenir.",
    blocking: false,
  });

  // liveExecutionBound / leverageExecutionBound korunmalı
  out.push({
    id: "exec.bindings",
    category: "EXECUTION_SAFETY",
    title: "Execution binding invariant'ları",
    status: input.liveExecutionBound === false && input.leverageExecutionBound === false ? "pass" : "fail",
    severity: input.liveExecutionBound === false && input.leverageExecutionBound === false ? "info" : "critical",
    message: input.liveExecutionBound === false && input.leverageExecutionBound === false
      ? "liveExecutionBound ve leverageExecutionBound bağlı değil (invariant korunuyor)."
      : "Execution binding invariant'ları ihlal edilmiş.",
    evidence: `liveExecutionBound=${input.liveExecutionBound}, leverageExecutionBound=${input.leverageExecutionBound}.`,
    blocking: !(input.liveExecutionBound === false && input.leverageExecutionBound === false),
  });

  return out;
}

// ── WEBSOCKET / RECONCILIATION ───────────────────────────────────────────────
export function checkWebsocketReconciliation(input: WebsocketReconciliationInput): ReadinessCheck[] {
  const out: ReadinessCheck[] = [];

  const wsStatus = input.marketFeed.websocketStatus;
  const isConnected = wsStatus === "connected";
  const isDisconnected = wsStatus === "disconnected";

  out.push({
    id: "ws.status",
    category: "WEBSOCKET_RECONCILIATION",
    title: "WebSocket bağlantı durumu",
    status: isConnected ? "pass" : isDisconnected ? "warning" : "pending",
    severity: isConnected ? "info" : "warning",
    message: isConnected
      ? "WebSocket bağlantısı aktif."
      : isDisconnected
      ? "WebSocket bağlantısı yok — canlı fiyat/pozisyon takibi engellenir."
      : `WebSocket durumu: ${wsStatus}.`,
    evidence: `websocketStatus=${wsStatus}, feedMode=${input.marketFeed.feedMode}, stale=${input.marketFeed.stale}.`,
    // WS disconnected → blocking
    blocking: isDisconnected,
  });

  out.push({
    id: "ws.reconciliation_safe",
    category: "WEBSOCKET_RECONCILIATION",
    title: "Reconciliation loop güvenliği",
    status: input.reconciliationLoopSafe ? "pass" : "warning",
    severity: input.reconciliationLoopSafe ? "info" : "warning",
    message: input.reconciliationLoopSafe
      ? "Reconciliation loop fail-closed/no-op invariant'ları korunuyor."
      : "Reconciliation loop güvenliği teyit edilemedi.",
    evidence: `reconciliationLoopSafe=${input.reconciliationLoopSafe}.`,
    blocking: false,
  });

  out.push({
    id: "ws.duplicate_guard",
    category: "WEBSOCKET_RECONCILIATION",
    title: "Duplicate position guard",
    status: input.duplicateGuardAvailable ? "pass" : "fail",
    severity: input.duplicateGuardAvailable ? "info" : "warning",
    message: input.duplicateGuardAvailable
      ? "Duplicate-position guard mevcut."
      : "Duplicate-position guard eksik.",
    evidence: `duplicateGuardAvailable=${input.duplicateGuardAvailable}.`,
    blocking: !input.duplicateGuardAvailable,
  });

  out.push({
    id: "ws.client_order_id_guard",
    category: "WEBSOCKET_RECONCILIATION",
    title: "clientOrderId guard",
    status: input.clientOrderIdGuardAvailable ? "pass" : "fail",
    severity: input.clientOrderIdGuardAvailable ? "info" : "warning",
    message: input.clientOrderIdGuardAvailable
      ? "clientOrderId benzersizlik guard'ı mevcut."
      : "clientOrderId guard eksik.",
    evidence: `clientOrderIdGuardAvailable=${input.clientOrderIdGuardAvailable}.`,
    blocking: !input.clientOrderIdGuardAvailable,
  });

  return out;
}

// ── SYSTEM HEALTH ────────────────────────────────────────────────────────────
export function checkSystemHealth(input: SystemHealthInput): ReadinessCheck[] {
  const out: ReadinessCheck[] = [];

  out.push({
    id: "sys.worker_online",
    category: "SYSTEM_HEALTH",
    title: "Worker heartbeat",
    status: input.workerOnline ? "pass" : "fail",
    severity: input.workerOnline ? "info" : "critical",
    message: input.workerOnline
      ? `Worker çevrimiçi (${input.workerStatus}).`
      : "Worker çevrimdışı — heartbeat eksik.",
    evidence: `workerOnline=${input.workerOnline}, lastHeartbeatAgeSec=${input.lastHeartbeatAgeSec}.`,
    blocking: !input.workerOnline,
  });

  out.push({
    id: "sys.diagnostics_fresh",
    category: "SYSTEM_HEALTH",
    title: "Diagnostics tazeliği",
    status: input.diagnosticsStale ? "fail" : "pass",
    severity: input.diagnosticsStale ? "warning" : "info",
    message: input.diagnosticsStale
      ? "Diagnostics verisi eski — son tick güncel değil."
      : "Diagnostics verisi güncel.",
    evidence: `diagnosticsStale=${input.diagnosticsStale}.`,
    blocking: input.diagnosticsStale,
  });

  if (input.tickSkipped) {
    out.push({
      id: "sys.tick_skipped",
      category: "SYSTEM_HEALTH",
      title: "Son tick durumu",
      status: "warning",
      severity: "warning",
      message: `Son tick atlandı: ${input.skipReason ?? "sebep belirtilmedi"}.`,
      evidence: `tickSkipped=true, skipReason=${input.skipReason}.`,
      blocking: false,
    });
  }

  if (input.tickError) {
    out.push({
      id: "sys.tick_error",
      category: "SYSTEM_HEALTH",
      title: "Son tick hatası",
      status: "fail",
      severity: "warning",
      message: `Son tick'te hata oluştu: ${input.tickError}.`,
      evidence: `tickError=${input.tickError}.`,
      blocking: false,
    });
  }

  out.push({
    id: "sys.worker_lock",
    category: "SYSTEM_HEALTH",
    title: "Worker lock sağlığı",
    status: input.workerLockHealthy ? "pass" : "fail",
    severity: input.workerLockHealthy ? "info" : "critical",
    message: input.workerLockHealthy
      ? "Worker lock sağlıklı (tek worker garantisi)."
      : "Worker lock sağlıksız.",
    evidence: `workerLockHealthy=${input.workerLockHealthy}.`,
    blocking: !input.workerLockHealthy,
  });

  return out;
}

// ── USER APPROVAL ────────────────────────────────────────────────────────────
export function checkUserApproval(input: UserApprovalInput): ReadinessCheck[] {
  const confirmed = input.userLiveApproval === "confirmed";
  return [{
    id: "user.live_approval",
    category: "USER_APPROVAL",
    title: "Kullanıcı canlı onayı",
    status: confirmed ? "pass" : "pending",
    severity: confirmed ? "info" : "warning",
    message: confirmed
      ? "Kullanıcı canlıya geçiş onayını verdi (kaydı). Final aktivasyon yine manuel."
      : "Canlıya geçiş için kullanıcı onayı bekleniyor (default pending).",
    evidence: `userLiveApproval=${input.userLiveApproval}.`,
    blocking: !confirmed,
  }];
}
