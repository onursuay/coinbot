import { fail, ok } from "@/lib/api-helpers";
import { getAdapter } from "@/lib/exchanges/exchange-factory";
import { toCanonical } from "@/lib/exchanges/symbol-normalizer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const exchange = (url.searchParams.get("exchange") ?? "mexc").toLowerCase();
  const symbol = toCanonical(url.searchParams.get("symbol") ?? "");
  if (!symbol) return fail("symbol gerekli", 400);
  try {
    const t = await getAdapter(exchange).getTicker(symbol);
    return ok(t);
  } catch (e: any) {
    return fail(e?.message ?? "Ticker alınamadı", 502);
  }
}
