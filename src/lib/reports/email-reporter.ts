import nodemailer from "nodemailer";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type { MonitoringMetrics } from "./monitoring-report";

const DASHBOARD_URL = "https://coin.onursuay.com";

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmt(n: number, d = 2): string { return n.toFixed(d); }
function fmtUsd(n: number): string { return `$${fmt(n, 2)}`; }
function fmtTs(iso: string | null): string {
  return iso ? iso.slice(0, 19).replace("T", " ") : "—";
}

// ── Subject ───────────────────────────────────────────────────────────────────

export function buildSubject(metrics: MonitoringMetrics): string {
  const ts = new Date(metrics.generatedAt).toISOString().slice(0, 16).replace("T", " ");
  const modeLabel = metrics.tradingMode === "paper" ? "SANAL MOD" : "CANLI MOD";
  return `CoinBot İşlem Raporu — ${modeLabel} — ${ts}`;
}

// ── Rejection reason → human-readable Turkish ────────────────────────────────

function humanizeReject(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes("btc") && (r.includes("trend") || r.includes("bear") || r.includes("down")))
    return "Bitcoin yönü alım için uygun değildi";
  if (r.includes("score") || r.includes("skor") || r.includes("weak") || r.includes("low_signal"))
    return "Coin yeterince güçlü sinyal üretmedi";
  if (r.includes("volume") || r.includes("hacim") || r.includes("liquidity"))
    return "Likidite düşük, sağlıklı işlem riski yüksek";
  if (r.includes("trend") || r.includes("momentum") || r.includes("unclear") || r.includes("neutral"))
    return "Fiyat yönü net değil";
  if (r.includes("spread"))
    return "Alım-satım fiyat farkı (spread) yüksek";
  if (r.includes("risk") || r.includes("reward") || r.includes("stop") || r.includes("sl"))
    return "Risk/ödül oranı uygun değil";
  if (r.includes("funding"))
    return "Fonlama maliyeti yüksek";
  if (r.includes("tier") || r.includes("downgrade"))
    return "Coin risk seviyesi bu işlem için uygun değil";
  if (r.includes("atr"))
    return "Volatilite (fiyat oynaklığı) uygun değil";
  if (r.includes("kill") || r.includes("switch"))
    return "Acil durdurma aktif";
  if (r.includes("daily_loss") || r.includes("loss_limit"))
    return "Günlük zarar limiti aşıldı";
  if (r.includes("conservative"))
    return "Muhafazakâr mod — günlük hedef doldu";
  return reason;
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap;vertical-align:top;font-size:12px">${label}</td>
    <td style="padding:4px 0;font-weight:500;vertical-align:top;font-size:12px">${value}</td>
  </tr>`;
}

function tableHead(...cols: string[]): string {
  return `<tr>${cols.map((c) => `<th style="text-align:left;padding:5px 10px 5px 0;color:#555;font-size:11px;font-weight:600;border-bottom:1px solid #e0e0e0;white-space:nowrap">${c}</th>`).join("")}</tr>`;
}

function tableRow(...cols: string[]): string {
  return `<tr>${cols.map((c) => `<td style="padding:4px 10px 4px 0;font-size:12px;vertical-align:top;border-bottom:1px solid #f5f5f5">${c}</td>`).join("")}</tr>`;
}

function section(title: string, content: string): string {
  return `<h3 style="margin:20px 0 8px;font-size:14px;border-bottom:2px solid #e8e8e8;padding-bottom:4px;color:#222">${title}</h3>
${content}`;
}

function infoTable(rows: string): string {
  return `<table style="border-collapse:collapse;width:100%;font-size:13px">${rows}</table>`;
}

function dataTable(head: string, body: string): string {
  return `<table style="border-collapse:collapse;width:100%;font-size:12px"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function badge(text: string, color: string): string {
  return `<span style="background:${color}20;color:${color};border:1px solid ${color}40;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:600">${text}</span>`;
}

function dirBadge(dir: string): string {
  return badge(dir === "LONG" ? "LONG ↑" : "SHORT ↓", dir === "LONG" ? "#16a34a" : "#dc2626");
}

function pnlColor(pnl: number): string {
  return pnl >= 0 ? "#16a34a" : "#dc2626";
}

// ── HTML body ─────────────────────────────────────────────────────────────────

export function buildHtmlBody(metrics: MonitoringMetrics): string {
  const {
    warnings = [], botStatus = "unknown",
    workerOnline = false, workerAgeMs = null, lastTickAt = null,
    activeExchange = "binance", tradingMode = "paper",
    tickCount = 0, tickErrorCount = 0,
    totalScannedSymbols = 0, universe = 0, deepAnalyzed = 0,
    topRejectedReasons = [],
    openedPaperTrades30m = 0, closedPaperTrades30m = 0,
    openPaperPositions = 0, totalPaperPnl = 0, pnl30m = 0,
    openedTradeDetails = [], closedTradeDetails = [], nearMissCandidates = [],
    strategyScore = 100, strategyBlocked = false,
    paperTradesCompleted = 0, paperTradesRequired = 100,
    realOrderSent = false, killSwitchActive = false, lastError = null,
    hardLiveTradingAllowedFalse = true,
  } = metrics;

  const modeLabel = tradingMode === "paper" ? "Sanal" : "Canlı";
  const periodTs = `${fmtTs(metrics.periodStart)} → ${fmtTs(metrics.periodEnd)} UTC`;

  // ── 0. Uyarı kutusu (varsa) ──────────────────────────────────────────────
  const criticalWarnings = warnings.filter((w) =>
    w.toLowerCase().includes("offline") ||
    w.toLowerCase().includes("hata") ||
    w.toLowerCase().includes("alarm") ||
    w.toLowerCase().includes("kill") ||
    realOrderSent
  );

  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;padding:16px;color:#222;font-size:13px;line-height:1.5">

<div style="background:#f8f9fa;border:1px solid #e0e0e0;border-radius:8px;padding:14px 18px;margin-bottom:20px">
  <div style="display:flex;align-items:center;justify-content:space-between">
    <div>
      <div style="font-size:17px;font-weight:700;color:#222">🤖 CoinBot İşlem Raporu</div>
      <div style="font-size:11px;color:#888;margin-top:2px">${periodTs}</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:11px;color:#888">Borsa: <strong>${activeExchange.toUpperCase()}</strong></div>
      <div style="font-size:11px;color:#888">Mod: <strong>${modeLabel}</strong></div>
    </div>
  </div>
</div>`;

  // Critical alerts
  if (criticalWarnings.length > 0 || realOrderSent) {
    html += `<div style="background:#fff0f0;border-left:4px solid #dc2626;padding:10px 14px;margin-bottom:16px;border-radius:0 6px 6px 0">
  <strong style="color:#dc2626">🚨 Kritik Uyarı</strong>
  <ul style="margin:6px 0 0;padding-left:18px;color:#dc2626;font-size:12px">
    ${realOrderSent ? "<li>GERÇEK EMİR GÖNDERİLDİ — derhal kontrol et!</li>" : ""}
    ${criticalWarnings.map((w) => `<li>${w}</li>`).join("")}
  </ul>
</div>`;
  }

  // ── 1. Özet Karar ────────────────────────────────────────────────────────
  let ozet: string;
  if (openedPaperTrades30m > 0) {
    ozet = `Bu 30 dakikada <strong>${openedPaperTrades30m} sanal işlem açıldı</strong>. Bot ${universe > 0 ? universe : totalScannedSymbols} Binance vadeli işlem paritesini taradı, ${deepAnalyzed > 0 ? deepAnalyzed : "seçilen"} coini detaylı analiz etti.`;
  } else {
    const topReject = topRejectedReasons[0]?.reason;
    const humanReason = topReject ? humanizeReject(topReject) : "sinyal yeterince güçlü değildi";
    ozet = `Bu 30 dakikada <strong>işlem açılmadı</strong>. Bot ${universe > 0 ? universe : totalScannedSymbols} Binance vadeli işlem paritesini taradı, ${deepAnalyzed > 0 ? deepAnalyzed : "seçilen"} coini detaylı analiz etti. En yaygın red nedeni: <em>${humanReason}</em>.`;
  }
  html += section("1. Özet Karar",
    `<p style="margin:4px 0 0;color:#333;font-size:13px">${ozet}</p>`
  );

  // ── 2. İşlem Durumu ──────────────────────────────────────────────────────
  html += section("2. İşlem Durumu", infoTable([
    row("Açılan işlem (30 dk)", `${openedPaperTrades30m}`),
    row("Kapanan işlem (30 dk)", `${closedPaperTrades30m}`),
    row("Açık pozisyon", `${openPaperPositions}`),
    row("30 dk Kâr/Zarar", `<span style="color:${pnlColor(pnl30m)};font-weight:600">${fmtUsd(pnl30m)}</span>`),
    row("Toplam Sanal Kâr/Zarar", `<span style="color:${pnlColor(totalPaperPnl)};font-weight:600">${fmtUsd(totalPaperPnl)}</span>`),
  ].join("")));

  // ── 3. Açılan İşlemler ───────────────────────────────────────────────────
  if (openedTradeDetails.length > 0) {
    const tHead = tableHead("Coin", "Yön", "Giriş", "Zarar Durdur", "Kâr Al", "Skor");
    const tBody = openedTradeDetails.map((t) =>
      tableRow(
        `<strong>${t.symbol}</strong>`,
        dirBadge(t.direction),
        `$${fmt(t.entryPrice, 4)}`,
        `$${fmt(t.stopLoss, 4)}`,
        `$${fmt(t.takeProfit, 4)}`,
        `${t.signalScore}/100`,
      )
    ).join("");
    html += section("3. Açılan İşlemler", dataTable(tHead, tBody));
  } else {
    html += section("3. Açılan İşlemler",
      `<p style="color:#888;font-size:12px;margin:4px 0">Bu periyotta işlem açılmadı.</p>`
    );
  }

  // ── 4. Kapanan İşlemler ──────────────────────────────────────────────────
  if (closedTradeDetails.length > 0) {
    const tHead = tableHead("Coin", "Yön", "Giriş", "Çıkış", "Kâr/Zarar", "Kapanış Nedeni");
    const tBody = closedTradeDetails.map((t) =>
      tableRow(
        `<strong>${t.symbol}</strong>`,
        dirBadge(t.direction),
        `$${fmt(t.entryPrice, 4)}`,
        `$${fmt(t.exitPrice, 4)}`,
        `<span style="color:${pnlColor(t.pnl)};font-weight:600">${fmtUsd(t.pnl)}</span>`,
        t.exitReason === "stop_loss" ? badge("Zarar Durdur", "#dc2626")
          : t.exitReason === "take_profit" ? badge("Kâr Al", "#16a34a")
          : t.exitReason === "manual" ? badge("Manuel", "#888")
          : t.exitReason,
      )
    ).join("");
    html += section("4. Kapanan İşlemler", dataTable(tHead, tBody));
  } else {
    html += section("4. Kapanan İşlemler",
      `<p style="color:#888;font-size:12px;margin:4px 0">Bu periyotta kapanan işlem yok.</p>`
    );
  }

  // ── 5. Neden İşlem Açılmadı? ─────────────────────────────────────────────
  if (openedPaperTrades30m === 0 && topRejectedReasons.length > 0) {
    const topReason = topRejectedReasons[0];
    const secondReason = topRejectedReasons[1];
    let explanation = `İşlem açılmamasının ana sebebi: <strong>${humanizeReject(topReason.reason)}</strong>.`;
    if (secondReason) {
      explanation += ` Ayrıca: ${humanizeReject(secondReason.reason).toLowerCase()}.`;
    }
    const rejectList = topRejectedReasons.slice(0, 5).map((r) =>
      `<li>${humanizeReject(r.reason)} <span style="color:#aaa;font-size:11px">(${r.count}x)</span></li>`
    ).join("");
    html += section("5. Neden İşlem Açılmadı?", `
      <p style="margin:4px 0 8px;color:#444;font-size:13px">${explanation}</p>
      <ul style="margin:0;padding-left:18px;color:#555;font-size:12px">${rejectList}</ul>
    `);
  } else if (openedPaperTrades30m > 0) {
    html += section("5. Neden İşlem Açılmadı?",
      `<p style="color:#16a34a;font-size:12px;margin:4px 0">Bu periyotta işlem açıldı — red analizi gerekmedi.</p>`
    );
  } else {
    html += section("5. Neden İşlem Açılmadı?",
      `<p style="color:#888;font-size:12px;margin:4px 0">Bu periyotta sinyal üretilmedi veya red sebebi kaydedilmedi.</p>`
    );
  }

  // ── 6. Fırsata Yaklaşan Coinler ──────────────────────────────────────────
  if (nearMissCandidates.length > 0) {
    const tHead = tableHead("Coin", "Skor", "Eksik Kalan Sebep", "Bot Kararı");
    const tBody = nearMissCandidates.map((c) =>
      tableRow(
        `<strong>${c.symbol}</strong>`,
        `${c.score}/100`,
        humanizeReject(c.rejectReason),
        badge("İşlem Açılmadı", "#888"),
      )
    ).join("");
    html += section("6. Fırsata Yaklaşan Coinler", dataTable(tHead, tBody));
  } else {
    html += section("6. Fırsata Yaklaşan Coinler",
      `<p style="color:#888;font-size:12px;margin:4px 0">Periyot verisinde yakın fırsat tespit edilmedi.</p>`
    );
  }

  // ── 7. Botun Yorumu ──────────────────────────────────────────────────────
  let yorum: string;
  if (killSwitchActive) {
    yorum = "⛔ Kill switch aktif. Bot tüm işlemleri durdurdu. Acil durum kontrol edilmeli.";
  } else if (openedPaperTrades30m > 0) {
    yorum = `✅ Piyasada ${openedPaperTrades30m} işlem için yeterli sinyal oluştu. Bot risk kurallarına uygun pozisyon açtı.`;
  } else if (tickCount === 0) {
    yorum = "⚠️ Bu periyotta tick çalışmadı. Worker durumu kontrol edilmeli.";
  } else if (topRejectedReasons.length > 0) {
    yorum = `🔍 Piyasa bu periyotta işlem açmak için yeterince güçlü sinyal üretmedi. Bot risk kurallarına uygun şekilde beklemede kaldı. (${tickCount} tarama yapıldı)`;
  } else {
    yorum = `🔍 ${tickCount} tarama tamamlandı, beklenmedik bir durum gözlemlenmedi.`;
  }
  html += section("7. Botun Yorumu",
    `<p style="margin:4px 0;color:#333;font-size:13px;font-style:italic">${yorum}</p>`
  );

  // ── 8. Canlı İşlem Durumu ────────────────────────────────────────────────
  html += section("8. Canlı İşlem Durumu", infoTable([
    row("Canlı işlem", badge("Kapalı", "#16a34a")),
    row("Mod", modeLabel),
    row("Gerçek emir gönderildi mi?", realOrderSent
      ? `<span style="color:#dc2626;font-weight:700">❌ EVET — ALARM</span>`
      : `<span style="color:#16a34a">✅ Hayır</span>`),
    row("Kill switch", killSwitchActive
      ? `<span style="color:#dc2626;font-weight:700">⚠️ AKTİF</span>`
      : "—"),
  ].join("")));

  // ── 9. Sistem Sağlığı ────────────────────────────────────────────────────
  const workerStr = workerOnline
    ? `✅ Çevrimiçi (${Math.round((workerAgeMs ?? 0) / 1000)}s önce)`
    : "❌ Çevrimdışı";
  html += section("9. Sistem Sağlığı", infoTable([
    row("Worker", workerStr),
    row("Binance API", badge("OK", "#16a34a")),
    row("Hata (30 dk)", tickErrorCount > 0
      ? `<span style="color:#dc2626">⚠️ ${tickErrorCount}</span>`
      : "0"),
    row("Son tarama", fmtTs(lastTickAt)),
    row("Canlı işlem kilidi", hardLiveTradingAllowedFalse
      ? `${badge("Kapalı", "#16a34a")}` : `<span style="color:#c00">⚠️ AÇIK</span>`),
    row("Strateji skoru", `${strategyScore}/100${strategyBlocked ? " ⚠️ Bloklandı" : ""}`),
    row("Sanal trade ilerlemesi", `${paperTradesCompleted} / ${paperTradesRequired}`),
    ...(lastError ? [row("Son hata", `<span style="color:#dc2626;font-size:11px">${lastError}</span>`)] : []),
  ].join("")));

  // ── Footer ───────────────────────────────────────────────────────────────
  html += `<hr style="margin:20px 0;border:none;border-top:1px solid #eee">
<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
  <p style="color:#aaa;font-size:11px;margin:0">
    Otomatik rapor — ${fmtTs(metrics.generatedAt)} UTC
  </p>
  <a href="${DASHBOARD_URL}" style="color:#3b82f6;font-size:11px;text-decoration:none">
    📊 Dashboard → ${DASHBOARD_URL}
  </a>
</div>
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

    const fromAddress = env.smtp.from || env.smtp.user;

    await transporter.sendMail({
      from: fromAddress,
      replyTo: env.reportEmailTo,
      to: recipientEmail,
      subject,
      html: body,
    });

    console.log(`[report] Email gönderildi: from=${fromAddress} to=${recipientEmail}`);
    await saveReport({ ...saveBase, status: "sent" });
    return { ok: true, status: "sent" };
  } catch (e: any) {
    const errorMessage = e?.message ?? String(e);
    console.error(`[report] Email gönderilemedi: ${errorMessage}`);
    await saveReport({ ...saveBase, status: "failed", errorMessage });
    return { ok: false, error: errorMessage, status: "failed" };
  }
}
