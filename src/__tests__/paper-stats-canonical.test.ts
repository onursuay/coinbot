// Canonical PnL helper — invariant tests that lock the formula used by:
//   • /api/paper-trades/performance (Panel KPI: Toplam K/Z, Günlük K/Z, ...)
//   • /api/bot/status -> daily.realizedPnlUsd (Günlük K/Z fallback)
//   • Sanal İşlemler > Kapanan İşlemler tablosu (per-row Kâr/Zarar column)
//
// Stored `paper_trades.pnl` IS the net pnl (closePaperTrade subtracts fees +
// slippage + funding before persisting). The helper sums the stored value as-is
// and must NOT re-subtract fees here — that would double-count costs.

import { describe, it, expect } from "vitest";
import { computeStats, emptyStats } from "@/lib/dashboard/paper-stats";

const todayUtc = (() => {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0); // safely inside today UTC
  return d.toISOString();
})();
const yesterdayUtc = (() => {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString();
})();

describe("paper-stats canonical helper", () => {
  it("emptyStats has all numeric defaults at 0", () => {
    const s = emptyStats();
    expect(s.totalTrades).toBe(0);
    expect(s.totalPnl).toBe(0);
    expect(s.dailyPnl).toBe(0);
    expect(s.winRate).toBe(0);
    expect(s.profitFactor).toBe(0);
  });

  it("totalPnl is the SUM of pnl on closed trades only", () => {
    const s = computeStats([
      { pnl: 10, status: "closed", closed_at: todayUtc },
      { pnl: -3, status: "closed", closed_at: todayUtc },
      { pnl: 999, status: "open", closed_at: null },     // open — excluded
    ]);
    expect(s.totalPnl).toBeCloseTo(7, 6);
    expect(s.totalTrades).toBe(2);
    expect(s.openTrades).toBe(1);
  });

  it("dailyPnl includes only trades closed since UTC midnight today", () => {
    const s = computeStats([
      { pnl: 5, status: "closed", closed_at: todayUtc },
      { pnl: -2, status: "closed", closed_at: todayUtc },
      { pnl: 100, status: "closed", closed_at: yesterdayUtc }, // not today
    ]);
    expect(s.dailyPnl).toBeCloseTo(3, 6);
    expect(s.totalPnl).toBeCloseTo(103, 6);
    expect(s.closedToday).toBe(2);
  });

  it("winRate = wins / closed * 100; break-even (pnl=0) excluded from wins/losses", () => {
    const s = computeStats([
      { pnl: 5, status: "closed", closed_at: todayUtc },
      { pnl: 5, status: "closed", closed_at: todayUtc },
      { pnl: -5, status: "closed", closed_at: todayUtc },
      { pnl: 0, status: "closed", closed_at: todayUtc },
    ]);
    expect(s.winningTrades).toBe(2);
    expect(s.losingTrades).toBe(1);
    expect(s.breakEvenTrades).toBe(1);
    expect(s.totalTrades).toBe(4);
    expect(s.winRate).toBeCloseTo(50, 6);
  });

  it("profitFactor = grossWin / grossLoss; capped semantics for no losses", () => {
    const s1 = computeStats([
      { pnl: 10, status: "closed", closed_at: todayUtc },
      { pnl: -5, status: "closed", closed_at: todayUtc },
    ]);
    expect(s1.profitFactor).toBeCloseTo(2, 6);

    const s2 = computeStats([
      { pnl: 10, status: "closed", closed_at: todayUtc },
      { pnl: 5, status: "closed", closed_at: todayUtc },
    ]);
    expect(s2.profitFactor).toBe(9999); // sentinel for "no losses"

    const s3 = computeStats([
      { pnl: -5, status: "closed", closed_at: todayUtc },
    ]);
    expect(s3.profitFactor).toBe(0);
  });

  it("net pnl is NEVER recomputed — fees/slippage/funding are already in stored pnl", () => {
    // Simulates a trade where gross was +100 and stored pnl is the net (e.g. 92)
    // after fees/slippage/funding. The helper must surface 92 — not subtract again.
    const s = computeStats([{ pnl: 92, status: "closed", closed_at: todayUtc }]);
    expect(s.totalPnl).toBe(92);
    expect(s.dailyPnl).toBe(92);
  });

  it("LONG profit: pnl positive → counted as win", () => {
    const s = computeStats([{ pnl: 7.5, status: "closed", closed_at: todayUtc }]);
    expect(s.winningTrades).toBe(1);
    expect(s.totalPnl).toBeCloseTo(7.5, 6);
  });

  it("LONG loss: pnl negative → counted as loss", () => {
    const s = computeStats([{ pnl: -4.2, status: "closed", closed_at: todayUtc }]);
    expect(s.losingTrades).toBe(1);
    expect(s.totalPnl).toBeCloseTo(-4.2, 6);
  });

  it("SHORT profit: same canonical aggregation regardless of direction", () => {
    // Stored pnl is the net signed value; direction does not appear in the
    // helper because closePaperTrade already encoded the sign.
    const s = computeStats([{ pnl: 3.3, status: "closed", closed_at: todayUtc }]);
    expect(s.winningTrades).toBe(1);
  });

  it("SHORT loss: negative pnl aggregates same way", () => {
    const s = computeStats([{ pnl: -2.8, status: "closed", closed_at: todayUtc }]);
    expect(s.losingTrades).toBe(1);
  });

  it("Panel KPI invariant: row sum equals totalPnl", () => {
    const rows = [
      { pnl: 1.1, status: "closed", closed_at: todayUtc },
      { pnl: -2.2, status: "closed", closed_at: todayUtc },
      { pnl: 3.3, status: "closed", closed_at: yesterdayUtc },
      { pnl: -4.4, status: "closed", closed_at: yesterdayUtc },
      { pnl: 99, status: "open", closed_at: null }, // ignored
    ];
    const rowSum = rows
      .filter((r) => r.status === "closed")
      .reduce((acc, r) => acc + Number(r.pnl ?? 0), 0);
    const s = computeStats(rows);
    expect(s.totalPnl).toBeCloseTo(rowSum, 6);
  });

  it("Panel daily invariant: today-row sum equals dailyPnl", () => {
    const rows = [
      { pnl: 1.5, status: "closed", closed_at: todayUtc },
      { pnl: -0.5, status: "closed", closed_at: todayUtc },
      { pnl: 100, status: "closed", closed_at: yesterdayUtc },
    ];
    const todayRowSum = rows
      .filter((r) => r.status === "closed" && r.closed_at?.startsWith(new Date().toISOString().slice(0, 10)))
      .reduce((acc, r) => acc + Number(r.pnl ?? 0), 0);
    const s = computeStats(rows);
    expect(s.dailyPnl).toBeCloseTo(todayRowSum, 6);
  });

  it("string pnl values are coerced to number (defensive against Supabase numeric)", () => {
    const s = computeStats([
      { pnl: "5.5" as any, status: "closed", closed_at: todayUtc },
      { pnl: "-2.5" as any, status: "closed", closed_at: todayUtc },
    ]);
    expect(s.totalPnl).toBeCloseTo(3, 6);
  });

  it("null pnl is treated as 0 (counted in totalTrades and breakEven)", () => {
    const s = computeStats([
      { pnl: null, status: "closed", closed_at: todayUtc },
    ]);
    expect(s.totalTrades).toBe(1);
    expect(s.breakEvenTrades).toBe(1);
    expect(s.totalPnl).toBe(0);
  });
});
