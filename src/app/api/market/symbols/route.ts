import { fail, ok } from "@/lib/api-helpers";
import { getAdapter } from "@/lib/exchanges/exchange-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const exchange = (url.searchParams.get("exchange") ?? "mexc").toLowerCase();
  try {
    const adapter = getAdapter(exchange);
    const list = await adapter.getFuturesSymbols();
    return ok(list);
  } catch (e: any) {
    return fail(e?.message ?? "Sembol listesi alınamadı", 502);
  }
}
