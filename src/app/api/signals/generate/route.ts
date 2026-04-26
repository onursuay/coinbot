import { z } from "zod";
import { fail, ok, parseBody, isResponse } from "@/lib/api-helpers";
import { getAdapter } from "@/lib/exchanges/exchange-factory";
import { generateSignal } from "@/lib/engines/signal-engine";
import type { Timeframe } from "@/lib/exchanges/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  exchange: z.enum(["mexc", "binance", "okx", "bybit"]).default("mexc"),
  symbol: z.string().min(2),
  timeframe: z.enum(["1m", "5m", "15m", "1h", "4h"]).default("15m") as z.ZodType<Timeframe>,
});

export async function POST(req: Request) {
  const parsed = await parseBody(req, Body);
  if (isResponse(parsed)) return parsed;
  try {
    const adapter = getAdapter(parsed.exchange);
    const [klines, ticker, funding, btc] = await Promise.all([
      adapter.getKlines(parsed.symbol, parsed.timeframe, 250),
      adapter.getTicker(parsed.symbol),
      adapter.getFundingRate(parsed.symbol),
      adapter.getKlines("BTC/USDT", parsed.timeframe, 250).catch(() => []),
    ]);
    const sig = generateSignal({
      symbol: parsed.symbol, timeframe: parsed.timeframe,
      klines, ticker, funding, btcKlines: btc,
    });
    return ok(sig);
  } catch (e: any) {
    return fail(e?.message ?? "Sinyal üretilemedi", 502);
  }
}
