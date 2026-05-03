// Canonical PnL helper — invariant tests that lock the formula used by:
//   • /api/paper-trades/performance (Genel Bakış KPI: Toplam K/Z, Günlük K/Z, ...)
//   • /api/bot/status -> daily.realizedPnlUsd (Günlük K/Z fallback)
//   • Pozisyonlar > Kapanan İşlemler tablosu (per-row Kâr/Zarar column)
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

  it("Genel Bakış KPI invariant: row sum equals totalPnl", () => {
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

  it("Genel Bakış daily invariant: today-row sum equals dailyPnl", () => {
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

  // ── Genel Bakış ↔ Pozisyonlar parity invariants ───────────────────────
  // The Genel Bakış "TOPLAM KÂR/ZARAR" KPI tile and Pozisyonlar table rows
  // derive from the same closed paper_trade pnl values. The positions page no
  // longer renders a footer row, but this invariant still protects the KPI.

  it("Genel Bakış KPI ↔ Kapanan İşlemler rows parity: totalPnl = Σ row.pnl (closed)", () => {
    const rows = [
      { pnl: 10.87, status: "closed", closed_at: todayUtc },
      { pnl: 11.07, status: "closed", closed_at: todayUtc },
      { pnl: -5.41, status: "closed", closed_at: todayUtc },
      { pnl: -16.94, status: "closed", closed_at: todayUtc },
      { pnl: 11.06, status: "closed", closed_at: yesterdayUtc },
      { pnl: -5.23, status: "closed", closed_at: yesterdayUtc },
      // Open positions: must NEVER bleed into Genel Bakış KPI total.
      { pnl: 999, status: "open", closed_at: null },
      { pnl: -888, status: "open", closed_at: null },
    ];
    const closedRowSum = rows
      .filter((r) => r.status === "closed")
      .reduce((acc, r) => acc + Number(r.pnl ?? 0), 0);
    const stats = computeStats(rows);
    // Genel Bakış KPI tile reads stats.totalPnl from
    // /api/paper-trades/performance.
    expect(stats.totalPnl).toBeCloseTo(closedRowSum, 6);
    expect(stats.openTrades).toBe(2);
    expect(stats.totalTrades).toBe(6);
  });

  it("open position unrealized pnl never affects totalPnl or dailyPnl", () => {
    // Even if an open trade has a wildly negative or positive `pnl` field
    // populated (e.g. from an unrealized-pnl writer), the helper must skip
    // it — KPIs are realized-only.
    const stats = computeStats([
      { pnl: 50, status: "closed", closed_at: todayUtc },
      { pnl: -1000, status: "open", closed_at: null },
      { pnl: 2000, status: "open", closed_at: todayUtc },
    ]);
    expect(stats.totalPnl).toBe(50);
    expect(stats.dailyPnl).toBe(50);
    expect(stats.openTrades).toBe(2);
  });

  it("daily/total can equal each other when all closed trades are from today (not a bug)", () => {
    // Reproduces the live state at audit time: all 10 closed trades had
    // closed_at on the same UTC day, so dailyPnl == totalPnl. This is
    // expected, not a duplication.
    const rows = [
      { pnl: 10.87, status: "closed", closed_at: todayUtc },
      { pnl: 11.07, status: "closed", closed_at: todayUtc },
      { pnl: 11.11, status: "closed", closed_at: todayUtc },
      { pnl: 11.06, status: "closed", closed_at: todayUtc },
      { pnl: -5.41, status: "closed", closed_at: todayUtc },
      { pnl: -5.28, status: "closed", closed_at: todayUtc },
      { pnl: -16.94, status: "closed", closed_at: todayUtc },
      { pnl: -6.18, status: "closed", closed_at: todayUtc },
      { pnl: -6.35, status: "closed", closed_at: todayUtc },
      { pnl: -5.23, status: "closed", closed_at: todayUtc },
    ];
    const stats = computeStats(rows);
    expect(stats.dailyPnl).toBeCloseTo(stats.totalPnl, 6);
    expect(stats.totalPnl).toBeCloseTo(-1.28, 1);
  });

  it("daily/total diverge correctly when older closed trades exist", () => {
    const rows = [
      { pnl: 10, status: "closed", closed_at: todayUtc },
      { pnl: -3, status: "closed", closed_at: todayUtc },
      { pnl: 100, status: "closed", closed_at: yesterdayUtc },
      { pnl: -50, status: "closed", closed_at: yesterdayUtc },
    ];
    const stats = computeStats(rows);
    expect(stats.dailyPnl).toBeCloseTo(7, 6);
    expect(stats.totalPnl).toBeCloseTo(57, 6);
    expect(stats.dailyPnl).not.toBe(stats.totalPnl);
  });

  it("closedToday counts trades by UTC midnight, not local midnight", () => {
    // Just-before-UTC-midnight yesterday → must NOT count as today.
    // Just-after-UTC-midnight today → MUST count as today, regardless of
    // viewer's local timezone.
    const yesterdayLastSecond = (() => {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCMilliseconds(-1); // 23:59:59.999 of yesterday UTC
      return d.toISOString();
    })();
    const todayFirstMinute = (() => {
      const d = new Date();
      d.setUTCHours(0, 1, 0, 0); // 00:01:00.000 today UTC
      return d.toISOString();
    })();
    const stats = computeStats([
      { pnl: 7, status: "closed", closed_at: yesterdayLastSecond },
      { pnl: 5, status: "closed", closed_at: todayFirstMinute },
    ]);
    expect(stats.closedToday).toBe(1);
    expect(stats.dailyPnl).toBe(5);
    expect(stats.totalPnl).toBe(12);
  });
});
