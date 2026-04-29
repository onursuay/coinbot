// Faz 22 — /api/trade-audit/summary
//
// Read-only endpoint. Supabase + in-memory risk config okur.
// Binance API çağrısı YAPMAZ. Hiçbir ayarı DEĞİŞTİRMEZ.
// /fapi/v1/order, /fapi/v1/leverage çağrısı YOK.
// Veri yetersizse DATA_INSUFFICIENT ile güvenli fallback döner.

import { ok, fail } from "@/lib/api-helpers";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth";
import {
  paperTradeRowToNormalizedTrade,
  liveTradeRowToNormalizedTrade,
  type PaperTradeRowRaw,
  type LiveTradeRowRaw,
  type NormalizedTrade,
  type ScanRowInput,
} from "@/lib/trade-performance";
import { buildRiskExecutionConfig, getEffectiveRiskSettings } from "@/lib/risk-settings/apply";
import { buildTradeAuditReport, type AuditMode } from "@/lib/trade-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAPER_SELECT =
  "id, symbol, direction, entry_price, exit_price, stop_loss, take_profit, pnl, pnl_percent, signal_score, risk_reward_ratio, exit_reason, opened_at, closed_at, status";

const LIVE_SELECT =
  "id, symbol, side, status, entry_price, exit_price, stop_loss, take_profit, pnl, pnl_percent, trade_signal_score, rr_ratio, close_reason, exit_reason, opened_at, closed_at, trade_mode, execution_type";

export async function GET(req: Request) {
  if (!supabaseConfigured()) {
    return ok(buildEmptyAudit("Supabase yapılandırılmamış.", "paper"));
  }

  const url = new URL(req.url);
  const modeParam = url.searchParams.get("mode");
  const mode: AuditMode =
    modeParam === "live" ? "live"
    : modeParam === "all" ? "all"
    : "paper";

  try {
    const userId = getCurrentUserId();
    const sb = supabaseAdmin();

    // ── Paper trades ─────────────────────────────────────────────────────────
    let paperTrades: NormalizedTrade[] = [];
    if (mode === "paper" || mode === "all") {
      const { data: rows, error } = await sb
        .from("paper_trades")
        .select(PAPER_SELECT)
        .eq("user_id", userId)
        .order("opened_at", { ascending: false })
        .limit(200);
      if (error) return fail(error.message, 500);
      paperTrades = (rows ?? []).map((r: PaperTradeRowRaw) => paperTradeRowToNormalizedTrade(r));
    }

    // ── Live trades — Binance API ÇAĞRISI YOK; sadece DB okuma ──────────────
    let liveTrades: NormalizedTrade[] = [];
    if (mode === "live" || mode === "all") {
      const { data: rows, error } = await sb
        .from("live_trades")
        .select(LIVE_SELECT)
        .eq("user_id", userId)
        .order("opened_at", { ascending: false })
        .limit(200);
      if (!error && rows && rows.length > 0) {
        liveTrades = rows.map((r: LiveTradeRowRaw) => liveTradeRowToNormalizedTrade(r));
      }
    }

    if (mode === "live" && liveTrades.length === 0) {
      return ok(buildEmptyAudit("Canlı işlem verisi oluşmadı.", "live"));
    }

    const allTrades = [...paperTrades, ...liveTrades];
    if (allTrades.length === 0) {
      return ok(buildEmptyAudit("Yeterli işlem verisi yok.", mode === "live" ? "live" : "paper"));
    }

    // ── Scan rows — son tick verisi ──────────────────────────────────────────
    const { data: settingsRow } = await sb
      .from("bot_settings")
      .select("last_tick_summary")
      .limit(1)
      .single();
    const scanRows: ScanRowInput[] =
      (settingsRow?.last_tick_summary as any)?.scanDetails ?? [];

    // ── Risk config — Binance API çağrısı yok ───────────────────────────────
    let riskConfig = null;
    try {
      riskConfig = buildRiskExecutionConfig(getEffectiveRiskSettings());
    } catch {
      // Risk config yoksa null; audit DATA_INSUFFICIENT ile çalışır.
    }

    // ── Tüm denetimleri çalıştır ─────────────────────────────────────────────
    const report = buildTradeAuditReport({ trades: allTrades, scanRows, riskConfig, mode });

    return ok(report);
  } catch (e: any) {
    return fail(e?.message ?? "trade-audit/summary okunamadı", 500);
  }
}

function buildEmptyAudit(reason: string, tradeMode: "paper" | "live") {
  return {
    summary: {
      status: "DATA_INSUFFICIENT" as const,
      tradeMode,
      mainFinding: reason,
      riskFinding: reason,
      stopLossFinding: reason,
      positionSizingFinding: reason,
      thresholdFinding: "70 eşiği korunuyor.",
      missedOpportunityFinding: reason,
      leverageFinding: reason,
      recommendation: "Bot çalışırken otomatik veri birikiyor; tekrar kontrol edin.",
      actionType: "DATA_INSUFFICIENT" as const,
      confidence: 0,
      requiresUserApproval: false,
      observeDays: 7,
      appliedToTradeEngine: false as const,
    },
    tradeQuality: [],
    stopLossAudit: [],
    takeProfitAudit: [],
    riskCalibration: {
      tag: "DATA_INSUFFICIENT" as const,
      riskPerTradePercent: 0,
      dailyMaxLossPercent: 0,
      totalBotCapitalUsdt: 0,
      mainFinding: reason,
      evidence: reason,
      recommendation: "Daha fazla veri bekleniyor.",
      severity: "info" as const,
    },
    positionSizingAudit: {
      tag: "DATA_INSUFFICIENT" as const,
      capitalMissingFallbackUsed: false,
      affectedTradeCount: 0,
      mainFinding: reason,
      evidence: reason,
      recommendation: "Daha fazla veri bekleniyor.",
      severity: "info" as const,
    },
    limitCalibration: {
      tag: "DATA_INSUFFICIENT" as const,
      defaultMaxOpenPositions: 0,
      dynamicMaxOpenPositions: 0,
      maxDailyTrades: 0,
      mainFinding: reason,
      evidence: reason,
      recommendation: "Daha fazla veri bekleniyor.",
      severity: "info" as const,
    },
    leverageCalibration: {
      tag: "DATA_INSUFFICIENT" as const,
      has30xConfigured: false,
      ccMax: null,
      gnmrMax: null,
      mnlstMax: null,
      mainFinding: reason,
      evidence: reason,
      recommendation: "Daha fazla veri bekleniyor.",
      severity: "info" as const,
    },
    missedOpportunityAudit: {
      tag: "DATA_INSUFFICIENT" as const,
      btcFilteredCount: 0,
      riskGateRejectedCount: 0,
      band60to69Count: 0,
      mainFinding: reason,
      evidence: reason,
      recommendation: "Daha fazla veri bekleniyor.",
      severity: "info" as const,
    },
    thresholdCalibration: {
      tag: "DATA_INSUFFICIENT" as const,
      liveThreshold: 70 as const,
      liveThresholdUnchanged: true as const,
      band70to74WinRate: null,
      band65to69Count: 0,
      mainFinding: "70 eşiği korunuyor.",
      evidence: reason,
      recommendation: "Daha fazla veri bekleniyor.",
      severity: "info" as const,
    },
    meta: {
      tradeCount: 0,
      closedTradeCount: 0,
      openTradeCount: 0,
      mode: tradeMode,
      analyzedAt: new Date().toISOString(),
    },
  };
}
