import { ok } from "@/lib/api-helpers";
import { getCurrentUserId } from "@/lib/auth";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!supabaseConfigured()) return ok({ totalPnl: 0, winRate: 0, profitFactor: 0, totalTrades: 0, maxDrawdown: 0 });
  const userId = getCurrentUserId();
  const { data } = await supabaseAdmin().from("paper_trades")
    .select("pnl, status, opened_at, closed_at")
    .eq("user_id", userId).eq("status", "closed");
  const trades = data ?? [];
  const totalPnl = trades.reduce((s, t) => s + Number(t.pnl ?? 0), 0);
  const wins = trades.filter((t) => Number(t.pnl) > 0);
  const losses = trades.filter((t) => Number(t.pnl) <= 0);
  const winRate = trades.length ? (wins.length / trades.length) * 100 : 0;
  const grossWin = wins.reduce((s, t) => s + Number(t.pnl), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + Number(t.pnl), 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
  // Max drawdown via running equity
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
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate,
    totalPnl,
    profitFactor: Number.isFinite(profitFactor) ? profitFactor : 9999,
    maxDrawdown: maxDd,
  });
}
