import { describe, it, expect } from "vitest";
import { getTopOpportunities } from "@/lib/top-opportunities";

describe("getTopOpportunities", () => {
  it("returns at most 5 items even when more candidates exist", () => {
    const details = Array.from({ length: 10 }, (_, i) => ({
      symbol: `COIN${i}/USDT`,
      signalType: "LONG",
      signalScore: 50 + i,
    }));
    const { items } = getTopOpportunities(details);
    expect(items.length).toBeLessThanOrEqual(5);
    expect(items.length).toBe(5);
  });

  it("sorts by score descending", () => {
    const details = [
      { symbol: "A/USDT", signalType: "LONG", signalScore: 55 },
      { symbol: "B/USDT", signalType: "LONG", signalScore: 68 },
      { symbol: "C/USDT", signalType: "SHORT", signalScore: 45 },
    ];
    const { items } = getTopOpportunities(details);
    expect(items[0].score).toBe(68);
    expect(items[1].score).toBe(55);
    expect(items[2].score).toBe(45);
  });

  it("excludes items with score = 0", () => {
    const details = [
      { symbol: "ZERO/USDT", signalType: "NO_TRADE", signalScore: 0 },
      { symbol: "B/USDT", signalType: "LONG", signalScore: 65 },
    ];
    const { items } = getTopOpportunities(details);
    expect(items.every((i) => i.score > 0)).toBe(true);
    expect(items.some((i) => i.symbol === "ZERO/USDT")).toBe(false);
  });

  it("computes missingPoints as threshold minus score (min 0)", () => {
    const details = [
      { symbol: "X/USDT", signalType: "LONG", signalScore: 63 },
      { symbol: "Y/USDT", signalType: "LONG", signalScore: 72 },
    ];
    const { items } = getTopOpportunities(details);
    const x = items.find((i) => i.symbol === "X/USDT")!;
    const y = items.find((i) => i.symbol === "Y/USDT")!;
    expect(x.missingPoints).toBe(7);
    expect(y.missingPoints).toBe(0);
  });

  it("reports insufficientData when fewer than 5 items have score > 0", () => {
    const details = [
      { symbol: "A/USDT", signalType: "LONG", signalScore: 55 },
      { symbol: "B/USDT", signalType: "LONG", signalScore: 45 },
    ];
    const { insufficientData } = getTopOpportunities(details);
    expect(insufficientData).toBe(true);
  });

  it("marks aboveThreshold for items with score >= 70", () => {
    const details = [
      { symbol: "A/USDT", signalType: "LONG", signalScore: 72 },
      { symbol: "B/USDT", signalType: "LONG", signalScore: 65 },
    ];
    const { items } = getTopOpportunities(details);
    expect(items.find((i) => i.symbol === "A/USDT")!.aboveThreshold).toBe(true);
    expect(items.find((i) => i.symbol === "B/USDT")!.aboveThreshold).toBe(false);
  });

  it("sets decision correctly for opened, above-threshold, and below-threshold items", () => {
    const details = [
      { symbol: "OPEN/USDT", signalType: "LONG", signalScore: 75, opened: true },
      { symbol: "PASS/USDT", signalType: "LONG", signalScore: 73, opened: false },
      { symbol: "WAIT/USDT", signalType: "LONG", signalScore: 60, opened: false },
    ];
    const { items } = getTopOpportunities(details);
    expect(items.find((i) => i.symbol === "OPEN/USDT")!.decision).toBe("Sanal işlem açıldı");
    expect(items.find((i) => i.symbol === "PASS/USDT")!.decision).toBe("Eşik geçildi — sanal işlem bekleniyor");
    expect(items.find((i) => i.symbol === "WAIT/USDT")!.decision).toBe("Beklemede");
  });
});
