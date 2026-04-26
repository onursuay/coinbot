import { z } from "zod";
import { fail, ok, parseBody, isResponse } from "@/lib/api-helpers";
import { evaluateRisk } from "@/lib/engines/risk-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  accountBalanceUsd: z.number().positive(),
  symbol: z.string(),
  direction: z.enum(["LONG", "SHORT"]),
  entryPrice: z.number().positive(),
  stopLoss: z.number().positive(),
  takeProfit: z.number().positive(),
  signalScore: z.number().min(0).max(100).default(80),
  marketSpread: z.number().min(0).default(0),
  recentLossStreak: z.number().int().min(0).default(0),
  openPositionCount: z.number().int().min(0).default(0),
  dailyRealizedPnlUsd: z.number().default(0),
  weeklyRealizedPnlUsd: z.number().default(0),
  dailyTargetHit: z.boolean().default(false),
  killSwitchActive: z.boolean().default(false),
  fundingRate: z.number().optional(),
  estimatedLiquidationPrice: z.number().optional(),
  exchangeMaxLeverage: z.number().optional(),
  exchangeMinOrderSize: z.number().optional(),
  exchangeStepSize: z.number().optional(),
});

export async function POST(req: Request) {
  const parsed = await parseBody(req, Body);
  if (isResponse(parsed)) return parsed;
  try {
    const result = evaluateRisk({
      ...parsed,
      conservativeMode: false,
      webSocketHealthy: true,
      apiHealthy: true,
      dataFresh: true,
      marginMode: "isolated",
    });
    return ok(result);
  } catch (e: any) {
    return fail(e?.message ?? "risk check failed", 500);
  }
}
