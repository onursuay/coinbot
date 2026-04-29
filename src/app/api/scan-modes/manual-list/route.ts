import { z } from "zod";
import { fail, ok, parseBody, isResponse } from "@/lib/api-helpers";
import {
  addManualSymbol,
  removeManualSymbol,
  getScanModesConfig,
} from "@/lib/scan-modes";
import { getMarketUniverse } from "@/lib/market-universe";
import { resolveManualListSymbol } from "@/lib/scan-modes/manual-list-search";

// Manuel İzleme Listesi mutation endpoints.
// Phase 1 introduced add/remove/get on an in-memory store.
// Phase 4 hardens POST: the input symbol must resolve to a tradable USDT
// perpetual in the cached market universe. The universe lookup uses the
// Phase-2 cache (6h TTL) — no per-request Binance API spam.
// See docs/BINANCE_API_GUARDRAILS.md.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AddBody = z.object({ symbol: z.string().min(1) });

export async function POST(req: Request) {
  const parsed = await parseBody(req, AddBody);
  if (isResponse(parsed)) return parsed;

  // Validate against the cached market universe before mutating store.
  const universe = await getMarketUniverse({ exchange: "binance" });
  const resolved = resolveManualListSymbol(parsed.symbol, universe);
  if (!resolved) {
    return fail(
      "Sembol Binance Futures uygun evrende bulunamadı (USDT perpetual TRADING)",
      400,
      { input: parsed.symbol },
    );
  }

  const config = getScanModesConfig();
  if (config.manualList.symbols.includes(resolved)) {
    return fail("Bu coin zaten manuel listede", 409, { symbol: resolved });
  }

  const next = addManualSymbol(resolved);
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
