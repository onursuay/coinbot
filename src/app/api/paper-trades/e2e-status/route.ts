// Paper trade E2E validation — read-only snapshot of all paper trading health checks.
// No mutations. Safe to call at any time. Returns structured pass/fail checklist.

import { ok } from "@/lib/api-helpers";
import { getCurrentUserId } from "@/lib/auth";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { isHardLiveAllowed } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface E2ECheck {
  name: string;
  label: string;
  ok: boolean;
  detail: string;
  skipped?: boolean;
}

export interface E2EStatusResult {
  allPassed: boolean;
  passCount: number;
  failCount: number;
  skippedCount: number;
  checks: E2ECheck[];
  summary: string;
  lastCheckedAt: string;
}

export async function GET(): Promise<Response> {
  const checks: E2ECheck[] = [];

  // ── Check 1: hard live gate off (no Supabase needed) ────────────────────────
  const hardLive = isHardLiveAllowed();
  checks.push({
    name: "hard_live_gate_off",
    label: "Canlı işlem engeli",
    ok: !hardLive,
    detail: hardLive
      ? "UYARI: Canlı işlem engeli kapalı — gerçek emir açılabilir!"
      : "Canlı işlem kapalı — güvenli",
  });

  if (!supabaseConfigured()) {
    checks.push({
      name: "supabase_configured",
      label: "Supabase bağlantısı",
      ok: false,
      detail: "Supabase yapılandırılmamış — DB kontrolleri atlandı",
    });
    return ok(buildResult(checks, "Supabase eksik — DB kontrolleri yapılamadı"));
  }

  const userId = getCurrentUserId();
  const sb = supabaseAdmin();

  // ── Check 2: trading_mode = paper ───────────────────────────────────────────
  const { data: settingsRows } = await sb
    .from("bot_settings")
    .select("trading_mode, enable_live_trading, kill_switch_active")
    .limit(1);
  const settings = settingsRows?.[0] ?? null;
  const tradingMode = settings?.trading_mode ?? "paper";
  const enableLive = Boolean(settings?.enable_live_trading ?? false);

  checks.push({
    name: "trading_mode_paper",
    label: "İşlem modu paper",
    ok: tradingMode === "paper",
    detail: `Mevcut mod: ${tradingMode}`,
  });

  // ── Check 3: no real orders (enable_live_trading=false) ─────────────────────
  checks.push({
    name: "no_real_orders",
    label: "Gerçek emir gönderilmiyor",
    ok: !enableLive,
    detail: enableLive
      ? "UYARI: Canlı işlem aktif — gerçek emir açık!"
      : "Gerçek emir gönderilmedi",
  });

  // ── Check 4: at least 1 paper trade exists ──────────────────────────────────
  const { count: totalCount } = await sb
    .from("paper_trades")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  const hasTrades = (totalCount ?? 0) > 0;
  checks.push({
    name: "first_trade_opened",
    label: "İlk sanal işlem açıldı",
    ok: hasTrades,
    detail: hasTrades
      ? `Toplam ${totalCount} paper trade kaydı mevcut`
      : "Henüz paper trade açılmamış — bot başlatılıp beklenmeli",
  });

  if (!hasTrades) {
    return ok(buildResult(
      checks,
      "Paper trade henüz açılmamış — bot başlatılıp en az bir tarama beklenmeli",
    ));
  }

  // ── Fetch recent trades (open + closed) ─────────────────────────────────────
  const [recentOpenRes, recentClosedRes] = await Promise.all([
    sb.from("paper_trades")
      .select("id, is_paper, entry_price, stop_loss, take_profit, symbol, direction, status")
      .eq("user_id", userId)
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(5),
    sb.from("paper_trades")
      .select("id, is_paper, entry_price, stop_loss, take_profit, symbol, direction, pnl, exit_price, exit_reason")
      .eq("user_id", userId)
      .eq("status", "closed")
      .order("closed_at", { ascending: false })
      .limit(5),
  ]);

  const recentOpen = recentOpenRes.data ?? [];
  const recentClosed = recentClosedRes.data ?? [];
  const sampleTrade = recentOpen[0] ?? recentClosed[0] ?? null;

  // ── Check 5: is_paper=true on all recent trades ──────────────────────────────
  const allSamples = [...recentOpen, ...recentClosed];
  const allIsPaper = allSamples.length > 0 && allSamples.every((t) => t.is_paper === true);
  const anyNotPaper = allSamples.some((t) => t.is_paper !== true);
  checks.push({
    name: "is_paper_flag",
    label: "is_paper=true doğrulandı",
    ok: !anyNotPaper && allSamples.length > 0,
    detail: anyNotPaper
      ? "UYARI: En az bir trade'de is_paper != true — gerçek emir riski!"
      : allIsPaper
      ? `Son ${allSamples.length} trade: is_paper=true doğrulandı`
      : "Trade bulunamadı",
  });

  // ── Check 6: entry / SL / TP present ────────────────────────────────────────
  const hasEntrySlTp =
    sampleTrade &&
    typeof sampleTrade.entry_price === "number" && Number(sampleTrade.entry_price) > 0 &&
    typeof sampleTrade.stop_loss === "number"   && Number(sampleTrade.stop_loss) > 0 &&
    typeof sampleTrade.take_profit === "number" && Number(sampleTrade.take_profit) > 0;

  checks.push({
    name: "entry_sl_tp_present",
    label: "Entry / SL / TP mevcut",
    ok: Boolean(hasEntrySlTp),
    detail: hasEntrySlTp
      ? `${sampleTrade!.symbol}: entry=${sampleTrade!.entry_price} SL=${sampleTrade!.stop_loss} TP=${sampleTrade!.take_profit}`
      : sampleTrade
      ? "Son trade'de entry/SL/TP eksik"
      : "Trade yok",
  });

  // ── Check 7: open positions queryable ───────────────────────────────────────
  const { count: openCount, error: openErr } = await sb
    .from("paper_trades")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "open");

  checks.push({
    name: "open_positions_visible",
    label: "Açık pozisyon sorgusu çalışıyor",
    ok: openErr === null,
    detail: openErr
      ? `Sorgu hatası: ${openErr.message}`
      : `${openCount ?? 0} açık pozisyon görünüyor`,
  });

  // ── Check 8: PnL calculated on closed trades ────────────────────────────────
  const hasClosedTrades = recentClosed.length > 0;
  const pnlCalculated =
    hasClosedTrades &&
    recentClosed.every(
      (t) => typeof t.pnl === "number" && t.exit_price !== null && t.exit_price !== undefined,
    );

  checks.push({
    name: "pnl_calculated",
    label: "Kapanan trade PnL hesaplandı",
    ok: hasClosedTrades ? pnlCalculated : true,
    skipped: !hasClosedTrades,
    detail: !hasClosedTrades
      ? "Henüz kapanan trade yok — bu kontrol atlandı"
      : pnlCalculated
      ? `Son ${recentClosed.length} kapanan trade: PnL ve çıkış fiyatı mevcut`
      : "Bazı kapalı trade'lerde PnL veya çıkış fiyatı eksik",
  });

  // ── Check 9: SL/TP closure verified ─────────────────────────────────────────
  const slCount = recentClosed.filter((t) => t.exit_reason === "stop_loss").length;
  const tpCount = recentClosed.filter((t) => t.exit_reason === "take_profit").length;
  const hasSlTpClosure = slCount > 0 || tpCount > 0;

  checks.push({
    name: "sl_tp_closure",
    label: "SL/TP ile kapanma doğrulandı",
    ok: hasClosedTrades ? hasSlTpClosure : true,
    skipped: !hasClosedTrades,
    detail: !hasClosedTrades
      ? "Henüz kapanan trade yok — bu kontrol atlandı"
      : hasSlTpClosure
      ? `SL: ${slCount}, TP: ${tpCount} (son ${recentClosed.length} kapalı trade)`
      : "Kapalı trade var ama SL/TP ile kapanmamış (manuel kapama olabilir)",
  });

  const failed = checks.filter((c) => !c.ok && !c.skipped);
  const summary =
    failed.length === 0
      ? "Tüm kontroller geçti — paper trading doğru çalışıyor"
      : `${failed.length} kontrol başarısız: ${failed.map((c) => c.label).join(", ")}`;

  return ok(buildResult(checks, summary));
}

function buildResult(checks: E2ECheck[], summary: string): E2EStatusResult {
  const passCount  = checks.filter((c) => c.ok).length;
  const failCount  = checks.filter((c) => !c.ok && !c.skipped).length;
  const skippedCount = checks.filter((c) => c.skipped).length;
  return {
    allPassed: failCount === 0,
    passCount,
    failCount,
    skippedCount,
    checks,
    summary,
    lastCheckedAt: new Date().toISOString(),
  };
}

export async function POST() {
  return Response.json({ ok: false, error: "E2E status endpoint read-only. Use GET." }, { status: 405 });
}
