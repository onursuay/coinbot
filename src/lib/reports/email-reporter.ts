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

// ── Design tokens ─────────────────────────────────────────────────────────────

const C = {
  bg: "#f3f4f6",
  card: "#ffffff",
  border: "#e5e7eb",
  borderSoft: "#f1f5f9",
  text: "#0f172a",
  textMuted: "#64748b",
  textFaint: "#94a3b8",
  primary: "#6366f1",
  primaryDark: "#4f46e5",
  accent: "#8b5cf6",
  success: "#10b981",
  successBg: "#ecfdf5",
  danger: "#ef4444",
  dangerBg: "#fef2f2",
  warning: "#f59e0b",
  warningBg: "#fffbeb",
  info: "#0ea5e9",
  infoBg: "#f0f9ff",
};

// ── HTML helpers ──────────────────────────────────────────────────────────────

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:8px 14px 8px 0;color:${C.textMuted};white-space:nowrap;vertical-align:top;font-size:12.5px;border-bottom:1px solid ${C.borderSoft}">${label}</td>
    <td style="padding:8px 0;font-weight:600;vertical-align:top;font-size:12.5px;color:${C.text};text-align:right;border-bottom:1px solid ${C.borderSoft}">${value}</td>
  </tr>`;
}

function tableHead(...cols: string[]): string {
  return `<tr>${cols.map((c) => `<th style="text-align:left;padding:10px 12px;color:${C.textMuted};font-size:10.5px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;background:#f8fafc;border-bottom:1px solid ${C.border};white-space:nowrap">${c}</th>`).join("")}</tr>`;
}

function tableRow(...cols: string[]): string {
  return `<tr>${cols.map((c) => `<td style="padding:10px 12px;font-size:12.5px;vertical-align:middle;border-bottom:1px solid ${C.borderSoft};color:${C.text}">${c}</td>`).join("")}</tr>`;
}

function section(title: string, accent: string, icon: string, content: string): string {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${C.card};border:1px solid ${C.border};border-radius:14px;margin:0 0 14px;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,0.04)">
  <tr>
    <td style="padding:16px 20px 4px">
      <div style="display:inline-block;vertical-align:middle">
        <span style="display:inline-block;width:30px;height:30px;line-height:30px;text-align:center;background:linear-gradient(135deg,${accent} 0%,${accent}cc 100%);color:#fff;border-radius:8px;font-size:14px;vertical-align:middle;margin-right:10px">${icon}</span>
        <span style="display:inline-block;vertical-align:middle;font-size:14px;font-weight:700;color:${C.text};letter-spacing:-0.2px">${title}</span>
      </div>
    </td>
  </tr>
  <tr>
    <td style="padding:6px 20px 18px">${content}</td>
  </tr>
</table>`;
}

function infoTable(rows: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;font-size:13px">${rows}</table>`;
}

function dataTable(head: string, body: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;font-size:12px;border:1px solid ${C.border};border-radius:10px;overflow:hidden"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function badge(text: string, color: string): string {
  return `<span style="display:inline-block;background:${color}1a;color:${color};border:1px solid ${color}33;padding:3px 9px;border-radius:999px;font-size:10.5px;font-weight:700;letter-spacing:0.3px;line-height:1.4">${text}</span>`;
}

function pillBadge(text: string, color: string, bg: string): string {
  return `<span style="display:inline-block;background:${bg};color:${color};padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.2px">${text}</span>`;
}

function dirBadge(dir: string): string {
  return dir === "LONG"
    ? `<span style="display:inline-block;background:${C.successBg};color:${C.success};padding:3px 9px;border-radius:999px;font-size:10.5px;font-weight:700;border:1px solid ${C.success}33">▲ LONG</span>`
    : `<span style="display:inline-block;background:${C.dangerBg};color:${C.danger};padding:3px 9px;border-radius:999px;font-size:10.5px;font-weight:700;border:1px solid ${C.danger}33">▼ SHORT</span>`;
}

function pnlColor(pnl: number): string {
  return pnl >= 0 ? C.success : C.danger;
}

function statCard(label: string, value: string, color: string, bg: string): string {
  return `<td style="width:33.33%;padding:6px" valign="top">
    <div style="background:${bg};border:1px solid ${color}26;border-radius:12px;padding:14px 12px;text-align:center">
      <div style="font-size:10.5px;color:${C.textMuted};text-transform:uppercase;letter-spacing:0.5px;font-weight:600;margin-bottom:6px">${label}</div>
      <div style="font-size:22px;font-weight:800;color:${color};letter-spacing:-0.5px;line-height:1.1">${value}</div>
    </div>
  </td>`;
}

// ── HTML body ─────────────────────────────────────────────────────────────────

export function buildHtmlBody(metrics: MonitoringMetrics): string {
  const {
    warnings = [], botStatus = "unknown",
    workerOnline = false, workerAgeMs = null, lastTickAt = null,
    activeExchange = "binance", tradingMode = "paper",
    tickCount = 0, tickErrorCount = 0,
    topRejectedReasons = [], lowVolumeRejectedCount = 0,
    openedPaperTrades30m = 0, closedPaperTrades30m = 0,
    openPaperPositions = 0, totalPaperPnl = 0, pnl30m = 0,
    openedTradeDetails = [], closedTradeDetails = [], nearMissCandidates = [],
    realOrderSent = false, killSwitchActive = false, lastError = null,
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

  const modePillColor = tradingMode === "paper" ? C.info : C.warning;
  const modePillBg = tradingMode === "paper" ? C.infoBg : C.warningBg;

  let html = `<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CoinBot İşlem Raporu</title></head>
<body style="margin:0;padding:0;background:${C.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${C.text};-webkit-font-smoothing:antialiased">
<div style="background:${C.bg};padding:24px 12px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="width:100%;max-width:680px;margin:0 auto">

<!-- ═══ HEADER ═══ -->
<tr><td>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 50%,#ec4899 100%);border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(99,102,241,0.25)">
    <tr><td style="padding:28px 28px 24px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%">
        <tr>
          <td style="vertical-align:middle">
            <div style="display:inline-block;background:rgba(255,255,255,0.18);backdrop-filter:blur(10px);padding:6px 12px;border-radius:999px;font-size:10.5px;color:#fff;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:14px">
              📊 İşlem Raporu
            </div>
            <div style="font-size:24px;font-weight:800;color:#fff;letter-spacing:-0.6px;line-height:1.2">CoinBot</div>
            <div style="font-size:13px;color:rgba(255,255,255,0.9);margin-top:6px;font-weight:500">${periodTs}</div>
          </td>
          <td style="vertical-align:top;text-align:right;width:140px">
            <div style="display:inline-block;background:rgba(255,255,255,0.95);padding:8px 12px;border-radius:10px;text-align:right">
              <div style="font-size:9.5px;color:${C.textMuted};font-weight:700;text-transform:uppercase;letter-spacing:0.5px">Borsa</div>
              <div style="font-size:13px;color:${C.text};font-weight:800;margin-top:2px">${activeExchange.toUpperCase()}</div>
              <div style="font-size:9.5px;color:${C.textMuted};font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-top:8px">Mod</div>
              <div style="margin-top:3px">${pillBadge(modeLabel.toUpperCase(), modePillColor, modePillBg)}</div>
            </div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</td></tr>

<tr><td style="height:18px;line-height:18px;font-size:0">&nbsp;</td></tr>`;

  // ── Kritik Uyarı ─────────────────────────────────────────────────────────
  if (criticalWarnings.length > 0 || realOrderSent) {
    html += `
<tr><td>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:linear-gradient(135deg,#fef2f2 0%,#fee2e2 100%);border:1.5px solid ${C.danger};border-radius:14px;overflow:hidden">
    <tr><td style="padding:16px 20px">
      <div style="font-size:14px;font-weight:800;color:${C.danger};margin-bottom:6px">🚨 KRİTİK UYARI</div>
      <ul style="margin:0;padding-left:20px;color:#991b1b;font-size:12.5px;line-height:1.6">
        ${realOrderSent ? `<li><strong>GERÇEK EMİR GÖNDERİLDİ</strong> — derhal kontrol et!</li>` : ""}
        ${criticalWarnings.map((w) => `<li>${w}</li>`).join("")}
      </ul>
    </td></tr>
  </table>
</td></tr>
<tr><td style="height:14px;line-height:14px;font-size:0">&nbsp;</td></tr>`;
  }

  // ── 1. Özet Karar ────────────────────────────────────────────────────────
  let ozet: string;
  let ozetAccent: string;
  if (openedPaperTrades30m > 0) {
    ozet = `Bu 30 dakikada <strong style="color:${C.success}">${openedPaperTrades30m} sanal işlem açıldı</strong>. Bot piyasayı taradı, risk kurallarına uygun pozisyon açtı.`;
    ozetAccent = C.success;
  } else {
    const topReject = topRejectedReasons[0]?.reason;
    const humanReason = topReject ? humanizeReject(topReject) : "sinyal yeterince güçlü değildi";
    ozet = `Bu 30 dakikada <strong>işlem açılmadı</strong>. Bot piyasayı taradı ancak işlem kalitesini geçen coin bulamadı. En yaygın neden: <em style="color:${C.primary};font-style:normal;font-weight:600">${humanReason}</em>.`;
    ozetAccent = C.primary;
  }
  html += `
<tr><td>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${C.card};border:1px solid ${C.border};border-left:4px solid ${ozetAccent};border-radius:14px;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,0.04)">
    <tr><td style="padding:18px 22px">
      <div style="font-size:11px;color:${ozetAccent};font-weight:800;letter-spacing:0.6px;text-transform:uppercase;margin-bottom:8px">Özet Karar</div>
      <div style="font-size:13.5px;color:${C.text};line-height:1.6">${ozet}</div>
    </td></tr>
  </table>
</td></tr>
<tr><td style="height:14px;line-height:14px;font-size:0">&nbsp;</td></tr>`;

  // ── 2. İşlem Durumu — Stat grid ──────────────────────────────────────────
  const opened30Color = openedPaperTrades30m > 0 ? C.success : C.textFaint;
  const opened30Bg = openedPaperTrades30m > 0 ? C.successBg : "#f8fafc";
  const closed30Color = closedPaperTrades30m > 0 ? C.info : C.textFaint;
  const closed30Bg = closedPaperTrades30m > 0 ? C.infoBg : "#f8fafc";
  const openPosColor = openPaperPositions > 0 ? C.warning : C.textFaint;
  const openPosBg = openPaperPositions > 0 ? C.warningBg : "#f8fafc";
  const pnl30Color = pnl30m === 0 ? C.textFaint : pnlColor(pnl30m);
  const pnl30Bg = pnl30m === 0 ? "#f8fafc" : (pnl30m > 0 ? C.successBg : C.dangerBg);
  const totalPnlColor = totalPaperPnl === 0 ? C.textFaint : pnlColor(totalPaperPnl);
  const totalPnlBg = totalPaperPnl === 0 ? "#f8fafc" : (totalPaperPnl > 0 ? C.successBg : C.dangerBg);

  html += section("İşlem Durumu", C.primary, "📊", `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;border-spacing:0;margin:0 -6px">
      <tr>
        ${statCard("Açılan (30dk)", `${openedPaperTrades30m}`, opened30Color, opened30Bg)}
        ${statCard("Kapanan (30dk)", `${closedPaperTrades30m}`, closed30Color, closed30Bg)}
        ${statCard("Açık Pozisyon", `${openPaperPositions}`, openPosColor, openPosBg)}
      </tr>
      <tr><td colspan="3" style="height:8px;line-height:8px;font-size:0">&nbsp;</td></tr>
      <tr>
        <td colspan="3" style="padding:6px">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%">
            <tr>
              <td style="width:50%;padding-right:6px" valign="top">
                <div style="background:${pnl30Bg};border:1px solid ${pnl30Color}26;border-radius:12px;padding:14px 14px;text-align:center">
                  <div style="font-size:10.5px;color:${C.textMuted};text-transform:uppercase;letter-spacing:0.5px;font-weight:600;margin-bottom:6px">30 dk Kâr/Zarar</div>
                  <div style="font-size:20px;font-weight:800;color:${pnl30Color};letter-spacing:-0.5px">${fmtUsd(pnl30m)}</div>
                </div>
              </td>
              <td style="width:50%;padding-left:6px" valign="top">
                <div style="background:${totalPnlBg};border:1px solid ${totalPnlColor}26;border-radius:12px;padding:14px 14px;text-align:center">
                  <div style="font-size:10.5px;color:${C.textMuted};text-transform:uppercase;letter-spacing:0.5px;font-weight:600;margin-bottom:6px">Toplam Sanal P/L</div>
                  <div style="font-size:20px;font-weight:800;color:${totalPnlColor};letter-spacing:-0.5px">${fmtUsd(totalPaperPnl)}</div>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `);

  // ── 3. Açılan İşlemler ───────────────────────────────────────────────────
  if (openedTradeDetails.length > 0) {
    const tHead = tableHead("Coin", "Yön", "Giriş", "Stop", "Hedef", "Skor");
    const tBody = openedTradeDetails.map((t) =>
      tableRow(
        `<strong style="color:${C.text};font-weight:700">${t.symbol}</strong>`,
        dirBadge(t.direction),
        `<span style="color:${C.text};font-weight:600">$${fmt(t.entryPrice, 4)}</span>`,
        `<span style="color:${C.danger};font-weight:600">$${fmt(t.stopLoss, 4)}</span>`,
        `<span style="color:${C.success};font-weight:600">$${fmt(t.takeProfit, 4)}</span>`,
        `<span style="display:inline-block;background:${C.primary}1a;color:${C.primary};padding:3px 9px;border-radius:999px;font-size:11px;font-weight:700">${t.signalScore}/100</span>`,
      )
    ).join("");
    html += section("Açılan İşlemler", C.success, "🟢", dataTable(tHead, tBody));
  } else {
    html += section("Açılan İşlemler", C.textFaint, "⚪", `
      <div style="text-align:center;padding:18px;color:${C.textMuted};font-size:12.5px;background:#f8fafc;border-radius:10px;border:1px dashed ${C.border}">
        Bu periyotta işlem açılmadı.
      </div>
    `);
  }

  // ── 4. Kapanan İşlemler ──────────────────────────────────────────────────
  if (closedTradeDetails.length > 0) {
    const tHead = tableHead("Coin", "Yön", "Giriş", "Çıkış", "Kâr/Zarar", "Sebep");
    const tBody = closedTradeDetails.map((t) =>
      tableRow(
        `<strong style="color:${C.text};font-weight:700">${t.symbol}</strong>`,
        dirBadge(t.direction),
        `<span style="color:${C.text};font-weight:600">$${fmt(t.entryPrice, 4)}</span>`,
        `<span style="color:${C.text};font-weight:600">$${fmt(t.exitPrice, 4)}</span>`,
        `<span style="color:${pnlColor(t.pnl)};font-weight:800">${fmtUsd(t.pnl)}</span>`,
        t.exitReason === "stop_loss" ? badge("Zarar Durdur", C.danger)
          : t.exitReason === "take_profit" ? badge("Kâr Al", C.success)
          : t.exitReason === "manual" ? badge("Manuel", C.textMuted)
          : t.exitReason,
      )
    ).join("");
    html += section("Kapanan İşlemler", C.info, "🔵", dataTable(tHead, tBody));
  } else {
    html += section("Kapanan İşlemler", C.textFaint, "⚪", `
      <div style="text-align:center;padding:18px;color:${C.textMuted};font-size:12.5px;background:#f8fafc;border-radius:10px;border:1px dashed ${C.border}">
        Bu periyotta kapanan işlem yok.
      </div>
    `);
  }

  // ── 5. Neden İşlem Açılmadı? ─────────────────────────────────────────────
  if (openedPaperTrades30m > 0) {
    html += section("Neden İşlem Açılmadı?", C.success, "✅", `
      <div style="background:${C.successBg};border:1px solid ${C.success}33;border-radius:10px;padding:14px;color:${C.success};font-size:12.5px;font-weight:600">
        Bu periyotta işlem açıldı — red analizi gerekmedi.
      </div>
    `);
  } else if (topRejectedReasons.length > 0 || lowVolumeRejectedCount > 0) {
    const topReason = topRejectedReasons[0];
    let explanation = topReason
      ? `İşlem açılmamasının ana sebebi: <strong style="color:${C.warning}">${humanizeReject(topReason.reason)}</strong>.`
      : "Bu periyotta sinyal eşiğini aşan coin oluşmadı.";
    if (topRejectedReasons[1]) {
      explanation += ` Ayrıca: ${humanizeReject(topRejectedReasons[1].reason).toLowerCase()}.`;
    }
    let rejectItems: string[] = [];
    if (lowVolumeRejectedCount > 0) {
      rejectItems.push(`<tr><td style="padding:9px 14px;border-bottom:1px solid ${C.borderSoft}"><span style="color:${C.text};font-size:12.5px">Likiditesi düşük coinler analize alınmadı</span></td><td style="padding:9px 14px;border-bottom:1px solid ${C.borderSoft};text-align:right">${pillBadge(`${lowVolumeRejectedCount}×`, C.textMuted, "#f1f5f9")}</td></tr>`);
    }
    rejectItems = rejectItems.concat(topRejectedReasons.slice(0, 4).map((r) =>
      `<tr><td style="padding:9px 14px;border-bottom:1px solid ${C.borderSoft}"><span style="color:${C.text};font-size:12.5px">${humanizeReject(r.reason)}</span></td><td style="padding:9px 14px;border-bottom:1px solid ${C.borderSoft};text-align:right">${pillBadge(`${r.count}×`, C.warning, C.warningBg)}</td></tr>`
    ));
    html += section("Neden İşlem Açılmadı?", C.warning, "🤔", `
      <div style="background:${C.warningBg};border:1px solid ${C.warning}33;border-radius:10px;padding:12px 14px;color:#78350f;font-size:12.5px;line-height:1.6;margin-bottom:10px">${explanation}</div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:1px solid ${C.border};border-radius:10px;overflow:hidden">
        ${rejectItems.join("")}
      </table>
    `);
  } else {
    html += section("Neden İşlem Açılmadı?", C.textFaint, "⚪", `
      <div style="text-align:center;padding:18px;color:${C.textMuted};font-size:12.5px;background:#f8fafc;border-radius:10px;border:1px dashed ${C.border}">
        Bu periyotta sinyal üretilmedi veya red sebebi kaydedilmedi.
      </div>
    `);
  }

  // ── 6. Fırsata Yaklaşan Coinler ──────────────────────────────────────────
  if (nearMissCandidates.length > 0) {
    const tHead = tableHead("Coin", "Skor", "Eksik Sebep", "Karar");
    const tBody = nearMissCandidates.map((c) =>
      tableRow(
        `<strong style="color:${C.text};font-weight:700">${c.symbol}</strong>`,
        `<span style="display:inline-block;background:${C.accent}1a;color:${C.accent};padding:3px 9px;border-radius:999px;font-size:11px;font-weight:700">${c.score}/100</span>`,
        `<span style="color:${C.textMuted};font-size:12px">${humanizeReject(c.rejectReason)}</span>`,
        badge("Pas", C.textMuted),
      )
    ).join("");
    html += section("Fırsata Yaklaşan Coinler", C.accent, "🎯", dataTable(tHead, tBody));
  } else {
    html += section("Fırsata Yaklaşan Coinler", C.textFaint, "⚪", `
      <div style="text-align:center;padding:18px;color:${C.textMuted};font-size:12.5px;background:#f8fafc;border-radius:10px;border:1px dashed ${C.border}">
        Periyot verisinde yakın fırsat tespit edilmedi.
      </div>
    `);
  }

  // ── 7. Botun Yorumu ──────────────────────────────────────────────────────
  let yorum: string;
  let yorumColor: string;
  let yorumBg: string;
  let yorumIcon: string;
  if (killSwitchActive) {
    yorum = "Kill switch aktif. Bot tüm işlemleri durdurdu. Acil durum kontrol edilmeli.";
    yorumColor = C.danger; yorumBg = C.dangerBg; yorumIcon = "⛔";
  } else if (openedPaperTrades30m > 0) {
    yorum = `Piyasada ${openedPaperTrades30m} işlem için yeterli sinyal oluştu. Bot risk kurallarına uygun pozisyon açtı.`;
    yorumColor = C.success; yorumBg = C.successBg; yorumIcon = "✅";
  } else if (tickCount === 0) {
    yorum = "Bu periyotta tick çalışmadı. Worker durumu kontrol edilmeli.";
    yorumColor = C.warning; yorumBg = C.warningBg; yorumIcon = "⚠️";
  } else if (topRejectedReasons.length > 0 || lowVolumeRejectedCount > 0) {
    yorum = "Piyasa bu periyotta işlem açmak için yeterince güçlü sinyal üretmedi. Bot risk kurallarına uygun şekilde beklemede kaldı.";
    yorumColor = C.info; yorumBg = C.infoBg; yorumIcon = "🔍";
  } else {
    yorum = "Bot bu periyotta piyasayı izledi, beklenmedik bir durum gözlemlenmedi.";
    yorumColor = C.info; yorumBg = C.infoBg; yorumIcon = "🔍";
  }
  html += section("Botun Yorumu", yorumColor, "💬", `
    <div style="background:${yorumBg};border:1px solid ${yorumColor}33;border-radius:12px;padding:16px 18px">
      <span style="font-size:18px;float:left;margin-right:10px;line-height:1.3">${yorumIcon}</span>
      <div style="font-size:13px;color:${C.text};line-height:1.6;font-weight:500;overflow:hidden">${yorum}</div>
    </div>
  `);

  // ── 8. Güvenlik & Sistem Sağlığı (yan yana) ──────────────────────────────
  const safetyRows = [
    row("Mod", pillBadge(modeLabel, C.success, C.successBg)),
    row("Canlı işlem", pillBadge("Kapalı", C.success, C.successBg)),
    row("Gerçek emir", realOrderSent
      ? pillBadge("EVET — ALARM", "#ffffff", C.danger)
      : pillBadge("Hayır", C.success, C.successBg)),
    ...(killSwitchActive ? [row("Kill switch", pillBadge("AKTİF", "#ffffff", C.danger))] : []),
  ].join("");

  const workerStr = workerOnline
    ? pillBadge(`Online · ${Math.round((workerAgeMs ?? 0) / 1000)}s`, C.success, C.successBg)
    : pillBadge("Offline", "#ffffff", C.danger);
  const healthRows = [
    row("Worker", workerStr),
    row("Binance API", pillBadge("OK", C.success, C.successBg)),
    row("Hata (30 dk)", tickErrorCount > 0
      ? pillBadge(`${tickErrorCount}`, "#ffffff", C.danger)
      : pillBadge("0", C.success, C.successBg)),
    row("Son tarama", `<span style="color:${C.textMuted};font-size:11.5px;font-weight:500">${fmtTs(lastTickAt)}</span>`),
    ...(lowVolumeRejectedCount > 0 ? [row("Düşük hacim filtresi", `<span style="color:${C.textMuted};font-weight:600">${lowVolumeRejectedCount} coin</span>`)] : []),
    ...(lastError ? [row("Son hata", `<span style="color:${C.danger};font-size:11px">${lastError}</span>`)] : []),
  ].join("");

  html += section("Güvenlik", C.success, "🛡️", infoTable(safetyRows));
  html += section("Sistem Sağlığı", C.info, "❤️", infoTable(healthRows));

  // ── Footer ───────────────────────────────────────────────────────────────
  html += `
<tr><td style="height:6px;line-height:6px;font-size:0">&nbsp;</td></tr>
<tr><td>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);border-radius:14px;overflow:hidden">
    <tr><td style="padding:20px 24px;text-align:center">
      <a href="${DASHBOARD_URL}" style="display:inline-block;background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);color:#fff;text-decoration:none;padding:11px 26px;border-radius:10px;font-size:13px;font-weight:700;letter-spacing:0.2px;box-shadow:0 4px 14px rgba(99,102,241,0.4)">
        📊 Dashboard&apos;u Aç
      </a>
      <div style="margin-top:14px;font-size:11px;color:#94a3b8;font-weight:500">
        Otomatik rapor · ${fmtTs(metrics.generatedAt)} UTC
      </div>
      <div style="margin-top:4px;font-size:10.5px;color:#64748b">
        <a href="${DASHBOARD_URL}" style="color:#94a3b8;text-decoration:none">${DASHBOARD_URL.replace("https://", "")}</a>
      </div>
    </td></tr>
  </table>
</td></tr>

<tr><td style="height:14px;line-height:14px;font-size:0">&nbsp;</td></tr>
<tr><td style="text-align:center;padding:0 12px">
  <div style="font-size:10.5px;color:${C.textFaint};line-height:1.5">
    Bu e-posta CoinBot tarafından otomatik olarak oluşturulmuştur.<br>
    İçeriği kişiseldir — paylaşmamanız tavsiye edilir.
  </div>
</td></tr>

</table>
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
