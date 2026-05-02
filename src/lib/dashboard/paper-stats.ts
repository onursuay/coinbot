// Canonical paper-trade aggregation helper.
//
// Both /api/paper-trades/performance (Toplam K/Z, Win Rate, ...) and
// /api/bot/status (Günlük K/Z) MUST use this helper so that Panel KPI tiles
// stay numerically consistent with the "Sanal İşlemler > Kapanan İşlemler"
// table — which simply renders the per-row `pnl` column from the same
// `paper_trades` rows.
//
// Net PnL is whatever is stored on `paper_trades.pnl`. closePaperTrade()
// already subtracts fees + slippage + funding before persisting, so the
// stored value IS the net PnL — do NOT subtract them again here.

import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";

const PAPER_BALANCE = 1000;

export interface PaperTradeStats {
  totalTrades: number;       // closed trades only
  openTrades: number;
  winningTrades: number;     // pnl > 0
  losingTrades: number;      // pnl < 0  (break-even excluded)
  breakEvenTrades: number;   // pnl == 0
  winRate: number;           // wins / closed * 100
  totalPnl: number;          // sum of net pnl on all closed trades
  dailyPnl: number;          // sum of net pnl on trades closed since UTC midnight today
  closedToday: number;       // count of trades closed today (UTC)
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
}

interface TradeRow {
  pnl: number | string | null;
  status: string;
  closed_at: string | null;
}

export function emptyStats(): PaperTradeStats {
  return {
    totalTrades: 0,
    openTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    breakEvenTrades: 0,
    winRate: 0,
    totalPnl: 0,
    dailyPnl: 0,
    closedToday: 0,
    profitFactor: 0,
    maxDrawdown: 0,
    maxDrawdownPercent: 0,
  };
}

export function computeStats(rows: TradeRow[]): PaperTradeStats {
  const closed = rows.filter((t) => t.status === "closed");
  const open = rows.filter((t) => t.status === "open");

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  let totalPnl = 0;
  let dailyPnl = 0;
  let closedToday = 0;
  let wins = 0;
  let losses = 0;
  let breakEvens = 0;
  let grossWin = 0;
  let grossLoss = 0;

  for (const t of closed) {
    const pnl = Number(t.pnl ?? 0) || 0;
    totalPnl += pnl;
    if (pnl > 0) { wins++; grossWin += pnl; }
    else if (pnl < 0) { losses++; grossLoss += -pnl; }
    else { breakEvens++; }

    if (t.closed_at) {
      const closedMs = new Date(t.closed_at).getTime();
      if (Number.isFinite(closedMs) && closedMs >= todayMs) {
        dailyPnl += pnl;
        closedToday++;
      }
    }
  }

  const totalTrades = closed.length;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const profitFactor = grossLoss > 0
    ? grossWin / grossLoss
    : grossWin > 0 ? 9999 : 0;

  // Equity curve drawdown (chronological, by closed_at).
  const sorted = [...closed]
    .filter((t) => t.closed_at)
    .sort((a, b) => new Date(a.closed_at!).getTime() - new Date(b.closed_at!).getTime());
  let peak = 0, equity = 0, maxDd = 0;
  for (const t of sorted) {
    equity += Number(t.pnl ?? 0) || 0;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) maxDd = dd;
  }

  return {
    totalTrades,
    openTrades: open.length,
    winningTrades: wins,
    losingTrades: losses,
    breakEvenTrades: breakEvens,
    winRate,
    totalPnl,
    dailyPnl,
    closedToday,
    profitFactor: Number.isFinite(profitFactor) ? profitFactor : 9999,
    maxDrawdown: maxDd,
    maxDrawdownPercent: PAPER_BALANCE > 0 ? (maxDd / PAPER_BALANCE) * 100 : 0,
  };
}

export async function getPaperTradeStats(userId: string): Promise<PaperTradeStats> {
  if (!supabaseConfigured()) return emptyStats();
  const { data } = await supabaseAdmin()
    .from("paper_trades")
    .select("pnl, status, closed_at")
    .eq("user_id", userId);
  return computeStats((data ?? []) as TradeRow[]);
}
