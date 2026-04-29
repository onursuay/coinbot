import { ok } from "@/lib/api-helpers";
import { getMarketUniverse } from "@/lib/market-universe";
import { searchManualListCandidates, type ManualListSearchResult } from "@/lib/scan-modes/manual-list-search";
import { getScanModesConfig } from "@/lib/scan-modes";
import type { MarketSymbolInfo } from "@/lib/market-universe/types";

// Phase 4 — Manuel İzleme Listesi search.
// Backed by the Phase-2 cached market universe (6h TTL); a user keypress
// does NOT trigger a Binance API call once the cache is warm. See
// docs/BINANCE_API_GUARDRAILS.md §6, §7, §12.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fallback: core symbols used when market universe is unreachable (e.g. HTTP 451).
// Extended list so common queries like "SOL", "BTC", "ETH" always return a result.
const FALLBACK_UNIVERSE: MarketSymbolInfo[] = [
  "BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "DOT", "MATIC",
  "LINK", "UNI", "ATOM", "LTC", "BCH", "FIL", "ICP", "APT", "OP", "ARB",
  "SUI", "TRX", "NEAR", "INJ", "PEPE", "WIF", "BONK", "JTO", "JUP", "PYTH",
].map((base) => ({
  symbol: `${base}/USDT`,
  baseAsset: base,
  quoteAsset: "USDT",
  contractType: "perpetual" as const,
  status: "TRADING",
}));

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = clampLimit(url.searchParams.get("limit"));
  const exchange = "binance";

  let universe: MarketSymbolInfo[];
  let usingFallback = false;

  try {
    universe = await getMarketUniverse({ exchange });
  } catch {
    // HTTP 451 / region block / network issue — use fallback, never crash.
    universe = FALLBACK_UNIVERSE;
    usingFallback = true;
  }

  // If universe is empty despite no error (e.g. empty response), use fallback.
  if (universe.length === 0) {
    universe = FALLBACK_UNIVERSE;
    usingFallback = true;
  }

  const alreadyInList = getScanModesConfig().manualList.symbols;
  const results: ManualListSearchResult[] = searchManualListCandidates(universe, { query: q, limit, alreadyInList });

  return ok({
    query: q,
    limit,
    universeSize: universe.length,
    results,
    ...(usingFallback ? { warning: "Piyasa listesi şu an alınamadı. Son bilinen liste kullanılıyor." } : {}),
  });
}

function clampLimit(raw: string | null): number {
  const n = Number(raw ?? "20");
  if (!Number.isFinite(n) || n <= 0) return 20;
  return Math.min(50, Math.floor(n));
}
