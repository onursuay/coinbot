import { fail, ok } from "@/lib/api-helpers";
import { getAdapter } from "@/lib/exchanges/exchange-factory";
import { toCanonical } from "@/lib/exchanges/symbol-normalizer";
import type { Timeframe } from "@/lib/exchanges/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED: Timeframe[] = ["1m", "5m", "15m", "1h", "4h"];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const exchange = (url.searchParams.get("exchange") ?? "mexc").toLowerCase();
  const symbol = toCanonical(url.searchParams.get("symbol") ?? "");
  const tf = (url.searchParams.get("timeframe") ?? "15m") as Timeframe;
  const limit = Math.min(500, Number(url.searchParams.get("limit") ?? 250) || 250);
  if (!symbol) return fail("symbol gerekli", 400);
  if (!ALLOWED.includes(tf)) return fail("Geçersiz timeframe", 400);
  try {
    const data = await getAdapter(exchange).getKlines(symbol, tf, limit);
    return ok(data);
  } catch (e: any) {
    return fail(e?.message ?? "Kline alınamadı", 502);
  }
}
