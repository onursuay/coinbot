import { z } from "zod";
import { fail, ok, parseBody, isResponse } from "@/lib/api-helpers";
import {
  addManualSymbol,
  removeManualSymbol,
  getScanModesConfig,
  ensureScanModesHydrated,
} from "@/lib/scan-modes";
import { getMarketUniverse } from "@/lib/market-universe";
import { resolveManualListSymbol } from "@/lib/scan-modes/manual-list-search";

// Manuel İzleme Listesi mutation endpoints.
// Her çağrıdan önce ensureScanModesHydrated() ile DB durumu yüklenir;
// add/remove sonrası store kendisi best-effort persist eder. Hiçbir trade
// engine/canlı gate etkilenmez. Universe lookup hâlâ Phase-2 cache (6h TTL)
// üzerinden gider — yeni Binance trafiği eklenmez.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AddBody = z.object({ symbol: z.string().min(1) });

export async function POST(req: Request) {
  const parsed = await parseBody(req, AddBody);
  if (isResponse(parsed)) return parsed;

  try {
    await ensureScanModesHydrated();
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
  } catch (e) {
    const msg = e instanceof Error ? e.message : "manual list update failed";
    return fail(`Manuel liste güncellenemedi: ${msg}`, 500);
  }
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol");
  if (!symbol) return fail("symbol gerekli", 400);
  try {
    await ensureScanModesHydrated();
    const next = removeManualSymbol(symbol);
    return ok(next);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "manual list delete failed";
    return fail(`Manuel liste silinemedi: ${msg}`, 500);
  }
}

export async function GET() {
  try {
    await ensureScanModesHydrated();
    return ok(getScanModesConfig().manualList);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "manual list read failed";
    return fail(`Manuel liste okunamadı: ${msg}`, 500);
  }
}
