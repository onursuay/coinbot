import { ok, fail } from "@/lib/api-helpers";
import { getMarketUniverse } from "@/lib/market-universe";
import { searchManualListCandidates } from "@/lib/scan-modes/manual-list-search";
import { getScanModesConfig } from "@/lib/scan-modes";

// Phase 4 — Manuel İzleme Listesi search.
// Backed by the Phase-2 cached market universe (6h TTL); a user keypress
// does NOT trigger a Binance API call once the cache is warm. See
// docs/BINANCE_API_GUARDRAILS.md §6, §7, §12.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = clampLimit(url.searchParams.get("limit"));
  const exchange = "binance"; // single-tenant binance default for now

  try {
    // Cached: only refetched once per universeTtlMs (default 6h).
    const universe = await getMarketUniverse({ exchange });
    const alreadyInList = getScanModesConfig().manualList.symbols;

    const results = searchManualListCandidates(universe, { query: q, limit, alreadyInList });
    return ok({
      query: q,
      limit,
      universeSize: universe.length,
      results,
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Arama başarısız", 500);
  }
}

function clampLimit(raw: string | null): number {
  const n = Number(raw ?? "20");
  if (!Number.isFinite(n) || n <= 0) return 20;
  return Math.min(50, Math.floor(n));
}
