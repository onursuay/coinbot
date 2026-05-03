import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf-8");

describe("notification permission toast and localized performance UI", () => {
  it("sidebar bildirim kartı kaldırıldı, Loglar menüsü korunur, footer teknik alanı kaldırıldı", () => {
    const sidebar = read("src/components/Sidebar.tsx");

    expect(sidebar).toMatch(/label:\s*'Loglar'/);
    expect(sidebar).not.toContain("SidebarNotificationPermissionControl");
    expect(sidebar).not.toContain("Bildirim Açık");
    expect(sidebar).not.toContain("Bildirim Kapalı");
    expect(sidebar).not.toContain("requestPaperNotificationPermission");
    // Footer teknik alanı kaldırıldı (Strateji Merkezi konsolidasyonu)
    expect(sidebar).not.toContain("Maks. kaldıraç");
    expect(sidebar).not.toContain("Canlı: env ile kilitli");
  });

  it("bildirim izni üst orta toast component'i üzerinden yönetilir", () => {
    const toast = read("src/components/NotificationPermissionToast.tsx");
    const layout = read("src/app/layout.tsx");

    expect(layout).toContain("<NotificationPermissionToast />");
    expect(toast).toContain("requestPaperNotificationPermission");
    expect(toast).toContain("readPaperNotificationPermission");
    expect(toast).toContain("fixed top-[68px]");
    expect(toast).toContain("Bildirim izni gerekli.");
    expect(toast).toContain("Bildirimler açık.");
    expect(toast).toContain("Bildirimler engellendi. Tarayıcı ayarlarından izin verin.");
    expect(toast).toContain("Bildirim durumu güncellendi.");
    expect(toast).toContain("AUTO_HIDE_MS");
  });

  it("eski fixed sol-alt izin kutusu kaldırıldı", () => {
    const notifier = read("src/components/GlobalTradeSoundNotifier.tsx");

    expect(notifier).not.toContain("Desktop bildirimi kapalı");
    expect(notifier).not.toContain("bottom-4 left-4");
    expect(notifier).not.toContain("Bildirimleri Aç");
  });

  it("strateji merkezi performans sekmesi KPI ve grafik başlıklarını Türkçe gösterir", () => {
    // Performans içeriği /strategy-center?tab=performance'a taşındı
    const page = read("src/app/strategy-center/page.tsx");

    expect(page).toContain("Toplam Kâr/Zarar");
    expect(page).toContain("Kazanma Oranı");
    expect(page).toContain("Kâr Faktörü");
    expect(page).toContain("Maksimum Düşüş");
    expect(page).toContain("Sermaye Eğrisi (paper, kronolojik)");
    expect(page).not.toContain("Total PnL");
    expect(page).not.toContain("Win Rate");
    expect(page).not.toContain("Profit Factor");
    expect(page).not.toContain("Max Drawdown");
    expect(page).not.toContain("Equity (paper, kronolojik)");
  });
});
