// Faz 13/15 — /api/trade-performance/decision-summary
//
// Read-only endpoint. Sadece DB / diagnostics / paper+live trades verisini okur,
// hiçbir trade engine ayarını veya canlı trading gate'ini değiştirmez,
// yeni Binance API çağrısı YAPMAZ.
//
// Faz 15 eklentisi: ?mode=paper|live|all desteği + live_trades okuma.
// mode=live veri yokken hata fırlatmaz; güvenli fallback döner.
// Binance private/order endpoint çağrısı eklenmedi.

import { ok, fail } from "@/lib/api-helpers";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth";
import {
  analyzeMissedOpportunities,
  analyzeRiskAdvisory,
  analyzeScoreBands,
  analyzeShadowThresholds,
  buildDecisionSummary,
  liveTradeRowToNormalizedTrade,
  paperTradeRowToNormalizedTrade,
  reviewStopLossQuality,
  reviewTrade,
  type DecisionSummary,
  type LiveTradeRowRaw,
  type NormalizedTrade,
  type PaperTradeRowRaw,
  type ScanRowInput,
  type TradeMode,
} from "@/lib/trade-performance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ModeParam = "paper" | "live" | "all";

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
    mode: ModeParam;
    closedTradeCount: number;
    openTradeCount: number;
    paperWinRatePercent: number;
    liveTradeSourceAvailable: boolean;
  };
}

function resolveTradeMode(mode: ModeParam): TradeMode {
  if (mode === "live") return "live";
  return "paper";
}

function emptyPayload(reason: string, mode: ModeParam = "paper"): DecisionPayload {
  const tradeMode = resolveTradeMode(mode);
  return {
    decision: {
      status: "DATA_INSUFFICIENT",
      tradeMode,
      mainFinding:
        mode === "live"
          ? "Canlı işlem verisi oluşmadı. Gözlem devam ediyor."
          : "Yeterli paper veri oluşmadı. Gözlem devam ediyor.",
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
      missedOpportunityCount: 0,
      topMissedSymbols: [],
      missedReasonBreakdown: [],
      possibleAdjustmentArea: "Veri yok.",
      insufficientData: true,
    },
    riskAdvisory: [{ code: "INSUFFICIENT_DATA", comment: "Veri yok." }],
    tradeReviews: [],
    stopLossReviews: [],
    meta: {
      tradeMode,
      mode,
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
    return (
      d.getUTCFullYear() === now.getUTCFullYear() &&
      d.getUTCMonth() === now.getUTCMonth() &&
      d.getUTCDate() === now.getUTCDate()
    );
  }).length;
}

const PAPER_TRADE_SELECT =
  "id, symbol, direction, entry_price, exit_price, stop_loss, take_profit, pnl, pnl_percent, signal_score, risk_reward_ratio, exit_reason, opened_at, closed_at, status";

const LIVE_TRADE_SELECT =
  "id, symbol, side, status, entry_price, exit_price, stop_loss, take_profit, pnl, pnl_percent, trade_signal_score, rr_ratio, close_reason, exit_reason, opened_at, closed_at, trade_mode, execution_type";

export async function GET(req: Request) {
  if (!supabaseConfigured()) {
    return ok(emptyPayload("Supabase yapılandırılmamış."));
  }

  const url = new URL(req.url);
  const modeParam = url.searchParams.get("mode");
  const mode: ModeParam =
    modeParam === "live" ? "live"
    : modeParam === "all" ? "all"
    : "paper";

  const modeFilter: TradeMode | undefined =
    mode === "paper" ? "paper"
    : mode === "live" ? "live"
    : undefined;

  try {
    const userId = getCurrentUserId();
    const sb = supabaseAdmin();

    // ── Paper trades — sadece paper veya all modunda okunur ──────────────────
    let paperTrades: NormalizedTrade[] = [];
    if (mode === "paper" || mode === "all") {
      const { data: paperRows, error: ptErr } = await sb
        .from("paper_trades")
        .select(PAPER_TRADE_SELECT)
        .eq("user_id", userId)
        .order("opened_at", { ascending: false })
        .limit(200);
      if (ptErr) return fail(ptErr.message, 500);
      paperTrades = (paperRows ?? []).map((r: PaperTradeRowRaw) =>
        paperTradeRowToNormalizedTrade(r),
      );
    }

    // ── Live trades — sadece live veya all modunda okunur; Binance API YAPMAZ ─
    let liveTrades: NormalizedTrade[] = [];
    let liveTradeSourceAvailable = false;
    if (mode === "live" || mode === "all") {
      const { data: liveRows, error: ltErr } = await sb
        .from("live_trades")
        .select(LIVE_TRADE_SELECT)
        .eq("user_id", userId)
        .order("opened_at", { ascending: false })
        .limit(200);
      if (!ltErr && liveRows && liveRows.length > 0) {
        liveTrades = liveRows.map((r: LiveTradeRowRaw) =>
          liveTradeRowToNormalizedTrade(r),
        );
        liveTradeSourceAvailable = true;
      }
      // live_trades tablosu yoksa veya boşsa → güvenli fallback; hata fırlatmaz.
    }

    // ── mode=live ve hiç live veri yok → güvenli fallback ───────────────────
    if (mode === "live" && !liveTradeSourceAvailable) {
      return ok(emptyPayload("Canlı işlem verisi oluşmadı.", "live"));
    }

    const allTrades: NormalizedTrade[] = [...paperTrades, ...liveTrades];
    const filtered = modeFilter
      ? allTrades.filter((t) => t.tradeMode === modeFilter)
      : allTrades;

    const closed = filtered.filter((t) => t.status === "closed");
    const open = filtered.filter((t) => t.status === "open");

    if (closed.length === 0 && open.length === 0) {
      return ok(emptyPayload("Yeterli veri oluşmadı.", mode));
    }

    // ── Last tick scan details ───────────────────────────────────────────────
    const { data: settingsRow } = await sb
      .from("bot_settings")
      .select("last_tick_summary")
      .limit(1)
      .single();
    const scanRows: ScanRowInput[] =
      (settingsRow?.last_tick_summary as any)?.scanDetails ?? [];

    // ── Tüm analiz bileşenlerini çalıştır ───────────────────────────────────
    const scoreBands = analyzeScoreBands({ trades: filtered, scanRows, modeFilter });
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

    const tradeMode = resolveTradeMode(mode);
    const decision = buildDecisionSummary({
      tradeMode,
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
        tradeMode,
        mode,
        closedTradeCount: closed.length,
        openTradeCount: open.length,
        paperWinRatePercent: winRate,
        liveTradeSourceAvailable,
      },
    };

    return ok(payload);
  } catch (e: any) {
    return fail(e?.message ?? "decision-summary okunamadı", 500);
  }
}
