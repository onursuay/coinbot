// Faz 23 — /api/live-readiness/status
//
// Read-only canlıya geçiş kontrol endpoint'i.
// Supabase + dahili modülleri okur; HİÇBİR Binance order/private endpoint
// çağrısı YAPMAZ. Yasaklı Binance private path'leri (order, leverage)
// referans dahi alınmaz.
// Live gate değerlerini (hardLiveTradingAllowed, enableLiveTrading,
// trading_mode) DEĞİŞTİRMEZ; yalnızca okur.

import { ok, fail } from "@/lib/api-helpers";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth";
import { env } from "@/lib/env";
import { getWorkerHealth } from "@/lib/engines/heartbeat";
import { getMarketFeedStatus } from "@/lib/market-feed/status";
import {
  checkCredentialPresence,
  validateFuturesAccess,
} from "@/lib/binance-credentials/validator";
import { DEFAULT_CHECKLIST, EXPECTED_VPS_IP } from "@/lib/binance-credentials/types";
import {
  buildRiskExecutionConfig,
  getEffectiveRiskSettings,
} from "@/lib/risk-settings/apply";
import {
  paperTradeRowToNormalizedTrade,
  liveTradeRowToNormalizedTrade,
  type PaperTradeRowRaw,
  type LiveTradeRowRaw,
  type NormalizedTrade,
  type ScanRowInput,
} from "@/lib/trade-performance";
import { buildTradeAuditReport } from "@/lib/trade-audit";
import {
  buildLiveReadinessSummary,
  HEARTBEAT_STALE_THRESHOLD_SEC,
  type LiveReadinessInput,
  type LiveReadinessSummary,
} from "@/lib/live-readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAPER_SELECT =
  "id, symbol, direction, entry_price, exit_price, stop_loss, take_profit, pnl, pnl_percent, signal_score, risk_reward_ratio, exit_reason, opened_at, closed_at, status";

const LIVE_SELECT =
  "id, symbol, side, status, entry_price, exit_price, stop_loss, take_profit, pnl, pnl_percent, trade_signal_score, rr_ratio, close_reason, exit_reason, opened_at, closed_at, trade_mode, execution_type";

export async function GET(_req: Request) {
  if (!supabaseConfigured()) {
    return ok(buildSafeNotReady("Supabase yapılandırılmamış."));
  }

  try {
    const userId = getCurrentUserId();
    const sb = supabaseAdmin();

    // ── 1. Paper trades ─────────────────────────────────────────────────────
    const { data: paperRows } = await sb
      .from("paper_trades")
      .select(PAPER_SELECT)
      .eq("user_id", userId)
      .order("opened_at", { ascending: false })
      .limit(500);
    const paperTrades: NormalizedTrade[] = (paperRows ?? []).map(
      (r: PaperTradeRowRaw) => paperTradeRowToNormalizedTrade(r),
    );

    // ── 2. Live trades (analiz için, emir göndermez) ────────────────────────
    let liveTrades: NormalizedTrade[] = [];
    try {
      const { data: liveRows } = await sb
        .from("live_trades")
        .select(LIVE_SELECT)
        .eq("user_id", userId)
        .order("opened_at", { ascending: false })
        .limit(200);
      liveTrades = (liveRows ?? []).map((r: LiveTradeRowRaw) =>
        liveTradeRowToNormalizedTrade(r),
      );
    } catch {
      // Tablo yok / boş — güvenli fallback.
    }

    const closedPaper = paperTrades.filter((t) => t.status === "closed");

    // Performans metrikleri
    const winRate = closedPaper.length > 0
      ? (closedPaper.filter((t) => (t.pnl ?? 0) > 0).length / closedPaper.length) * 100
      : 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let peak = 0;
    let equity = 0;
    let maxDdUsd = 0;
    for (const t of closedPaper) {
      const pnl = Number(t.pnl ?? 0);
      if (pnl > 0) grossProfit += pnl;
      else grossLoss += Math.abs(pnl);
      equity += pnl;
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDdUsd) maxDdUsd = dd;
    }
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;
    const PAPER_BALANCE = 1000;
    const maxDrawdownPercent = PAPER_BALANCE > 0 ? (maxDdUsd / PAPER_BALANCE) * 100 : 0;
    const averagePnlUsd = closedPaper.length > 0
      ? closedPaper.reduce((s, t) => s + Number(t.pnl ?? 0), 0) / closedPaper.length
      : 0;

    // Ardışık kayıp
    const sortedByDate = [...closedPaper].sort(
      (a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime(),
    );
    let consecutiveLosses = 0;
    let currentLossStreak = 0;
    for (const t of sortedByDate) {
      if ((t.pnl ?? 0) < 0) {
        currentLossStreak++;
        if (currentLossStreak > consecutiveLosses) consecutiveLosses = currentLossStreak;
      } else {
        currentLossStreak = 0;
      }
    }

    // ── 3. Bot settings ─────────────────────────────────────────────────────
    const { data: settingsRow } = await sb
      .from("bot_settings")
      .select(
        "trading_mode, enable_live_trading, binance_security_checklist, last_tick_summary, kill_switch_active, worker_id",
      )
      .eq("user_id", userId)
      .limit(1)
      .single();

    const checklist =
      (settingsRow?.binance_security_checklist as any) ?? DEFAULT_CHECKLIST;
    const enableLiveTrading = settingsRow?.enable_live_trading === true;
    const tradingMode =
      (settingsRow?.trading_mode as "paper" | "live") ?? "paper";
    const lastTickSummary = (settingsRow?.last_tick_summary as any) ?? null;
    const tickSkipped = lastTickSummary?.tickSkipped === true;
    const skipReason = lastTickSummary?.skipReason ?? null;
    const tickError = lastTickSummary?.tickError ?? null;
    const scanRows: ScanRowInput[] = lastTickSummary?.scanDetails ?? [];

    // ── 4. Worker health (heartbeat) ─────────────────────────────────────────
    const workerHealth = await getWorkerHealth();
    const lastHeartbeatAgeSec = workerHealth.ageMs !== null
      ? Math.round(workerHealth.ageMs / 1000)
      : null;
    const diagnosticsStale =
      lastHeartbeatAgeSec === null ||
      lastHeartbeatAgeSec > HEARTBEAT_STALE_THRESHOLD_SEC;

    // ── 5. Binance credentials (read-only, no order endpoint) ───────────────
    const presence = checkCredentialPresence();
    let futuresAccessOk = false;
    let accountReadOk = false;
    let permissionError: string | null = null;
    if (presence.credentialConfigured) {
      try {
        const access = await validateFuturesAccess();
        futuresAccessOk = access.futuresAccessOk;
        accountReadOk = access.accountReadOk;
        permissionError = access.permissionError;
      } catch (e: any) {
        permissionError = e?.message ?? "validation_failed";
      }
    }

    // ── 6. Market feed status ───────────────────────────────────────────────
    const marketFeed = getMarketFeedStatus();

    // ── 7. Risk config (read-only) ──────────────────────────────────────────
    const riskCfg = buildRiskExecutionConfig(getEffectiveRiskSettings());
    const has30x =
      riskCfg.leverageRanges.CC.max >= 30 ||
      riskCfg.leverageRanges.GNMR.max >= 30 ||
      riskCfg.leverageRanges.MNLST.max >= 30;

    // ── 8. Trade audit özeti (read-only) ────────────────────────────────────
    const auditReport = buildTradeAuditReport({
      trades: [...paperTrades, ...liveTrades],
      scanRows,
      riskConfig: riskCfg,
      mode: "paper",
    });
    const auditCriticalCount =
      auditReport.tradeQuality.filter((r) => r.severity === "critical").length +
      auditReport.stopLossAudit.filter((r) => r.severity === "critical").length +
      auditReport.takeProfitAudit.filter((r) => r.severity === "critical").length +
      (auditReport.riskCalibration.severity === "critical" ? 1 : 0) +
      (auditReport.positionSizingAudit.severity === "critical" ? 1 : 0) +
      (auditReport.leverageCalibration.severity === "critical" ? 1 : 0);
    const auditWarningCount =
      auditReport.tradeQuality.filter((r) => r.severity === "warning").length +
      auditReport.stopLossAudit.filter((r) => r.severity === "warning").length +
      auditReport.takeProfitAudit.filter((r) => r.severity === "warning").length +
      (auditReport.riskCalibration.severity === "warning" ? 1 : 0) +
      (auditReport.positionSizingAudit.severity === "warning" ? 1 : 0) +
      (auditReport.leverageCalibration.severity === "warning" ? 1 : 0);
    const positionSizingInflated =
      auditReport.positionSizingAudit.tag === "STOP_DISTANCE_INFLATED_NOTIONAL";

    // ── 9. Tüm input'u birleştir ─────────────────────────────────────────────
    const input: LiveReadinessInput = {
      paperPerformance: {
        closedTradeCount: closedPaper.length,
        winRatePercent: winRate,
        averagePnlUsd: averagePnlUsd,
        maxDrawdownPercent,
        profitFactor,
        consecutiveLosses,
      },
      riskCalibration: {
        riskPerTradePercent: riskCfg.riskPerTradePercent,
        dailyMaxLossPercent: riskCfg.dailyMaxLossPercent,
        totalBotCapitalUsdt: riskCfg.totalBotCapitalUsdt,
        defaultMaxOpenPositions: riskCfg.defaultMaxOpenPositions,
        dynamicMaxOpenPositions: riskCfg.dynamicMaxOpenPositions,
        maxDailyTrades: riskCfg.maxDailyTrades,
        averageDownEnabled: riskCfg.averageDownEnabled,
        leverageExecutionBound: riskCfg.leverageExecutionBound,
        has30xConfigured: has30x,
      },
      tradeAudit: {
        criticalCount: auditCriticalCount,
        warningCount: auditWarningCount,
        status: auditReport.summary.status,
        positionSizingInflated,
      },
      binanceCredentials: {
        apiKeyPresent: presence.apiKeyPresent,
        apiSecretPresent: presence.apiSecretPresent,
        futuresAccessOk,
        accountReadOk,
        permissionError,
      },
      apiSecurity: {
        checklist,
        recommendedVpsIp: EXPECTED_VPS_IP,
      },
      executionSafety: {
        hardLiveTradingAllowed: env.hardLiveTradingAllowed === true,
        enableLiveTrading,
        defaultTradingMode: env.defaultTradingMode,
        openLiveOrderImplemented: false, // Faz 16 invariant — değişmez
        liveExecutionBound: false, // Faz 19 invariant
        leverageExecutionBound: false, // Faz 19 invariant
      },
      websocketReconciliation: {
        marketFeed,
        reconciliationLoopSafe: true, // Faz 18 fail-closed/no-op
        duplicateGuardAvailable: true, // Faz 18 mevcut
        clientOrderIdGuardAvailable: true, // Faz 18 mevcut
      },
      systemHealth: {
        workerOnline: workerHealth.online,
        workerStatus: workerHealth.status ?? "unknown",
        lastHeartbeatAgeSec,
        binanceApiStatus:
          (workerHealth.binanceApiStatus as "ok" | "degraded" | "unknown") ?? "unknown",
        tickSkipped,
        skipReason,
        tickError,
        workerLockHealthy: !!workerHealth.workerId,
        diagnosticsStale,
      },
      userApproval: {
        userLiveApproval: "pending", // Default — bu fazda kullanıcı onayı kaydı yok
      },
    };

    const summary: LiveReadinessSummary = buildLiveReadinessSummary(input);

    return ok({
      summary,
      input,
      meta: {
        userId,
        tradingModeFromDb: tradingMode,
        // Live gate değerleri okuma için döndürülür; yine değiştirilmez.
        liveGateValues: {
          hardLiveTradingAllowed: env.hardLiveTradingAllowed === true,
          enableLiveTrading,
          defaultTradingMode: env.defaultTradingMode,
        },
      },
    });
  } catch (e: any) {
    return fail(e?.message ?? "live-readiness/status okunamadı", 500);
  }
}

function buildSafeNotReady(reason: string) {
  const summary: LiveReadinessSummary = {
    readinessStatus: "NOT_READY",
    readinessScore: 0,
    blockingIssuesCount: 1,
    warningIssuesCount: 0,
    mainBlockingReason: reason,
    nextRequiredAction: "DATA_INSUFFICIENT",
    checks: [
      {
        id: "bootstrap.unavailable",
        category: "SYSTEM_HEALTH",
        title: "Sistem hazır değil",
        status: "fail",
        severity: "critical",
        message: reason,
        evidence: reason,
        blocking: true,
      },
    ],
    generatedAt: new Date().toISOString(),
    liveGateUnchanged: true,
    appliedToTradeEngine: false,
  };
  return { summary };
}
