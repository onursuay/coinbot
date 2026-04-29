import { z } from "zod";
import { ok, parseBody, isResponse } from "@/lib/api-helpers";
import {
  getScanModesConfig,
  updateScanModesConfig,
} from "@/lib/scan-modes";

// Phase 1 — scan modes config endpoint.
// Returns and updates the in-memory ScanModesConfig (skeleton). No Binance
// API calls are issued from this route. Trading logic and live trading
// gates are not affected.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return ok(getScanModesConfig());
}

const Body = z.object({
  wideMarket: z.object({ active: z.boolean() }).partial().optional(),
  momentum: z.object({ active: z.boolean() }).partial().optional(),
  manualList: z.object({ active: z.boolean() }).partial().optional(),
});

export async function PUT(req: Request) {
  const parsed = await parseBody(req, Body);
  if (isResponse(parsed)) return parsed;
  const next = updateScanModesConfig(parsed);
  return ok(next);
}
