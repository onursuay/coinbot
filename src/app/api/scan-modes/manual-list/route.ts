import { z } from "zod";
import { fail, ok, parseBody, isResponse } from "@/lib/api-helpers";
import {
  addManualSymbol,
  removeManualSymbol,
  getScanModesConfig,
} from "@/lib/scan-modes";

// Phase 1 — manual list mutation endpoint.
// Adds/removes symbols from the Manuel İzleme Listesi. Toggling the mode's
// active flag is handled by /api/scan-modes (PUT) and never clears the
// curated list — see ScanModesConfig.manualList docs.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AddBody = z.object({ symbol: z.string().min(1) });

export async function POST(req: Request) {
  const parsed = await parseBody(req, AddBody);
  if (isResponse(parsed)) return parsed;
  const next = addManualSymbol(parsed.symbol);
  return ok(next);
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol");
  if (!symbol) return fail("symbol gerekli", 400);
  const next = removeManualSymbol(symbol);
  return ok(next);
}

export async function GET() {
  return ok(getScanModesConfig().manualList);
}
