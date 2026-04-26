import { fail, ok } from "@/lib/api-helpers";
import { scanMarket } from "@/lib/engines/scanner";
import { getUniverseSlice, type ScanUniverse } from "@/lib/engines/symbol-universe";
import { getCurrentUserId } from "@/lib/auth";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import type { ExchangeName } from "@/lib/exchanges/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULTS = {
  min24hVolumeUsd: 500_000,
  maxSpreadPct: 0.1,
  maxFundingRateAbs: 0.003,
  maxSymbolsPerTick: 50,
  maxConcurrentRequests: 5,
  klineLimit: 250,
};

async function loadWatchlist(exchange: ExchangeName): Promise<string[]> {
  if (!supabaseConfigured()) return [];
  const { data } = await supabaseAdmin()
    .from("watched_symbols")
    .select("symbol, exchange_name, market_type, is_active")
    .limit(500);
  return (data ?? [])
    .filter((r) => r.is_active && r.exchange_name === exchange && r.market_type === "futures")
    .map((r: any) => r.symbol);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const exchange = (url.searchParams.get("exchange") ?? "mexc").toLowerCase() as ExchangeName;
  const scanMode = (url.searchParams.get("universe") ?? "all_futures") as ScanUniverse;
  const cursor = url.searchParams.get("cursor") ?? "0";
  const timeframe = (url.searchParams.get("tf") ?? "5m") as any;

  try {
    const watchlistSymbols = scanMode === "watchlist_only" ? await loadWatchlist(exchange) : [];

    const universe = await getUniverseSlice({
      exchange,
      scanMode,
      min24hVolumeUsd: DEFAULTS.min24hVolumeUsd,
      maxSpreadPct: DEFAULTS.maxSpreadPct,
      maxFundingRateAbs: DEFAULTS.maxFundingRateAbs,
      maxSymbolsPerTick: DEFAULTS.maxSymbolsPerTick,
      cursor,
      watchlistSymbols,
    });

    const result = await scanMarket({
      exchange,
      symbols: universe.batchSymbols,
      timeframe,
      concurrency: DEFAULTS.maxConcurrentRequests,
      klineLimit: DEFAULTS.klineLimit,
      tickerMap: universe.tickerMap,
      totalUniverse: universe.totalSymbols,
      preFilteredCount: universe.preFilteredCount,
      nextCursor: universe.nextCursor,
    });

    return ok(result);
  } catch (e: any) {
    return fail(e?.message ?? "Tarama başarısız", 502);
  }
}

export async function POST(req: Request) {
  return GET(req);
}
