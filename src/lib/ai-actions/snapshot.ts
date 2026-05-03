// AI Aksiyon Merkezi — Faz 2/3: shared snapshot + plan builder.
//
// Hem GET /api/ai-actions hem POST /api/ai-actions/apply tarafından
// kullanılır. Source-of-truth tek yerde tutulur: apply endpoint server-side
// olarak planları yeniden üretir ve UI'dan gelen planId/recommendedValue
// değerlerini bu yetkili snapshot ile karşılaştırır.
//
// MUTLAK KURALLAR:
//   • Bu helper read-only'dir (sadece okuma yapar).
//   • Hiçbir Binance API çağrısı yoktur.
//   • Hiçbir trade engine ayarı, signal threshold, kaldıraç execution,
//     veya canlı trading gate kararı bu helper tarafından dokunulmaz.

import { getPaperTradeStats } from "@/lib/dashboard/paper-stats";
import {
  buildRiskExecutionConfig,
  getEffectiveRiskSettings,
} from "@/lib/risk-settings/apply";
import {
  generateActionPlans,
  type ActionPlanGeneratorInput,
  type ActionPlanResult,
  type SourceSnapshot,
} from "@/lib/ai-actions";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import {
  analyzeMissedOpportunities,
  analyzeRiskAdvisory,
  analyzeScoreBands,
  analyzeShadowThresholds,
  buildDecisionSummary,
  paperTradeRowToNormalizedTrade,
  reviewStopLossQuality,
  reviewTrade,
  type PaperTradeRowRaw,
  type ScanRowInput,
} from "@/lib/trade-performance";

const PAPER_SELECT =
  "id, symbol, direction, entry_price, exit_price, stop_loss, take_profit, pnl, pnl_percent, signal_score, risk_reward_ratio, exit_reason, opened_at, closed_at, status";

export const PHASE_BANNER =
  "Faz 3: Sadece güvenli düşürücü aksiyonlar kullanıcı onayı ile uygulanabilir. Live trading, leverage artırma ve risk artırma server-side reddedilir.";

export async function buildAIActionsResult(
  userId: string,
): Promise<ActionPlanResult> {
  const generatedAt = new Date().toISOString();

  // ── Paper performance (canonical) ──────────────────────────────────────
  const stats = await getPaperTradeStats(userId);
  const riskCfg = buildRiskExecutionConfig(getEffectiveRiskSettings());

  // ── Performance Decision Summary (paper mode) ──────────────────────────
  let performanceDecision: ActionPlanGeneratorInput["performanceDecision"] = null;
  if (supabaseConfigured()) {
    try {
      const sb = supabaseAdmin();
      const { data: paperRows } = await sb
        .from("paper_trades")
        .select(PAPER_SELECT)
        .eq("user_id", userId)
        .order("opened_at", { ascending: false })
        .limit(200);
      const paperTrades = (paperRows ?? []).map((r: PaperTradeRowRaw) =>
        paperTradeRowToNormalizedTrade(r),
      );
      const closed = paperTrades.filter((t) => t.status === "closed");
      const open = paperTrades.filter((t) => t.status === "open");

      const { data: settingsRow } = await sb
        .from("bot_settings")
        .select("last_tick_summary")
        .eq("user_id", userId)
        .limit(1)
        .single();
      const lastTick = (settingsRow?.last_tick_summary as
        | { scanDetails?: ScanRowInput[] }
        | null) ?? null;
      const scanRows: ScanRowInput[] = lastTick?.scanDetails ?? [];

      const scoreBands = analyzeScoreBands({
        trades: paperTrades,
        scanRows,
        modeFilter: "paper",
      });
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
      const summary = buildDecisionSummary({
        tradeMode: "paper",
        closedTradeCount: closed.length,
        scoreBands,
        shadowThresholds,
        missed,
        tradeReviews: reviews,
        stopLossReviews: slReviews,
        riskAdvisory,
        totalTradeCount: paperTrades.length,
        paperWinRatePercent: winRate,
      });
      performanceDecision = {
        status: summary.status,
        actionType: summary.actionType,
        mainFinding: summary.mainFinding,
        systemInterpretation: summary.systemInterpretation,
        recommendation: summary.recommendation,
        confidence: summary.confidence,
      };
    } catch {
      performanceDecision = null;
    }
  }

  const generatorInput: ActionPlanGeneratorInput = {
    closedTradeCount: stats.totalTrades,
    openTradeCount: stats.openTrades,
    totalPnl: stats.totalPnl,
    dailyPnl: stats.dailyPnl,
    winRate: stats.winRate,
    profitFactor: stats.profitFactor,
    maxDrawdownPercent: stats.maxDrawdownPercent,
    riskSettings: {
      riskPerTradePercent: riskCfg.riskPerTradePercent,
      dailyMaxLossPercent: riskCfg.dailyMaxLossPercent,
      defaultMaxOpenPositions: riskCfg.defaultMaxOpenPositions,
      dynamicMaxOpenPositions: riskCfg.dynamicMaxOpenPositions,
      maxDailyTrades: riskCfg.maxDailyTrades,
    },
    performanceDecision,
    aiInterpretation: null,
    generatedAt,
  };

  const plans = generateActionPlans(generatorInput);

  const sourceSnapshot: SourceSnapshot = {
    closedTrades: stats.totalTrades,
    openPositions: stats.openTrades,
    totalPnl: stats.totalPnl,
    dailyPnl: stats.dailyPnl,
    winRate: stats.winRate,
    profitFactor: stats.profitFactor,
    maxDrawdownPercent: stats.maxDrawdownPercent,
    riskSettingsSummary: {
      riskPerTradePercent: riskCfg.riskPerTradePercent,
      dailyMaxLossPercent: riskCfg.dailyMaxLossPercent,
      defaultMaxOpenPositions: riskCfg.defaultMaxOpenPositions,
      dynamicMaxOpenPositions: riskCfg.dynamicMaxOpenPositions,
      maxDailyTrades: riskCfg.maxDailyTrades,
    },
    performanceDecisionStatus: performanceDecision?.status ?? null,
    aiInterpreterStatus: null,
  };

  return {
    plans,
    generatedAt,
    sourceSnapshot,
    phaseBanner: PHASE_BANNER,
  };
}
