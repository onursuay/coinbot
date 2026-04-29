// Phase 13 — /api/trade-performance/decision-summary
//
// Read-only endpoint. Sadece DB / diagnostics / paper trades verisini okur,
// hiçbir trade engine ayarını veya canlı trading gate'ini değiştirmez,
// yeni Binance API çağrısı YAPMAZ. Live'a geçişte aynı endpoint live trade
// verisini de NormalizedTrade üzerinden ekleyecek; UI sözleşmesi değişmez.

import { ok, fail } from "@/lib/api-helpers";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth";
import {
  analyzeMissedOpportunities,
  analyzeRiskAdvisory,
  analyzeScoreBands,
  analyzeShadowThresholds,
  buildDecisionSummary,
  paperTradeRowToNormalizedTrade,
  reviewStopLossQuality,
  reviewTrade,
  type DecisionSummary,
  type NormalizedTrade,
  type PaperTradeRowRaw,
  type ScanRowInput,
  type TradeMode,
} from "@/lib/trade-performance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DecisionPayload {
  decision: DecisionSummary;
  scoreBands: ReturnType<typeof analyzeScoreBands>;
  shadowThresholds: ReturnType<typeof analyzeShadowThresholds>;
  missed: ReturnType<typeof analyzeMissedOpportunities>;
  riskAdvisory: ReturnType<typeof analyzeRiskAdvisory>;
  tradeReviews: ReturnType<typeof reviewTrade>[];
  stopLossReviews: ReturnType<typeof reviewStopLossQuality>[];
  meta: {
    tradeMode: TradeMode;
    closedTradeCount: number;
    openTradeCount: number;
    paperWinRatePercent: number;
    /** Bu fazda live veri kaynağı yok — UI rozeti olarak göstermek için. */
    liveTradeSourceAvailable: false;
  };
}

function emptyPayload(reason: string, modeOpt?: TradeMode): DecisionPayload {
  const mode: TradeMode = modeOpt ?? "paper";
  return {
    decision: {
      status: "DATA_INSUFFICIENT",
      tradeMode: mode,
      mainFinding: "Yeterli paper veri oluşmadı. Gözlem devam ediyor.",
      systemInterpretation: reason,
      recommendation: "Bot çalışırken otomatik veri birikiyor; tekrar kontrol edin.",
      actionType: "DATA_INSUFFICIENT",
      confidence: 0,
      requiresUserApproval: false,
      observeDays: 0,
      appliedToTradeEngine: false,
    },
    scoreBands: [],
    shadowThresholds: { liveThreshold: 70, rows: [], liveThresholdUnchanged: true },
    missed: {
      missedOpportunityCount: 0, topMissedSymbols: [], missedReasonBreakdown: [],
      possibleAdjustmentArea: "Veri yok.", insufficientData: true,
    },
    riskAdvisory: [{ code: "INSUFFICIENT_DATA", comment: "Veri yok." }],
    tradeReviews: [],
    stopLossReviews: [],
    meta: {
      tradeMode: mode,
      closedTradeCount: 0,
      openTradeCount: 0,
      paperWinRatePercent: 0,
      liveTradeSourceAvailable: false,
    },
  };
}

function todayCount(trades: NormalizedTrade[]): number {
  const now = new Date();
  return trades.filter((t) => {
    const d = new Date(t.openedAt);
    return d.getUTCFullYear() === now.getUTCFullYear()
      && d.getUTCMonth() === now.getUTCMonth()
      && d.getUTCDate() === now.getUTCDate();
  }).length;
}

export async function GET(req: Request) {
  if (!supabaseConfigured()) {
    return ok(emptyPayload("Supabase yapılandırılmamış."));
  }
  const url = new URL(req.url);
  const modeParam = url.searchParams.get("mode");
  // mode parametresi şu an UI'dan gelmeyebilir; paper/live ayrımı için ileride
  // genişler. Default: tüm modları analiz et, decision rozeti "paper" döner.
  const modeFilter: TradeMode | undefined =
    modeParam === "paper" || modeParam === "live" ? (modeParam as TradeMode) : undefined;

  try {
    const userId = getCurrentUserId();
    const sb = supabaseAdmin();

    // Paper trades — read-only.
    const { data: paperRows, error: ptErr } = await sb
      .from("paper_trades")
      .select("id, symbol, direction, entry_price, exit_price, stop_loss, take_profit, pnl, pnl_percent, signal_score, risk_reward_ratio, exit_reason, opened_at, closed_at, status")
      .eq("user_id", userId)
      .order("opened_at", { ascending: false })
      .limit(200);
    if (ptErr) return fail(ptErr.message, 500);

    const allTrades: NormalizedTrade[] = (paperRows ?? []).map((r: PaperTradeRowRaw) =>
      paperTradeRowToNormalizedTrade(r),
    );
    // Live source not available yet — placeholder for future fapi/live_trades.
    // Live'a geçişte burada `liveTradeRowToNormalizedTrade(...)` ile concat edilecek.

    const filtered = modeFilter
      ? allTrades.filter((t) => t.tradeMode === modeFilter)
      : allTrades;

    const closed = filtered.filter((t) => t.status === "closed");
    const open = filtered.filter((t) => t.status === "open");

    if (closed.length === 0 && open.length === 0) {
      return ok(emptyPayload("Yeterli paper veri oluşmadı.", modeFilter ?? "paper"));
    }

    // Last tick scan details (worker'ın yazdığı son tick özeti).
    const { data: settingsRow } = await sb
      .from("bot_settings")
      .select("last_tick_summary")
      .limit(1)
      .single();
    const scanRows: ScanRowInput[] = (settingsRow?.last_tick_summary as any)?.scanDetails ?? [];

    // Tüm bileşenleri çalıştır.
    const scoreBands = analyzeScoreBands({
      trades: filtered,
      scanRows,
      modeFilter,
    });
    const shadowThresholds = analyzeShadowThresholds(scanRows);
    const missed = analyzeMissedOpportunities(scanRows);
    const tradeReviews = closed.map((t) => reviewTrade(t));
    const stopLossReviews = closed.map((t) => reviewStopLossQuality(t));
    const riskAdvisory = analyzeRiskAdvisory({
      closedTrades: closed,
      openTradesCount: open.length,
      todaysTradesCount: todayCount(filtered),
      currentSettings: null,
      modeFilter,
    });

    const wins = closed.filter((t) => Number(t.pnl ?? 0) > 0).length;
    const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;

    const decision = buildDecisionSummary({
      tradeMode: modeFilter ?? "paper",
      closedTradeCount: closed.length,
      scoreBands,
      shadowThresholds,
      missed,
      tradeReviews,
      stopLossReviews,
      riskAdvisory,
      totalTradeCount: filtered.length,
      paperWinRatePercent: winRate,
    });

    const payload: DecisionPayload = {
      decision,
      scoreBands,
      shadowThresholds,
      missed,
      riskAdvisory,
      tradeReviews,
      stopLossReviews,
      meta: {
        tradeMode: modeFilter ?? "paper",
        closedTradeCount: closed.length,
        openTradeCount: open.length,
        paperWinRatePercent: winRate,
        liveTradeSourceAvailable: false,
      },
    };

    return ok(payload);
  } catch (e: any) {
    return fail(e?.message ?? "decision-summary okunamadı", 500);
  }
}
