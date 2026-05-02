import { describe, expect, it } from "vitest";
import {
  canShowPaperDesktopNotification,
  detectNewPaperPositionAlerts,
  formatPaperPositionNotificationBody,
  getPaperNotificationPermissionState,
  shouldPlayPaperPositionSound,
} from "@/lib/paper-position-alerts";

const trade = (id: string, score = 72) => ({
  id,
  symbol: "BTCUSDT",
  direction: "LONG",
  signal_score: score,
});

describe("paper position alerts", () => {
  it("ilk yüklemede mevcut açık pozisyonları bildirmez", () => {
    const detection = detectNewPaperPositionAlerts({
      openTrades: [trade("p1"), trade("p2")],
      notifiedIds: new Set(),
      firstSync: true,
    });

    expect(detection.newTrades).toEqual([]);
    expect(Array.from(detection.nextNotifiedIds).sort()).toEqual(["p1", "p2"]);
  });

  it("sonradan gelen yeni paper pozisyonu bir kez bildirir", () => {
    const first = detectNewPaperPositionAlerts({
      openTrades: [trade("p1")],
      notifiedIds: new Set(),
      firstSync: true,
    });
    const second = detectNewPaperPositionAlerts({
      openTrades: [trade("p1"), trade("p2", 81)],
      notifiedIds: first.nextNotifiedIds,
      firstSync: false,
    });
    const duplicate = detectNewPaperPositionAlerts({
      openTrades: [trade("p1"), trade("p2", 81)],
      notifiedIds: second.nextNotifiedIds,
      firstSync: false,
    });

    expect(second.newTrades).toHaveLength(1);
    expect(second.newTrades[0]).toMatchObject({ id: "p2", signalScore: 81 });
    expect(duplicate.newTrades).toEqual([]);
  });

  it("SES kapalıyken ses çalmaz", () => {
    expect(shouldPlayPaperPositionSound({ soundEnabled: false, newTradeCount: 1 }))
      .toBe(false);
    expect(shouldPlayPaperPositionSound({ soundEnabled: true, newTradeCount: 0 }))
      .toBe(false);
    expect(shouldPlayPaperPositionSound({ soundEnabled: true, newTradeCount: 1 }))
      .toBe(true);
  });

  it("desktop notification metnini sembol, yön ve skor ile kurar", () => {
    expect(formatPaperPositionNotificationBody({
      id: "p1",
      symbol: "ETHUSDT",
      direction: "SHORT",
      signalScore: 69.8,
    })).toBe("ETHUSDT - SHORT - Skor: 70");
  });

  it("notification permission default/denied/granted durumlarını ayırır", () => {
    expect(getPaperNotificationPermissionState("default", true)).toBe("default");
    expect(getPaperNotificationPermissionState("denied", true)).toBe("denied");
    expect(getPaperNotificationPermissionState("granted", true)).toBe("granted");
    expect(getPaperNotificationPermissionState(undefined, false)).toBe("unsupported");
  });

  it("desktop notification sadece granted izinde gösterilebilir", () => {
    expect(canShowPaperDesktopNotification("granted")).toBe(true);
    expect(canShowPaperDesktopNotification("default")).toBe(false);
    expect(canShowPaperDesktopNotification("denied")).toBe(false);
    expect(canShowPaperDesktopNotification("unsupported")).toBe(false);
  });
});
