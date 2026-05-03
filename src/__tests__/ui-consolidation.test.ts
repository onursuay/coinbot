// UI Consolidation — test paketi
//
// Doğrulanacak invariantlar:
//   • Sidebar menü sıralaması doğru
//   • Tarama Modları / Strateji / Performans ayrı menü olarak yok
//   • Strateji Merkezi sidebar'da var
//   • Sidebar footer teknik alanı kaldırıldı
//   • API Key label var
//   • /strategy-center sayfası render oluyor
//   • 3 sekme ve tab parametresi var
//   • Eski route'lar redirect içeriyor
//   • Kapanış sebebi label mapping
//   • Paper-trades sayfasında canonical footer yok

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  mapExitReasonLabel,
  mapExitReasonTone,
} from "@/lib/dashboard/exit-reasons";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf-8");

// ── Sidebar ────────────────────────────────────────────────────────────────────
describe("Sidebar — konsolidasyon", () => {
  it("sidebar menü sıralaması doğru (Genel Bakış → Piyasa Tarayıcı → Pozisyonlar → AI Aksiyon Merkezi → Strateji Merkezi → Risk Yönetimi → API Key → Loglar)", () => {
    const sidebar = read("src/components/Sidebar.tsx");
    const positions = [
      sidebar.indexOf("Genel Bakış"),
      sidebar.indexOf("Piyasa Tarayıcı"),
      sidebar.indexOf("Pozisyonlar"),
      sidebar.indexOf("AI Aksiyon Merkezi"),
      sidebar.indexOf("Strateji Merkezi"),
      sidebar.indexOf("Risk Yönetimi"),
      sidebar.indexOf("API Key"),
      sidebar.indexOf("Loglar"),
    ];
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it("Tarama Modları, Strateji, Performans ayrı sidebar menüsü olarak yok", () => {
    const sidebar = read("src/components/Sidebar.tsx");
    expect(sidebar).not.toMatch(/label:\s*['"]Tarama Modları['"]/);
    expect(sidebar).not.toMatch(/label:\s*['"]Strateji['"]/);
    expect(sidebar).not.toMatch(/label:\s*['"]Performans['"]/);
  });

  it("Strateji Merkezi sidebar'da mevcut ve /strategy-center href'ini kullanıyor", () => {
    const sidebar = read("src/components/Sidebar.tsx");
    expect(sidebar).toContain("Strateji Merkezi");
    expect(sidebar).toContain("/strategy-center");
  });

  it("sidebar footer teknik alanı kaldırıldı", () => {
    const sidebar = read("src/components/Sidebar.tsx");
    expect(sidebar).not.toContain("Maks. kaldıraç");
    expect(sidebar).not.toContain("Canlı: env ile kilitli");
    expect(sidebar).not.toContain("Mod: <span");
  });

  it("API Key label var, API Ayarları label yok", () => {
    const sidebar = read("src/components/Sidebar.tsx");
    expect(sidebar).toContain("API Key");
    expect(sidebar).not.toMatch(/label:\s*['"]API Ayarları['"]/);
  });

  it("Panel değil Genel Bakış label var", () => {
    const sidebar = read("src/components/Sidebar.tsx");
    expect(sidebar).toContain("Genel Bakış");
    expect(sidebar).not.toMatch(/label:\s*['"]Panel['"]/);
  });
});

// ── Strateji Merkezi sayfası ───────────────────────────────────────────────────
describe("Strateji Merkezi sayfası", () => {
  it("/strategy-center sayfası mevcut", () => {
    expect(() => read("src/app/strategy-center/page.tsx")).not.toThrow();
  });

  it("3 sekme etiket metni mevcut: Strateji Ayarları, Tarama Modları, Performans", () => {
    const page = read("src/app/strategy-center/page.tsx");
    expect(page).toContain("Strateji Ayarları");
    expect(page).toContain("Tarama Modları");
    expect(page).toContain("Performans");
  });

  it("tab URL parametresi ile useSearchParams kullanılıyor", () => {
    const page = read("src/app/strategy-center/page.tsx");
    expect(page).toContain("useSearchParams");
    expect(page).toContain("tab");
  });

  it("Suspense boundary mevcut", () => {
    const page = read("src/app/strategy-center/page.tsx");
    expect(page).toContain("Suspense");
  });

  it("Strateji Ayarları sekmesi watchlist içeriğini içeriyor", () => {
    const page = read("src/app/strategy-center/page.tsx");
    expect(page).toContain("watched-symbols");
    expect(page).toContain("Watchlist");
  });

  it("Tarama Modları sekmesi 3 mod kartını içeriyor", () => {
    const page = read("src/app/strategy-center/page.tsx");
    expect(page).toContain("GENİŞ MARKET TARAMASI");
    expect(page).toContain("MOMENTUM TARAMASI");
    expect(page).toContain("MANUEL İZLEME LİSTESİ");
  });

  it("Performans sekmesi Türkçe KPI ve grafik başlıklarını içeriyor", () => {
    const page = read("src/app/strategy-center/page.tsx");
    expect(page).toContain("Toplam Kâr/Zarar");
    expect(page).toContain("Kazanma Oranı");
    expect(page).toContain("Kâr Faktörü");
    expect(page).toContain("Maksimum Düşüş");
    expect(page).toContain("Sermaye Eğrisi (paper, kronolojik)");
  });
});

// ── Eski route redirect davranışı ─────────────────────────────────────────────
describe("Eski route'lar redirect ediyor", () => {
  it("/strategy sayfası /strategy-center'a redirect içeriyor", () => {
    const page = read("src/app/strategy/page.tsx");
    expect(page).toContain("redirect");
    expect(page).toContain("strategy-center");
    expect(page).toContain("tab=strategy");
  });

  it("/performance sayfası /strategy-center'a redirect içeriyor", () => {
    const page = read("src/app/performance/page.tsx");
    expect(page).toContain("redirect");
    expect(page).toContain("strategy-center");
    expect(page).toContain("tab=performance");
  });

  it("/scan-modes sayfası /strategy-center'a redirect içeriyor", () => {
    const page = read("src/app/scan-modes/page.tsx");
    expect(page).toContain("redirect");
    expect(page).toContain("strategy-center");
    expect(page).toContain("tab=scan-modes");
  });
});

// ── Kapanış sebebi label mapping ──────────────────────────────────────────────
describe("Kapanış sebebi label mapping", () => {
  it("tüm mapping değerleri doğru Türkçe karşılıklar", () => {
    expect(mapExitReasonLabel("take_profit")).toBe("KÂR AL");
    expect(mapExitReasonLabel("stop_loss")).toBe("ZARAR DURDUR");
    expect(mapExitReasonLabel("manual")).toBe("MANUEL KAPATMA");
    expect(mapExitReasonLabel("manual_profit_close")).toBe("KÂRDA KAPATILDI");
    expect(mapExitReasonLabel("manual_loss_close")).toBe("ZARARDA KAPATILDI");
    expect(mapExitReasonLabel("manual_break_even_close")).toBe("BAŞABAŞ KAPATILDI");
    expect(mapExitReasonLabel("manual_stale_profit_close")).toBe("SÜRE AŞIMI · KÂRDA KAPATILDI");
    expect(mapExitReasonLabel("manual_stale_loss_close")).toBe("SÜRE AŞIMI · ZARARDA KAPATILDI");
    expect(mapExitReasonLabel("manual_stale_break_even_close")).toBe("SÜRE AŞIMI · BAŞABAŞ KAPATILDI");
  });

  it("bilinmeyen değer BİLİNMİYOR döndürür", () => {
    expect(mapExitReasonLabel("unknown_xyz")).toBe("BİLİNMİYOR");
    expect(mapExitReasonLabel(null)).toBe("BİLİNMİYOR");
    expect(mapExitReasonLabel(undefined)).toBe("BİLİNMİYOR");
    expect(mapExitReasonLabel("")).toBe("BİLİNMİYOR");
  });

  it("tone mapping doğru", () => {
    expect(mapExitReasonTone("take_profit")).toBe("success");
    expect(mapExitReasonTone("manual_profit_close")).toBe("success");
    expect(mapExitReasonTone("manual_stale_profit_close")).toBe("success");
    expect(mapExitReasonTone("stop_loss")).toBe("danger");
    expect(mapExitReasonTone("manual_loss_close")).toBe("danger");
    expect(mapExitReasonTone("manual")).toBe("neutral");
    expect(mapExitReasonTone("manual_break_even_close")).toBe("neutral");
  });
});

// ── Pozisyonlar — footer/toplam yok ──────────────────────────────────────────
describe("Pozisyonlar sayfası — canonical footer yok", () => {
  it("paper-trades sayfasında canonical paper-stats açıklama metni yok", () => {
    const page = read("src/app/paper-trades/page.tsx");
    expect(page).not.toContain("Panel KPI ile birebir aynıdır");
    expect(page).not.toContain("canonical paper-stats helper");
    expect(page).not.toContain("Toplam (");
  });
});

// ── Dashboard — FIRSAT RADARI başlık güncellendi ──────────────────────────────
describe("Dashboard — FIRSAT RADARI başlık", () => {
  it("FIRSAT RADARI DashboardSectionTitle ile render ediliyor", () => {
    const cards = read("src/components/dashboard/Cards.tsx");
    expect(cards).toContain("DashboardSectionTitle");
    // h2 ile plain metin olarak render edilmiyor
    const radarSection = cards.slice(
      cards.indexOf("OpportunityRadarCard"),
      cards.indexOf("OpportunityRadarCard") + 800,
    );
    expect(radarSection).not.toContain('<h2 className="font-semibold tracking-wide">FIRSAT RADARI</h2>');
  });
});
