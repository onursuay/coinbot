// AI Aksiyon Merkezi — Faz 1.1 pasif entegrasyon testleri (cache + TTL).
//
// Doğrulanan invaryantlar:
//   • /ai-actions sayfa LLM endpoint'ine her render'da TÜRBİN HİT yapmaz —
//     /api/ai-actions/decision çağrılır ve backend snapshot hash + TTL ile
//     OpenAI'ı yalnızca gerektiğinde tetikler.
//   • UI'dan doğrudan /api/ai-decision/interpret ÇAĞRILMAZ (cache bypass).
//   • Sayfa açıldığında otomatik fetch (useEffect ile) yapılır.
//   • "Analizi Yenile" butonu manuel override'dır (force=true).
//   • Sistem Sağlığı, Son AI Karar Özeti ve Güvenlik Sınırları bölümleri var.
//   • Cache durumu UI'da gösterilir (Güncel / Veri değişti / TTL doldu).
//   • Karar durumu rozeti Türkçe etikete map edilir.
//   • Boş veri fallback'i mevcut.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");
function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf-8");
}

describe("/ai-actions page — passive cache integration", () => {
  const page = read("src/app/ai-actions/page.tsx");

  it("Sistem Sağlığı bölümü eklendi", () => {
    expect(page).toMatch(/SystemHealthSection/);
    expect(page).toMatch(/Sistem Sağlığı/);
  });

  it("Son AI Karar Özeti bölümü eklendi", () => {
    expect(page).toMatch(/LatestAIDecisionSection/);
    expect(page).toMatch(/Son AI Karar Özeti/);
  });

  it("Güvenlik Sınırları kartı eklendi", () => {
    expect(page).toMatch(/SafetyBoundsCard/);
    expect(page).toMatch(/Güvenlik Sınırları/);
  });

  it("AI yorum endpoint'i /api/ai-actions/decision'dan okur (cache layer)", () => {
    expect(page).toMatch(/\/api\/ai-actions\/decision/);
    // UI doğrudan eski LLM endpoint'ini ÇAĞIRMAZ — cache bypass.
    expect(page).not.toMatch(/fetch\(["']\/api\/ai-decision\/interpret/);
  });

  it("sayfa açılışında otomatik AI yorum fetch'i tetiklenir (useEffect)", () => {
    // refreshAIDecision tanımlı ve useEffect içinden çağrılır.
    expect(page).toMatch(/refreshAIDecision/);
    expect(page).toMatch(/useEffect\([^}]*refreshAIDecision[^}]*\)/s);
  });

  it("'Analizi Yenile' butonu manuel override (force=true) gönderir", () => {
    expect(page).toMatch(/Analizi Yenile/);
    expect(page).toMatch(/force:\s*true/);
    // Force flag URL'e geçer.
    expect(page).toMatch(/force=true/);
  });

  it("UI cache durumunu gösterir (Kaynak / Durum / Son analiz)", () => {
    expect(page).toMatch(/Kaynak:/);
    expect(page).toMatch(/Durum:/);
    expect(page).toMatch(/Son analiz:/);
  });

  it("boş veri fallback mesajı var", () => {
    expect(page).toMatch(/Henüz AI karar özeti üretilmedi/);
  });

  it("karar durumu Türkçe etiketleri tanımlı", () => {
    expect(page).toMatch(/Aksiyon Gerekmiyor/);
    expect(page).toMatch(/İnceleme Devam Ediyor/);
    expect(page).toMatch(/Manuel İnceleme Gerekli/);
    expect(page).toMatch(/Veri Yetersiz/);
  });

  it("yetki seviyesi rozetleri tanımlı", () => {
    expect(page).toMatch(/observe_only/);
    expect(page).toMatch(/prompt_only/);
    expect(page).toMatch(/approval_required/);
    expect(page).toMatch(/blocked/);
  });

  it("güvenlik sınırları kartı blocked/Live trading uyarısı içerir", () => {
    expect(page).toMatch(/Live trading/);
    expect(page).toMatch(/Blocked\./);
    expect(page).toMatch(/HARD_LIVE_TRADING_ALLOWED=false/);
    expect(page).toMatch(/Risk parametreleri/);
    expect(page).toMatch(/Worker \/ trade engine/);
  });

  it("Binance private endpoint çağrısı yok", () => {
    expect(page).not.toMatch(/\/fapi\/v1\/order/);
    expect(page).not.toMatch(/\/fapi\/v1\/leverage/);
  });

  it("HARD_LIVE_TRADING_ALLOWED=true ataması yok", () => {
    expect(page).not.toMatch(/HARD_LIVE_TRADING_ALLOWED\s*=\s*true/);
    expect(page).not.toMatch(/enable_live_trading\s*=\s*true/);
  });
});

describe("/api/ai-actions/decision route — cache + safety", () => {
  const route = read("src/app/api/ai-actions/decision/route.ts");

  it("yalnızca GET handler tanımlar", () => {
    expect(route).toMatch(/export\s+async\s+function\s+GET\s*\(/);
    expect(route).not.toMatch(/export\s+async\s+function\s+POST\s*\(/);
    expect(route).not.toMatch(/export\s+async\s+function\s+PUT\s*\(/);
    expect(route).not.toMatch(/export\s+async\s+function\s+PATCH\s*\(/);
    expect(route).not.toMatch(/export\s+async\s+function\s+DELETE\s*\(/);
  });

  it("cache helper'ları kullanır (hashSnapshot + evaluateCache + setCached)", () => {
    expect(route).toMatch(/hashSnapshot/);
    expect(route).toMatch(/evaluateCache/);
    expect(route).toMatch(/setCached/);
  });

  it("force query param ile manuel override destekler", () => {
    expect(route).toMatch(/searchParams\.get\(["']force["']\)/);
  });

  it("cache hit durumunda OpenAI çağırmaz (audit event ai_decision_cache_hit)", () => {
    expect(route).toMatch(/ai_decision_cache_hit/);
  });

  it("cache miss audit event (ai_decision_cache_miss)", () => {
    expect(route).toMatch(/ai_decision_cache_miss/);
  });

  it("yeni AI yorum üretildiğinde audit event (ai_decision_refreshed)", () => {
    expect(route).toMatch(/ai_decision_refreshed/);
  });

  it("API key value loglanmaz; yalnızca hasOpenAiKey boolean", () => {
    expect(route).toMatch(/hasOpenAiKey/);
    // metadata içinde apiKey: yer almıyor
    expect(route).not.toMatch(/metadata[^}]*apiKey\s*:/);
    expect(route).not.toMatch(/process\.env\.OPENAI_API_KEY[^?]/);
  });

  it("Binance private endpoint yok", () => {
    expect(route).not.toMatch(/\/fapi\/v1\/order/);
    expect(route).not.toMatch(/\/fapi\/v1\/leverage/);
  });

  it("HARD_LIVE_TRADING_ALLOWED=true veya enable_live_trading=true ataması yok", () => {
    expect(route).not.toMatch(/HARD_LIVE_TRADING_ALLOWED\s*=\s*true/);
    expect(route).not.toMatch(/enable_live_trading\s*=\s*true/);
  });

  it("DB write (insert/update/upsert/delete) yapmaz", () => {
    expect(route).not.toMatch(/\.insert\s*\(/);
    expect(route).not.toMatch(/\.update\s*\(/);
    expect(route).not.toMatch(/\.upsert\s*\(/);
    expect(route).not.toMatch(/\.delete\s*\(/);
  });
});

describe("AIActionCenterCard panel — bağlantı invaryantları", () => {
  const card = read("src/components/dashboard/AIActionCenterCard.tsx");

  it("Merkeze Git linki /ai-actions'a yönlendirir", () => {
    expect(card).toMatch(/Merkeze Git/);
    expect(card).toMatch(/href=["']\/ai-actions["']/);
  });

  it("/api/ai-actions endpoint'ini fetch eder (deterministic, LLM yok)", () => {
    expect(card).toMatch(/\/api\/ai-actions/);
    // /api/ai-decision/interpret çağırmaz (LLM maliyetli).
    expect(card).not.toMatch(/\/api\/ai-decision\/interpret/);
  });

  it("Faz 3 başlık badge'i mevcut", () => {
    expect(card).toMatch(/Faz 3/);
  });

  it("Binance private endpoint çağrısı yok", () => {
    expect(card).not.toMatch(/\/fapi\/v1\/order/);
    expect(card).not.toMatch(/\/fapi\/v1\/leverage/);
  });
});
