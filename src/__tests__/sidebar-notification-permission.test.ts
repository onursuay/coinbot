import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf-8");

describe("sidebar notification permission control", () => {
  it("bildirim izin kontrolü sidebar içinde Loglar linkinden sonra render edilir", () => {
    const sidebar = read("src/components/Sidebar.tsx");

    expect(sidebar).toMatch(/label:\s*'Loglar'/);
    expect(sidebar).toContain("SidebarNotificationPermissionControl");
    expect(sidebar.indexOf("label: 'Loglar'")).toBeLessThan(
      sidebar.indexOf("<SidebarNotificationPermissionControl"),
    );
  });

  it("sidebar metni kompakt kalır ve izin request helper'ını kullanır", () => {
    const sidebar = read("src/components/Sidebar.tsx");

    expect(sidebar).toContain("Bildirim Kapalı");
    expect(sidebar).toContain("Bildirim Açık");
    expect(sidebar).toContain("İzin gerekli");
    expect(sidebar).toMatch(/>\s*Aç\s*</);
    expect(sidebar).toContain("requestPaperNotificationPermission");
  });

  it("eski fixed sol-alt izin kutusu kaldırıldı", () => {
    const notifier = read("src/components/GlobalTradeSoundNotifier.tsx");

    expect(notifier).not.toContain("Desktop bildirimi kapalı");
    expect(notifier).not.toContain("bottom-4 left-4");
    expect(notifier).not.toContain("Bildirimleri Aç");
  });
});
