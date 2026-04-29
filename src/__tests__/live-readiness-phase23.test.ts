// Faz 23 — Live Readiness / Canlıya Geçiş Kontrolü test paketi.
//
// Bu testler şunları doğrular:
// - Minimum 100 paper trade şartı
// - API security checklist davranışı
// - WebSocket / system health blokları
// - Execution safety invariant'ları (openLiveOrder, triple-gate)
// - readinessStatus karar mantığı
// - Endpoint dosyasında /fapi/v1/order ve /fapi/v1/leverage YOK
// - Dashboard kartında canlı açma butonu YOK

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  buildLiveReadinessSummary,
  checkPaperPerformance,
  checkApiSecurity,
  checkBinanceCredentials,
  checkExecutionSafety,
  checkWebsocketReconciliation,
  checkSystemHealth,
  checkUserApproval,
  MIN_PAPER_TRADES_FOR_LIVE,
  type LiveReadinessInput,
} from "@/lib/live-readiness";
import { DEFAULT_CHECKLIST, EXPECTED_VPS_IP } from "@/lib/binance-credentials/types";
import { DEFAULT_FEED_STATUS } from "@/lib/market-feed/types";

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

// ── Yardımcılar ───────────────────────────────────────────────────────────────

function makeAllPassInput(): LiveReadinessInput {
  return {
    paperPerformance: {
      closedTradeCount: 120,
      winRatePercent: 60,
      averagePnlUsd: 5,
      maxDrawdownPercent: 5,
      profitFactor: 1.8,
      consecutiveLosses: 2,
    },
    riskCalibration: {
      riskPerTradePercent: 3,
      dailyMaxLossPercent: 10,
      totalBotCapitalUsdt: 1000,
      defaultMaxOpenPositions: 3,
      dynamicMaxOpenPositions: 5,
      maxDailyTrades: 10,
      averageDownEnabled: false,
      leverageExecutionBound: false,
      has30xConfigured: false,
    },
    tradeAudit: {
      criticalCount: 0,
      warningCount: 1,
      status: "HEALTHY",
      positionSizingInflated: false,
    },
    binanceCredentials: {
      apiKeyPresent: true,
      apiSecretPresent: true,
      futuresAccessOk: true,
      accountReadOk: true,
      permissionError: null,
    },
    apiSecurity: {
      checklist: {
        withdrawPermissionDisabled: "confirmed",
        ipRestrictionConfigured: "confirmed",
        futuresPermissionConfirmed: "confirmed",
        extraPermissionsReviewed: "confirmed",
        updatedAt: new Date().toISOString(),
      },
      recommendedVpsIp: EXPECTED_VPS_IP,
    },
    executionSafety: {
      hardLiveTradingAllowed: false,
      enableLiveTrading: false,
      defaultTradingMode: "paper",
      openLiveOrderImplemented: false,
      liveExecutionBound: false,
      leverageExecutionBound: false,
    },
    websocketReconciliation: {
      marketFeed: { ...DEFAULT_FEED_STATUS, websocketStatus: "connected", stale: false },
      reconciliationLoopSafe: true,
      duplicateGuardAvailable: true,
      clientOrderIdGuardAvailable: true,
    },
    systemHealth: {
      workerOnline: true,
      workerStatus: "running_paper",
      lastHeartbeatAgeSec: 5,
      binanceApiStatus: "ok",
      tickSkipped: false,
      skipReason: null,
      tickError: null,
      workerLockHealthy: true,
      diagnosticsStale: false,
    },
    userApproval: {
      userLiveApproval: "confirmed",
    },
  };
}

// ── Paper performance ─────────────────────────────────────────────────────────

describe("Paper Performance Checks", () => {
  it("100'den az paper trade ile READY olmaz (blocking)", () => {
    const checks = checkPaperPerformance({
      closedTradeCount: 50,
      winRatePercent: 60,
      averagePnlUsd: 5,
      maxDrawdownPercent: 3,
      profitFactor: 2,
      consecutiveLosses: 1,
    });
    const minTradesCheck = checks.find((c) => c.id === "paper.min_trades");
    expect(minTradesCheck).toBeDefined();
    expect(minTradesCheck!.blocking).toBe(true);
    expect(minTradesCheck!.status).toBe("fail");
  });

  it("0 paper trade pending döndürür", () => {
    const checks = checkPaperPerformance({
      closedTradeCount: 0,
      winRatePercent: 0,
      averagePnlUsd: 0,
      maxDrawdownPercent: 0,
      profitFactor: 0,
      consecutiveLosses: 0,
    });
    const minTradesCheck = checks.find((c) => c.id === "paper.min_trades");
    expect(minTradesCheck!.status).toBe("pending");
    expect(minTradesCheck!.blocking).toBe(true);
  });

  it("100+ paper trade min_trades pass döndürür", () => {
    const checks = checkPaperPerformance({
      closedTradeCount: 120,
      winRatePercent: 50,
      averagePnlUsd: 5,
      maxDrawdownPercent: 5,
      profitFactor: 1.5,
      consecutiveLosses: 2,
    });
    const minTradesCheck = checks.find((c) => c.id === "paper.min_trades");
    expect(minTradesCheck!.status).toBe("pass");
    expect(minTradesCheck!.blocking).toBe(false);
  });

  it("Drawdown limiti aşılırsa blocking üretir", () => {
    const checks = checkPaperPerformance({
      closedTradeCount: 120,
      winRatePercent: 50,
      averagePnlUsd: 5,
      maxDrawdownPercent: 25,
      profitFactor: 1.5,
      consecutiveLosses: 2,
    });
    const ddCheck = checks.find((c) => c.id === "paper.drawdown");
    expect(ddCheck!.blocking).toBe(true);
    expect(ddCheck!.severity).toBe("critical");
  });
});

// ── API security ──────────────────────────────────────────────────────────────

describe("API Security Checks", () => {
  it("Default checklist (unknown) READY olmaz — withdraw confirmed değil", () => {
    const checks = checkApiSecurity({
      checklist: DEFAULT_CHECKLIST,
      recommendedVpsIp: EXPECTED_VPS_IP,
    });
    const withdrawCheck = checks.find((c) => c.id === "security.withdraw_disabled");
    expect(withdrawCheck!.blocking).toBe(true);
    expect(withdrawCheck!.status).toBe("pending");
  });

  it("withdraw failed durumda blocking critical üretir", () => {
    const checks = checkApiSecurity({
      checklist: { ...DEFAULT_CHECKLIST, withdrawPermissionDisabled: "failed" },
      recommendedVpsIp: EXPECTED_VPS_IP,
    });
    const withdrawCheck = checks.find((c) => c.id === "security.withdraw_disabled");
    expect(withdrawCheck!.blocking).toBe(true);
    expect(withdrawCheck!.severity).toBe("critical");
    expect(withdrawCheck!.status).toBe("fail");
  });

  it("IP restriction confirmed değilse blocking", () => {
    const checks = checkApiSecurity({
      checklist: {
        withdrawPermissionDisabled: "confirmed",
        ipRestrictionConfigured: "unknown",
        futuresPermissionConfirmed: "confirmed",
        extraPermissionsReviewed: "confirmed",
        updatedAt: null,
      },
      recommendedVpsIp: EXPECTED_VPS_IP,
    });
    const ipCheck = checks.find((c) => c.id === "security.ip_restriction");
    expect(ipCheck!.blocking).toBe(true);
  });

  it("Tüm checklist confirmed ise tüm checkler pass", () => {
    const checks = checkApiSecurity({
      checklist: {
        withdrawPermissionDisabled: "confirmed",
        ipRestrictionConfigured: "confirmed",
        futuresPermissionConfirmed: "confirmed",
        extraPermissionsReviewed: "confirmed",
        updatedAt: new Date().toISOString(),
      },
      recommendedVpsIp: EXPECTED_VPS_IP,
    });
    const blocking = checks.filter((c) => c.blocking);
    expect(blocking).toHaveLength(0);
  });
});

// ── Binance credentials ───────────────────────────────────────────────────────

describe("Binance Credentials Checks", () => {
  it("API key/secret yoksa READY olmaz", () => {
    const checks = checkBinanceCredentials({
      apiKeyPresent: false,
      apiSecretPresent: false,
      futuresAccessOk: false,
      accountReadOk: false,
      permissionError: null,
    });
    const presenceCheck = checks.find((c) => c.id === "creds.presence");
    expect(presenceCheck!.blocking).toBe(true);
  });

  it("Futures erişimi başarısızsa blocking", () => {
    const checks = checkBinanceCredentials({
      apiKeyPresent: true,
      apiSecretPresent: true,
      futuresAccessOk: false,
      accountReadOk: false,
      permissionError: "ip_not_whitelisted",
    });
    const accessCheck = checks.find((c) => c.id === "creds.futures_access");
    expect(accessCheck!.blocking).toBe(true);
  });
});

// ── Execution safety ──────────────────────────────────────────────────────────

describe("Execution Safety Checks", () => {
  it("openLiveOrder=false (NOT_IMPLEMENTED) pass üretir", () => {
    const checks = checkExecutionSafety({
      hardLiveTradingAllowed: false,
      enableLiveTrading: false,
      defaultTradingMode: "paper",
      openLiveOrderImplemented: false,
      liveExecutionBound: false,
      leverageExecutionBound: false,
    });
    const openCheck = checks.find((c) => c.id === "exec.open_live_order_not_implemented");
    expect(openCheck!.status).toBe("pass");
    expect(openCheck!.blocking).toBe(false);
  });

  it("Triple-gate kapalıysa pass", () => {
    const checks = checkExecutionSafety({
      hardLiveTradingAllowed: false,
      enableLiveTrading: false,
      defaultTradingMode: "paper",
      openLiveOrderImplemented: false,
      liveExecutionBound: false,
      leverageExecutionBound: false,
    });
    const gateCheck = checks.find((c) => c.id === "exec.triple_gate");
    expect(gateCheck!.status).toBe("pass");
  });

  it("Activation pending check her zaman pending olmalı", () => {
    const checks = checkExecutionSafety({
      hardLiveTradingAllowed: false,
      enableLiveTrading: false,
      defaultTradingMode: "paper",
      openLiveOrderImplemented: false,
      liveExecutionBound: false,
      leverageExecutionBound: false,
    });
    const activationCheck = checks.find((c) => c.id === "exec.activation_pending");
    expect(activationCheck!.status).toBe("pending");
    expect(activationCheck!.blocking).toBe(false);
  });
});

// ── WebSocket / Reconciliation ────────────────────────────────────────────────

describe("WebSocket Reconciliation Checks", () => {
  it("WebSocket disconnected ise warning ve blocking", () => {
    const checks = checkWebsocketReconciliation({
      marketFeed: { ...DEFAULT_FEED_STATUS, websocketStatus: "disconnected" },
      reconciliationLoopSafe: true,
      duplicateGuardAvailable: true,
      clientOrderIdGuardAvailable: true,
    });
    const wsCheck = checks.find((c) => c.id === "ws.status");
    expect(wsCheck!.status).toBe("warning");
    expect(wsCheck!.blocking).toBe(true);
  });

  it("WebSocket connected ise pass", () => {
    const checks = checkWebsocketReconciliation({
      marketFeed: { ...DEFAULT_FEED_STATUS, websocketStatus: "connected", stale: false },
      reconciliationLoopSafe: true,
      duplicateGuardAvailable: true,
      clientOrderIdGuardAvailable: true,
    });
    const wsCheck = checks.find((c) => c.id === "ws.status");
    expect(wsCheck!.status).toBe("pass");
    expect(wsCheck!.blocking).toBe(false);
  });

  it("Duplicate guard yoksa blocking", () => {
    const checks = checkWebsocketReconciliation({
      marketFeed: { ...DEFAULT_FEED_STATUS, websocketStatus: "connected" },
      reconciliationLoopSafe: true,
      duplicateGuardAvailable: false,
      clientOrderIdGuardAvailable: true,
    });
    const dupCheck = checks.find((c) => c.id === "ws.duplicate_guard");
    expect(dupCheck!.blocking).toBe(true);
  });
});

// ── System health ─────────────────────────────────────────────────────────────

describe("System Health Checks", () => {
  it("Worker offline ise READY olmaz", () => {
    const checks = checkSystemHealth({
      workerOnline: false,
      workerStatus: "offline",
      lastHeartbeatAgeSec: 300,
      binanceApiStatus: "unknown",
      tickSkipped: false,
      skipReason: null,
      tickError: null,
      workerLockHealthy: false,
      diagnosticsStale: true,
    });
    const workerCheck = checks.find((c) => c.id === "sys.worker_online");
    expect(workerCheck!.blocking).toBe(true);
    expect(workerCheck!.severity).toBe("critical");
  });

  it("diagnosticsStale=true ise blocking", () => {
    const checks = checkSystemHealth({
      workerOnline: true,
      workerStatus: "running_paper",
      lastHeartbeatAgeSec: 300,
      binanceApiStatus: "ok",
      tickSkipped: false,
      skipReason: null,
      tickError: null,
      workerLockHealthy: true,
      diagnosticsStale: true,
    });
    const diagCheck = checks.find((c) => c.id === "sys.diagnostics_fresh");
    expect(diagCheck!.blocking).toBe(true);
  });

  it("Sağlıklı sistem hiç blocker üretmez", () => {
    const checks = checkSystemHealth({
      workerOnline: true,
      workerStatus: "running_paper",
      lastHeartbeatAgeSec: 5,
      binanceApiStatus: "ok",
      tickSkipped: false,
      skipReason: null,
      tickError: null,
      workerLockHealthy: true,
      diagnosticsStale: false,
    });
    const blocking = checks.filter((c) => c.blocking);
    expect(blocking).toHaveLength(0);
  });
});

// ── User approval ─────────────────────────────────────────────────────────────

describe("User Approval Checks", () => {
  it("Default pending — blocking üretir", () => {
    const checks = checkUserApproval({ userLiveApproval: "pending" });
    expect(checks[0].blocking).toBe(true);
    expect(checks[0].status).toBe("pending");
  });

  it("confirmed durumda blocker üretmez", () => {
    const checks = checkUserApproval({ userLiveApproval: "confirmed" });
    expect(checks[0].blocking).toBe(false);
    expect(checks[0].status).toBe("pass");
  });
});

// ── Trade audit ───────────────────────────────────────────────────────────────

describe("Trade Audit Checks", () => {
  it("Critical audit varsa READY olmaz", () => {
    const summary = buildLiveReadinessSummary({
      ...makeAllPassInput(),
      tradeAudit: {
        criticalCount: 2,
        warningCount: 0,
        status: "ATTENTION_NEEDED",
        positionSizingInflated: false,
      },
    });
    expect(summary.readinessStatus).toBe("NOT_READY");
    expect(summary.blockingIssuesCount).toBeGreaterThan(0);
  });
});

// ── Summary aggregation ───────────────────────────────────────────────────────

describe("Live Readiness Summary", () => {
  it("Blocking issue varsa readinessStatus READY olamaz", () => {
    const summary = buildLiveReadinessSummary({
      ...makeAllPassInput(),
      paperPerformance: {
        closedTradeCount: 50,
        winRatePercent: 60,
        averagePnlUsd: 5,
        maxDrawdownPercent: 3,
        profitFactor: 2,
        consecutiveLosses: 1,
      },
    });
    expect(summary.readinessStatus).toBe("NOT_READY");
  });

  it("Tüm şartlar pass ise READY dönebilir", () => {
    const summary = buildLiveReadinessSummary(makeAllPassInput());
    expect(summary.readinessStatus).toBe("READY");
  });

  it("READY durumunda bile live gate değerlerini değiştirmez", () => {
    const summary = buildLiveReadinessSummary(makeAllPassInput());
    expect(summary.liveGateUnchanged).toBe(true);
    expect(summary.appliedToTradeEngine).toBe(false);
  });

  it("nextRequiredAction COMPLETE_PAPER_TRADES — paper eksikse", () => {
    const summary = buildLiveReadinessSummary({
      ...makeAllPassInput(),
      paperPerformance: {
        closedTradeCount: 30,
        winRatePercent: 60,
        averagePnlUsd: 5,
        maxDrawdownPercent: 3,
        profitFactor: 2,
        consecutiveLosses: 1,
      },
    });
    expect(summary.nextRequiredAction).toBe("COMPLETE_PAPER_TRADES");
  });

  it("READY ise next action MANUAL_FINAL_ACTIVATION", () => {
    const summary = buildLiveReadinessSummary(makeAllPassInput());
    expect(summary.nextRequiredAction).toBe("MANUAL_FINAL_ACTIVATION");
  });

  it("OBSERVE durumunda OBSERVE_MORE_DAYS önerir", () => {
    const summary = buildLiveReadinessSummary({
      ...makeAllPassInput(),
      systemHealth: {
        workerOnline: true,
        workerStatus: "running_paper",
        lastHeartbeatAgeSec: 5,
        binanceApiStatus: "ok",
        tickSkipped: true,
        skipReason: "rate_limit",
        tickError: null,
        workerLockHealthy: true,
        diagnosticsStale: false,
      },
    });
    expect(summary.readinessStatus).toBe("OBSERVE");
    expect(summary.nextRequiredAction).toBe("OBSERVE_MORE_DAYS");
  });

  it("MIN_PAPER_TRADES_FOR_LIVE sabiti 100", () => {
    expect(MIN_PAPER_TRADES_FOR_LIVE).toBe(100);
  });

  it("100 paper trade şartı bypass edilemez", () => {
    // 100 altı her senaryoda blocking olmalı
    for (const count of [0, 25, 50, 75, 99]) {
      const checks = checkPaperPerformance({
        closedTradeCount: count,
        winRatePercent: 99,
        averagePnlUsd: 100,
        maxDrawdownPercent: 0,
        profitFactor: 99,
        consecutiveLosses: 0,
      });
      const minCheck = checks.find((c) => c.id === "paper.min_trades");
      expect(minCheck!.blocking).toBe(true);
    }
  });
});

// ── Endpoint / Dashboard güvenlik invariantları ───────────────────────────────

describe("Endpoint Read-only Invariants", () => {
  const ENDPOINT_PATH = path.join(
    PROJECT_ROOT,
    "src/app/api/live-readiness/status/route.ts",
  );

  it("Endpoint dosyası mevcut", () => {
    expect(fs.existsSync(ENDPOINT_PATH)).toBe(true);
  });

  it("Endpoint /fapi/v1/order çağrısı içermez", () => {
    const content = fs.readFileSync(ENDPOINT_PATH, "utf-8");
    expect(content).not.toMatch(/\/fapi\/v1\/order/);
  });

  it("Endpoint /fapi/v1/leverage çağrısı içermez", () => {
    const content = fs.readFileSync(ENDPOINT_PATH, "utf-8");
    expect(content).not.toMatch(/\/fapi\/v1\/leverage/);
  });

  it("Endpoint openLiveOrder import / call içermez", () => {
    const content = fs.readFileSync(ENDPOINT_PATH, "utf-8");
    expect(content).not.toMatch(/openLiveOrder\s*\(/);
  });

  it("Endpoint trading_mode veya enable_live_trading update etmez", () => {
    const content = fs.readFileSync(ENDPOINT_PATH, "utf-8");
    // .update({ trading_mode: ... }) ya da .update({ enable_live_trading: ... }) yok
    expect(content).not.toMatch(/\.update\([^)]*trading_mode/);
    expect(content).not.toMatch(/\.update\([^)]*enable_live_trading/);
    expect(content).not.toMatch(/\.update\([^)]*hardLiveTradingAllowed/);
  });
});

describe("Dashboard Card Safety", () => {
  const CARDS_PATH = path.join(PROJECT_ROOT, "src/components/dashboard/Cards.tsx");

  it("LiveReadinessCard ONAYLA butonu içermez (canlıyı açan UI yok)", () => {
    const content = fs.readFileSync(CARDS_PATH, "utf-8");
    // LiveReadinessCard bloğunu izole et
    const idx = content.indexOf("export function LiveReadinessCard");
    expect(idx).toBeGreaterThan(-1);
    const block = content.slice(idx);
    // ONAYLA literal'ı sadece TradeAuditCard'da olmalı; LiveReadinessCard'da olmamalı
    // LiveReadinessCard fonksiyonu sonu (sonraki export ile) belirsiz olduğundan
    // sadece "ONAYLA" sözcüğü buton listesi formunda yer alıyor mu bakıyoruz.
    const liveReadinessSection = block.split("\nexport ")[0];
    expect(liveReadinessSection).not.toMatch(/['"]ONAYLA['"]/);
  });
});

// ── Genel invariant sentinels ─────────────────────────────────────────────────

describe("Invariant Sentinels", () => {
  it("makeAllPassInput → openLiveOrderImplemented daima false", () => {
    const input = makeAllPassInput();
    expect(input.executionSafety.openLiveOrderImplemented).toBe(false);
  });

  it("makeAllPassInput → liveExecutionBound daima false", () => {
    const input = makeAllPassInput();
    expect(input.executionSafety.liveExecutionBound).toBe(false);
  });

  it("makeAllPassInput → leverageExecutionBound daima false", () => {
    const input = makeAllPassInput();
    expect(input.executionSafety.leverageExecutionBound).toBe(false);
  });

  it("makeAllPassInput → averageDownEnabled daima false", () => {
    const input = makeAllPassInput();
    expect(input.riskCalibration.averageDownEnabled).toBe(false);
  });

  it("makeAllPassInput → defaultTradingMode paper", () => {
    const input = makeAllPassInput();
    expect(input.executionSafety.defaultTradingMode).toBe("paper");
  });

  it("makeAllPassInput → hardLiveTradingAllowed false", () => {
    const input = makeAllPassInput();
    expect(input.executionSafety.hardLiveTradingAllowed).toBe(false);
  });

  it("Summary appliedToTradeEngine type literal false", () => {
    const summary = buildLiveReadinessSummary(makeAllPassInput());
    const literal: false = summary.appliedToTradeEngine;
    expect(literal).toBe(false);
  });

  it("Summary liveGateUnchanged type literal true", () => {
    const summary = buildLiveReadinessSummary(makeAllPassInput());
    const literal: true = summary.liveGateUnchanged;
    expect(literal).toBe(true);
  });
});
