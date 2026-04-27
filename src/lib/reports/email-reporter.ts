import nodemailer from "nodemailer";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type { MonitoringMetrics } from "./monitoring-report";

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmt(n: number, d = 2): string { return n.toFixed(d); }
function fmtUsd(n: number): string { return `$${fmt(n, 2)}`; }
function fmtTs(iso: string | null): string {
  return iso ? iso.slice(0, 19).replace("T", " ") : "—";
}

// ── Subject ───────────────────────────────────────────────────────────────────

export function buildSubject(metrics: MonitoringMetrics): string {
  const ts = new Date(metrics.generatedAt).toISOString().slice(0, 16).replace("T", " ");
  return `CoinBot 30 Dakika Raporu — ${metrics.tradingMode.toUpperCase()} — ${ts}`;
}

// ── HTML body ─────────────────────────────────────────────────────────────────

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:3px 10px 3px 0;color:#555;white-space:nowrap;vertical-align:top">${label}</td>
    <td style="padding:3px 0;font-weight:500;vertical-align:top">${value}</td>
  </tr>`;
}

function section(title: string, rows: string): string {
  return `<h3 style="margin:18px 0 6px;font-size:14px;border-bottom:1px solid #e0e0e0;padding-bottom:3px;color:#333">${title}</h3>
  <table style="border-collapse:collapse;width:100%;font-size:13px">${rows}</table>`;
}

export function buildHtmlBody(metrics: MonitoringMetrics): string {
  const {
    warnings = [], botStatus = "unknown", workerOnline = false, workerAgeMs = null, workerUptimeSec = 0, workerRestartCount = 0,
    activeExchange = "binance", tradingMode = "paper", hardLiveAllowed = false, enableLiveTrading = false,
    tickCount = 0, avgTickDurationMs = 0, maxTickDurationMs = 0, tickErrorCount = 0,
    totalScannedSymbols = 0, avgScannedSymbols = 0, lastTickAt = null,
    topRejectedReasons = [], recentSignalCount = 0, recentSignalSymbols = [],
    openedPaperTrades30m = 0, closedPaperTrades30m = 0, openPaperPositions = 0,
    totalPaperPnl = 0, pnl30m = 0, winRate = 0, profitFactor = 0, maxDrawdown = 0,
    slClosedCount = 0, tpClosedCount = 0, totalClosedTrades = 0,
    paperTradesCompleted = 0, paperTradesRequired = 100, liveReady = false, readinessBlockers = [],
    strategyScore = 0, strategyBlocked = false,
    hardLiveTradingAllowedFalse = true, enableLiveTradingFalse = true, tradingModePaper = true,
    realOrderSent = false, killSwitchActive = false, lastError = null,
  } = metrics;

  const workerStr = workerOnline
    ? `✅ ONLINE (${Math.round((workerAgeMs ?? 0) / 1000)}s önce)`
    : "❌ OFFLINE";

  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;padding:16px;color:#222;font-size:13px">
<h2 style="margin:0 0 4px;font-size:18px">🤖 CoinBot Monitoring Raporu</h2>
<p style="margin:0 0 16px;color:#666;font-size:12px">
  Periyot: ${fmtTs(metrics.periodStart)} → ${fmtTs(metrics.periodEnd)} UTC
</p>`;

  if (warnings.length > 0) {
    html += `<div style="background:#fff8e1;border-left:4px solid #ffc107;padding:10px 14px;margin-bottom:16px">
  <strong style="color:#856404">⚠️ Uyarılar (${warnings.length})</strong>
  <ul style="margin:6px 0 0;padding-left:18px;color:#856404">
    ${warnings.map((w) => `<li>${w}</li>`).join("")}
  </ul>
</div>`;
  }

  html += section("1. Genel Durum", [
    row("Bot Status", botStatus.toUpperCase()),
    row("Worker", workerStr),
    row("Worker Uptime", `${Math.round(workerUptimeSec / 60)} dakika`),
    row("Worker Restart", `${workerRestartCount}`),
    row("Active Exchange", activeExchange.toUpperCase()),
    row("Trading Mode", tradingMode.toUpperCase()),
    row("HARD_LIVE_ALLOWED", hardLiveAllowed ? "<span style='color:#c00'>⚠️ TRUE</span>" : "✅ FALSE"),
    row("Live Trading Enabled", enableLiveTrading ? "<span style='color:#c00'>⚠️ YES</span>" : "✅ NO"),
  ].join(""));

  html += section("2. Tick Özeti (Son 30 Dakika)", [
    row("Tick Sayısı", `${tickCount}`),
    row("Ort. Tick Süresi", `${avgTickDurationMs}ms`),
    row("Max Tick Süresi", `${maxTickDurationMs}ms`),
    row("Hata Sayısı", tickErrorCount > 0 ? `<span style='color:#c00'>⚠️ ${tickErrorCount}</span>` : "0"),
    row("Toplam Taranan Sembol", `${totalScannedSymbols}`),
    row("Ort. Taranan/Tick", `${avgScannedSymbols}`),
    row("Son Tick", fmtTs(lastTickAt)),
  ].join(""));

  const rejStr = topRejectedReasons.length > 0
    ? topRejectedReasons.map((r) => `${r.reason} (${r.count}x)`).join("<br>")
    : "—";
  html += section("3. Scanner Özeti", [
    row("Sinyal Üretilen (30dk)", `${recentSignalCount}`),
    row("Sinyal Sembolleri", recentSignalSymbols.length > 0 ? recentSignalSymbols.join(", ") : "—"),
    row("Top Red Sebepleri", rejStr),
  ].join(""));

  html += section("4. Paper Trading", [
    row("Açılan (30dk)", `${openedPaperTrades30m}`),
    row("Kapanan (30dk)", `${closedPaperTrades30m}`),
    row("Açık Pozisyon", `${openPaperPositions}`),
    row("Toplam PnL", fmtUsd(totalPaperPnl)),
    row("30dk PnL", fmtUsd(pnl30m)),
    row("Win Rate", `${fmt(winRate, 1)}%`),
    row("Profit Factor", fmt(profitFactor, 2)),
    row("Max Drawdown", fmtUsd(maxDrawdown)),
    row("SL ile Kapanan", `${slClosedCount}`),
    row("TP ile Kapanan", `${tpClosedCount}`),
    row("Toplam Kapanan", `${totalClosedTrades}`),
  ].join(""));

  html += section("5. Live Readiness", [
    row("Paper Trades", `${paperTradesCompleted} / ${paperTradesRequired}`),
    row("Hazır mı?", liveReady ? "✅ HAZIR" : "⏳ HENÜZ DEĞİL"),
    row("Strateji Skoru", `${strategyScore}/100${strategyBlocked ? " <span style='color:#c00'>⚠️ BLOKLANMIŞ</span>" : ""}`),
    row("Blocker", readinessBlockers.length > 0 ? readinessBlockers.join("; ") : "—"),
  ].join(""));

  html += section("6. Güvenlik Doğrulaması", [
    row("HARD_LIVE=false?", hardLiveTradingAllowedFalse ? "✅ EVET" : "<span style='color:#c00'>❌ HAYIR — ALARM</span>"),
    row("enable_live=false?", enableLiveTradingFalse ? "✅ EVET" : "<span style='color:#e08000'>⚠️ HAYIR</span>"),
    row("mode=paper?", tradingModePaper ? "✅ EVET" : "<span style='color:#e08000'>⚠️ HAYIR</span>"),
    row("Gerçek emir gönderildi?", realOrderSent ? "<span style='color:#c00'>❌ EVET — ALARM</span>" : "✅ HAYIR"),
    row("Kill Switch", killSwitchActive ? "<span style='color:#c00'>⚠️ AKTİF</span>" : "—"),
    row("Son Hata", lastError ?? "—"),
  ].join(""));

  html += `<hr style="margin:20px 0;border:none;border-top:1px solid #eee">
<p style="color:#aaa;font-size:11px;margin:0">
  CoinBot otomatik rapor — oluşturulma: ${fmtTs(metrics.generatedAt)} UTC<br>
  Alıcı: ${env.reportEmailTo}
</p>
</body></html>`;

  return html;
}

// ── Supabase persistence ──────────────────────────────────────────────────────

async function saveReport(params: {
  periodStart: string;
  periodEnd: string;
  recipientEmail: string;
  subject: string;
  body: string;
  status: "sent" | "failed" | "skipped";
  errorMessage?: string;
  metrics: unknown;
}): Promise<void> {
  if (!supabaseConfigured()) return;
  try {
    await supabaseAdmin().from("monitoring_reports").insert({
      period_start: params.periodStart,
      period_end: params.periodEnd,
      recipient_email: params.recipientEmail,
      subject: params.subject,
      body: params.body,
      status: params.status,
      error_message: params.errorMessage ?? null,
      metrics: params.metrics,
    });
  } catch {
    // Persistence failure must never surface to caller
  }
}

// ── SMTP check ────────────────────────────────────────────────────────────────

function smtpConfigured(): boolean {
  return Boolean(env.smtp.host && env.smtp.user && env.smtp.pass);
}

// ── Public API ────────────────────────────────────────────────────────────────

export type ReportResult = { ok: boolean; error?: string; status: "sent" | "failed" | "skipped" };

export async function sendMonitoringReport(metrics: MonitoringMetrics): Promise<ReportResult> {
  const recipientEmail = env.reportEmailTo;
  const subject = buildSubject(metrics);
  const body = buildHtmlBody(metrics);
  const saveBase = { periodStart: metrics.periodStart, periodEnd: metrics.periodEnd, recipientEmail, subject, body, metrics };

  if (!env.reportEmailEnabled) {
    await saveReport({ ...saveBase, status: "skipped" });
    return { ok: true, status: "skipped" };
  }

  if (!smtpConfigured()) {
    const error = "SMTP yapılandırılmamış (SMTP_HOST/SMTP_USER/SMTP_PASS eksik)";
    console.warn(`[report] ${error}`);
    await saveReport({ ...saveBase, status: "skipped", errorMessage: error });
    return { ok: false, error, status: "skipped" };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: { user: env.smtp.user, pass: env.smtp.pass },
    });

    await transporter.sendMail({
      from: env.smtp.from || env.smtp.user,
      to: recipientEmail,
      subject,
      html: body,
    });

    await saveReport({ ...saveBase, status: "sent" });
    return { ok: true, status: "sent" };
  } catch (e: any) {
    const errorMessage = e?.message ?? String(e);
    console.error(`[report] Email gönderilemedi: ${errorMessage}`);
    await saveReport({ ...saveBase, status: "failed", errorMessage });
    return { ok: false, error: errorMessage, status: "failed" };
  }
}
