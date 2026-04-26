import { z } from "zod";
import { fail, ok, parseBody, isResponse } from "@/lib/api-helpers";
import { getAdapter } from "@/lib/exchanges/exchange-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  exchange: z.enum(["mexc", "binance", "okx", "bybit"]),
  symbol: z.string(),
  direction: z.enum(["LONG", "SHORT"]),
  entryPrice: z.number().positive(),
  leverage: z.number().min(1).max(5),
  stopLoss: z.number().positive(),
});

export async function POST(req: Request) {
  const parsed = await parseBody(req, Body);
  if (isResponse(parsed)) return parsed;
  try {
    const liq = await getAdapter(parsed.exchange).getEstimatedLiquidationPrice({
      symbol: parsed.symbol, direction: parsed.direction, entryPrice: parsed.entryPrice,
      leverage: parsed.leverage, marginMode: "isolated",
    });
    const safe = parsed.direction === "LONG" ? liq < parsed.stopLoss : liq > parsed.stopLoss;
    return ok({ estimatedLiquidationPrice: liq, stopLoss: parsed.stopLoss, safe });
  } catch (e: any) {
    return fail(e?.message ?? "Likidasyon hesabı başarısız", 500);
  }
}
