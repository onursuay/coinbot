// AI Karar Asistanı Patch — /api/ai-decision/interpret
//
// POST endpoint. Internal summary'leri okur, AI'a context gönderir, structured
// JSON döner. Bu endpoint:
//   • Trade açmaz / kapatmaz
//   • Risk / SL / TP / threshold / kaldıraç ayarı DEĞİŞTİRMEZ
//   • Binance API ÇAĞRISI YAPMAZ (yasaklı private path'ler asla referans alınmaz)
//   • Live gate değerlerini DEĞİŞTİRMEZ
//   • OpenAI API key'i secret olarak bırakır; response/log içinde sızdırmaz

import { ok, fail } from "@/lib/api-helpers";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth";
import { env } from "@/lib/env";
import { getWorkerHealth } from "@/lib/engines/heartbeat";
import { getMarketFeedStatus } from "@/lib/market-feed/status";
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
  analyzeMissedOpportunities,
  analyzeRiskAdvisory,
  analyzeScoreBands,
  analyzeShadowThresholds,
  buildDecisionSummary,
  reviewStopLossQuality,
  reviewTrade,
} from "@/lib/trade-performance";
import { buildTradeAuditReport } from "@/lib/trade-audit";
import { buildLiveReadinessSummary } from "@/lib/live-readiness";
import {
  buildAIDecisionContext,
  callAIDecision,
  readOpenAIConfigFromEnv,
  type ClosedTradeSummary,
  type OpenPositionSummary,
} from "@/lib/ai-decision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAPER_SELECT =
  "id, symbol, direction, entry_price, exit_price, stop_loss, take_profit, pnl, pnl_percent, signal_score, risk_reward_ratio, exit_reason, opened_at, closed_at, status";

const LIVE_SELECT =
  "id, symbol, side, status, entry_price, exit_price, stop_loss, take_profit, pnl, pnl_percent, trade_signal_score, rr_ratio, close_reason, exit_reason, opened_at, closed_at, trade_mode, execution_type";

export async function POST(req: Request) {
  try {
    // Body opsiyonel; ekstra context override için.
    let bodyMode: "paper" | "live" | "all" = "paper";
    try {
      const json = await req.json();
      if (json?.mode === "live" || json?.mode === "all") bodyMode = json.mode;
    } catch {
      // Boş body → default paper
    }

    if (!supabaseConfigured()) {
      return ok(await runAI(buildEmptyContext(bodyMode)));
    }

    const userId = getCurrentUserId();
    const sb = supabaseAdmin();

    // ── Paper / live trades ─────────────────────────────────────────────────
    const { data: paperRows } = await sb
      .from("paper_trades")
      .select(PAPER_SELECT)
      .eq("user_id", userId)
      .order("opened_at", { ascending: false })
      .limit(200);
    const paperTrades: NormalizedTrade[] = (paperRows ?? []).map(
      (r: PaperTradeRowRaw) => paperTradeRowToNormalizedTrade(r),
    );

    let liveTrades: NormalizedTrade[] = [];
    try {
      const { data: liveRows } = await sb
        .from("live_trades")
        .select(LIVE_SELECT)
        .eq("user_id", userId)
        .order("opened_at", { ascending: false })
        .limit(100);
      liveTrades = (liveRows ?? []).map((r: LiveTradeRowRaw) =>
        liveTradeRowToNormalizedTrade(r),
      );
    } catch {
      // tablo yoksa fallback
    }

    const allTrades = [...paperTrades, ...liveTrades];
    const closed = allTrades.filter((t) => t.status === "closed");
    const open = allTrades.filter((t) => t.status === "open");

    // ── Bot settings ────────────────────────────────────────────────────────
    const { data: settingsRow } = await sb
      .from("bot_settings")
      .select(
        "trading_mode, enable_live_trading, last_tick_summary",
      )
      .eq("user_id", userId)
      .limit(1)
      .single();
    const tradingMode =
      (settingsRow?.trading_mode as "paper" | "live") ?? "paper";
    const enableLiveTrading = settingsRow?.enable_live_trading === true;
    const lastTick = (settingsRow?.last_tick_summary as any) ?? null;
    const scanRows: ScanRowInput[] = lastTick?.scanDetails ?? [];

    // ── Performance Decision (Faz 13) ───────────────────────────────────────
    const scoreBands = analyzeScoreBands({ trades: allTrades, scanRows, modeFilter: "paper" });
    const shadowThresholds = analyzeShadowThresholds(scanRows);
    const missed = analyzeMissedOpportunities(scanRows);
    const reviews = closed.map((t) => reviewTrade(t));
    const slReviews = closed.map((t) => reviewStopLossQuality(t));
    const riskAdvisory = analyzeRiskAdvisory({
      closedTrades: closed,
      openTradesCount: open.length,
      todaysTradesCount: 0,
      currentSettings: null,
      modeFilter: "paper",
    });
    const wins = closed.filter((t) => Number(t.pnl ?? 0) > 0).length;
    const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;
    const performanceDecision = buildDecisionSummary({
      tradeMode: "paper",
      closedTradeCount: closed.length,
      scoreBands,
      shadowThresholds,
      missed,
      tradeReviews: reviews,
      stopLossReviews: slReviews,
      riskAdvisory,
      totalTradeCount: allTrades.length,
      paperWinRatePercent: winRate,
    });

    // ── Risk config (Faz 19) ────────────────────────────────────────────────
    const riskCfg = buildRiskExecutionConfig(getEffectiveRiskSettings());
    const has30x =
      riskCfg.leverageRanges.CC.max >= 30 ||
      riskCfg.leverageRanges.GNMR.max >= 30 ||
      riskCfg.leverageRanges.MNLST.max >= 30;

    // ── Trade Audit (Faz 22) ────────────────────────────────────────────────
    const auditReport = buildTradeAuditReport({
      trades: allTrades,
      scanRows,
      riskConfig: riskCfg,
      mode: bodyMode,
    });

    // ── Worker / market feed ────────────────────────────────────────────────
    const workerHealth = await getWorkerHealth();
    const marketFeed = getMarketFeedStatus();

    // ── Live Readiness (Faz 23) — özet ──────────────────────────────────────
    let grossProfit = 0;
    let grossLoss = 0;
    let peak = 0;
    let equity = 0;
    let maxDdUsd = 0;
    for (const t of closed) {
      const pnl = Number(t.pnl ?? 0);
      if (pnl > 0) grossProfit += pnl;
      else grossLoss += Math.abs(pnl);
      equity += pnl;
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDdUsd) maxDdUsd = dd;
    }
    const PAPER_BALANCE = 1000;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;
    const maxDrawdownPercent = (maxDdUsd / PAPER_BALANCE) * 100;
    const sortedByDate = [...closed].sort(
      (a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime(),
    );
    let consecutiveLosses = 0;
    let cur = 0;
    for (const t of sortedByDate) {
      if ((t.pnl ?? 0) < 0) {
        cur++;
        if (cur > consecutiveLosses) consecutiveLosses = cur;
      } else {
        cur = 0;
      }
    }
    const auditCriticalCount =
      auditReport.tradeQuality.filter((r) => r.severity === "critical").length +
      auditReport.stopLossAudit.filter((r) => r.severity === "critical").length +
      (auditReport.positionSizingAudit.severity === "critical" ? 1 : 0) +
      (auditReport.riskCalibration.severity === "critical" ? 1 : 0) +
      (auditReport.leverageCalibration.severity === "critical" ? 1 : 0);
    const auditWarningCount =
      auditReport.tradeQuality.filter((r) => r.severity === "warning").length +
      auditReport.stopLossAudit.filter((r) => r.severity === "warning").length;

    const liveReadiness = buildLiveReadinessSummary({
      paperPerformance: {
        closedTradeCount: closed.length,
        winRatePercent: winRate,
        averagePnlUsd: closed.length > 0 ? equity / closed.length : 0,
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
        averageDownEnabled: false,
        leverageExecutionBound: false,
        has30xConfigured: has30x,
      },
      tradeAudit: {
        criticalCount: auditCriticalCount,
        warningCount: auditWarningCount,
        status: auditReport.summary.status,
        positionSizingInflated:
          auditReport.positionSizingAudit.tag === "STOP_DISTANCE_INFLATED_NOTIONAL",
      },
      binanceCredentials: {
        apiKeyPresent: false, // bu özet AI için, gerçek credential check Faz 23 endpoint'inde
        apiSecretPresent: false,
        futuresAccessOk: false,
        accountReadOk: false,
        permissionError: null,
      },
      apiSecurity: {
        checklist: {
          withdrawPermissionDisabled: "unknown",
          ipRestrictionConfigured: "unknown",
          futuresPermissionConfirmed: "unknown",
          extraPermissionsReviewed: "unknown",
          updatedAt: null,
        },
        recommendedVpsIp: "72.62.146.159",
      },
      executionSafety: {
        hardLiveTradingAllowed: env.hardLiveTradingAllowed === true,
        enableLiveTrading,
        defaultTradingMode: env.defaultTradingMode,
        openLiveOrderImplemented: false,
        liveExecutionBound: false,
        leverageExecutionBound: false,
      },
      websocketReconciliation: {
        marketFeed,
        reconciliationLoopSafe: true,
        duplicateGuardAvailable: true,
        clientOrderIdGuardAvailable: true,
      },
      systemHealth: {
        workerOnline: workerHealth.online,
        workerStatus: workerHealth.status ?? "unknown",
        lastHeartbeatAgeSec:
          workerHealth.ageMs !== null ? Math.round(workerHealth.ageMs / 1000) : null,
        binanceApiStatus:
          (workerHealth.binanceApiStatus as "ok" | "degraded" | "unknown") ?? "unknown",
        tickSkipped: lastTick?.tickSkipped === true,
        skipReason: lastTick?.skipReason ?? null,
        tickError: lastTick?.tickError ?? null,
        workerLockHealthy: !!workerHealth.workerId,
        diagnosticsStale:
          workerHealth.ageMs === null || workerHealth.ageMs > 60_000,
      },
      userApproval: { userLiveApproval: "pending" },
    });

    // ── Closed trade ve open position özetleri ──────────────────────────────
    const closedTradesRecent: ClosedTradeSummary[] = closed.slice(0, 20).map((t) => ({
      symbol: t.symbol,
      direction: t.direction,
      pnlPercent: t.pnlPercent,
      riskRewardRatio: t.riskRewardRatio,
      exitReason: t.exitReason,
      signalScore: t.signalScore,
    }));
    const openPositions: OpenPositionSummary[] = open.slice(0, 10).map((t) => ({
      symbol: t.symbol,
      direction: t.direction,
      entryPrice: t.entryPrice,
      stopLoss: t.stopLoss,
      takeProfit: t.takeProfit,
      unrealizedPnlUsd: null,
      pmAction: null,
    }));

    // ── Context build (secret scrub) ────────────────────────────────────────
    const context = buildAIDecisionContext({
      performanceDecision,
      tradeAuditSummary: auditReport.summary,
      liveReadiness,
      positionManagementCount: 0,
      positionManagementTopActions: [],
      riskConfig: {
        riskPerTradePercent: riskCfg.riskPerTradePercent,
        dailyMaxLossPercent: riskCfg.dailyMaxLossPercent,
        totalBotCapitalUsdt: riskCfg.totalBotCapitalUsdt,
        defaultMaxOpenPositions: riskCfg.defaultMaxOpenPositions,
        dynamicMaxOpenPositions: riskCfg.dynamicMaxOpenPositions,
        maxDailyTrades: riskCfg.maxDailyTrades,
        averageDownEnabled: false,
        liveExecutionBound: false,
        leverageExecutionBound: false,
        has30xConfigured: has30x,
      },
      marketPulse: null,
      radar: null,
      diagnostics: {
        workerOnline: workerHealth.online,
        workerStatus: workerHealth.status ?? "unknown",
        websocketStatus: marketFeed.websocketStatus,
        binanceApiStatus: workerHealth.binanceApiStatus ?? "unknown",
        tickSkipped: lastTick?.tickSkipped === true,
        skipReason: lastTick?.skipReason ?? null,
        tradingMode,
        hardLiveTradingAllowed: env.hardLiveTradingAllowed === true,
        enableLiveTrading,
      },
      closedTradesRecent,
      openPositions,
      scanRowsCount: scanRows.length,
      mode: bodyMode,
    });

    return ok(await runAI(context));
  } catch (e: any) {
    return fail(e?.message ?? "ai-decision/interpret hata", 500);
  }
}

async function runAI(context: ReturnType<typeof buildAIDecisionContext>) {
  const cfg = readOpenAIConfigFromEnv();
  const response = await callAIDecision(context, {
    apiKey: cfg.apiKey,
    model: cfg.model,
  });
  return {
    response,
    contextMeta: {
      mode: context.mode,
      generatedAt: context.generatedAt,
      scanRowsCount: context.scanRowsCount,
      closedTradesIncluded: context.closedTradesRecent.length,
      openPositionsIncluded: context.openPositions.length,
    },
  };
}

function buildEmptyContext(mode: "paper" | "live" | "all") {
  return buildAIDecisionContext({
    mode,
    closedTradesRecent: [],
    openPositions: [],
    scanRowsCount: 0,
  });
}
