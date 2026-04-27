import { ok } from "@/lib/api-helpers";
import { getCurrentUserId } from "@/lib/auth";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!supabaseConfigured()) return ok({ totalPnl: 0, winRate: 0, profitFactor: 0, totalTrades: 0, maxDrawdown: 0, maxDrawdownPercent: 0, openTrades: 0 });
  const userId = getCurrentUserId();
  const sb = supabaseAdmin();
  const { data } = await sb.from("paper_trades")
    .select("pnl, status, opened_at, closed_at, direction, symbol")
    .eq("user_id", userId);

  const all = data ?? [];
  const trades = all.filter((t) => t.status === "closed");
  const openTrades = all.filter((t) => t.status === "open").length;

  const totalPnl = trades.reduce((s, t) => s + Number(t.pnl ?? 0), 0);
  const wins = trades.filter((t) => Number(t.pnl) > 0);
  const losses = trades.filter((t) => Number(t.pnl) <= 0);
  const winRate = trades.length ? (wins.length / trades.length) * 100 : 0;
  const grossWin = wins.reduce((s, t) => s + Number(t.pnl), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + Number(t.pnl), 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 9999 : 0;

  const PAPER_BALANCE = 1000;
  let peak = 0, equity = 0, maxDd = 0;
  const sorted = [...trades].sort((a, b) => new Date(a.closed_at!).getTime() - new Date(b.closed_at!).getTime());
  for (const t of sorted) {
    equity += Number(t.pnl);
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) maxDd = dd;
  }

  return ok({
    totalTrades: trades.length,
    openTrades,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate,
    totalPnl,
    profitFactor: Number.isFinite(profitFactor) ? profitFactor : 9999,
    maxDrawdown: maxDd,
    maxDrawdownPercent: PAPER_BALANCE > 0 ? (maxDd / PAPER_BALANCE) * 100 : 0,
  });
}
