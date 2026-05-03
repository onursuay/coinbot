// AI Aksiyon Merkezi — Faz 2: ActionPlan'dan Claude Code/GitHub promptu üret.
//
// MUTLAK KURALLAR:
//   • Üretilen prompt yorumlayıcıdır; ayar UYGULANMAZ.
//   • Prompt body içinde live trading açma talimatı OLMAZ.
//   • SL/TP algoritması, signal threshold, BTC trend filtresi değiştirme
//     talimatı VERMEZ.
//   • Her prompt başında güvenlik kuralları açıkça yazılır.

import type { ActionPlan } from "./types";

const SAFETY_HEADER = `## Güvenlik Kuralları (asla ihlal etme)
- Bu prompt yorum/inceleme amaçlıdır; otomatik ayar değişikliği yapılmamalıdır.
- HARD_LIVE_TRADING_ALLOWED=false korunmalı.
- enable_live_trading=false korunmalı.
- DEFAULT_TRADING_MODE=paper korunmalı.
- /fapi/v1/order veya /fapi/v1/leverage çağrısı eklenmemeli.
- MIN_SIGNAL_CONFIDENCE=70 düşürülmemeli.
- BTC trend filtresi kapatılmamalı.
- Risk parametresi otomatik artırılmamalı; yalnızca düşürme önerisi
  kullanıcı onayıyla uygulanır.`;

export function buildActionPrompt(plan: ActionPlan): string {
  const lines: string[] = [];
  lines.push(`# AI Aksiyon Önerisi — ${plan.title}`);
  lines.push("");
  lines.push(`**Tip:** ${plan.type}`);
  lines.push(`**Kaynak:** ${plan.source}`);
  lines.push(`**Risk seviyesi:** ${plan.riskLevel}`);
  lines.push(`**Güven:** %${plan.confidence}`);
  lines.push(`**Onay gerekir:** ${plan.requiresApproval ? "evet" : "hayır"}`);
  lines.push("");
  lines.push(`## Özet`);
  lines.push(plan.summary);
  lines.push("");
  lines.push(`## Gerekçe`);
  lines.push(plan.reason);
  if (plan.currentValue || plan.recommendedValue) {
    lines.push("");
    lines.push(`## Değer Değişikliği Önerisi`);
    lines.push(`- Mevcut: ${plan.currentValue ?? "—"}`);
    lines.push(`- Önerilen: ${plan.recommendedValue ?? "—"}`);
  }
  lines.push("");
  lines.push(`## Beklenen Etki`);
  lines.push(plan.impact);
  lines.push("");
  lines.push(SAFETY_HEADER);
  lines.push("");
  lines.push(`## Uygulama Notu`);
  lines.push(typeApplicationNote(plan));
  return lines.join("\n");
}

function typeApplicationNote(plan: ActionPlan): string {
  switch (plan.type) {
    case "UPDATE_RISK_PER_TRADE_DOWN":
      return [
        "Risk Yönetimi sayfasında 'İşlem başı risk %' alanını manuel olarak",
        `${plan.recommendedValue ?? "önerilen değer"} olacak şekilde güncelle.`,
        "Bot durdurmaya gerek yoktur; ayar bir sonraki tick'te etkinleşir.",
        "Otomatik uygulama YOK — kullanıcı kontrolündedir.",
      ].join(" ");
    case "UPDATE_MAX_DAILY_LOSS_DOWN":
      return [
        "Risk Yönetimi sayfasında 'Günlük maksimum zarar %' alanını manuel olarak",
        `${plan.recommendedValue ?? "önerilen değer"} olarak ayarla.`,
        "Otomatik uygulama YOK.",
      ].join(" ");
    case "UPDATE_MAX_OPEN_POSITIONS_DOWN":
      return [
        "Risk Yönetimi sayfasında 'Aynı anda açık pozisyon limiti' alanını manuel olarak",
        `${plan.recommendedValue ?? "önerilen değer"} olarak ayarla.`,
        "Açık pozisyonlar etkilenmez; yeni pozisyon limiti uygulanır.",
        "Otomatik uygulama YOK.",
      ].join(" ");
    case "UPDATE_MAX_DAILY_TRADES_DOWN":
      return [
        "Risk Yönetimi sayfasında 'Günlük maksimum işlem sayısı' alanını manuel olarak",
        `${plan.recommendedValue ?? "önerilen değer"} olarak ayarla.`,
        "Otomatik uygulama YOK.",
      ].join(" ");
    case "SET_OBSERVATION_MODE":
      return "Bot çalışmaya devam ederken hiçbir parametre değişikliği yapma. Veri biriktikçe öneriler etkinleşir.";
    case "REQUEST_MANUAL_REVIEW":
      return "İlgili sayfada (Risk / Strateji / Performans) ayarları manuel incele. Otomatik aksiyon yok.";
    case "CREATE_IMPLEMENTATION_PROMPT":
      return "Üretilen promptu Claude Code'a yapıştır; uygulama kullanıcı kontrolündedir.";
    default:
      return "Manuel inceleme önerilir.";
  }
}
