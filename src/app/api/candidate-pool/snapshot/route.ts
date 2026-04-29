import { ok, fail } from "@/lib/api-helpers";
import {
  getCachedAllTickers,
  getMarketUniverse,
} from "@/lib/market-universe";
import { getScanModesConfig } from "@/lib/scan-modes";
import { buildUnifiedCandidatePool } from "@/lib/candidate-orchestrator";

// Phase 5 — read-only snapshot of the unified candidate pool.
//
// Backed by:
//   - cached market universe (Phase 2, 6h TTL)
//   - cached bulk tickers   (Phase 5, 60s TTL)
//   - in-memory scan-modes  (Phase 1)
//
// At most ONE Binance HTTP call per minute (the toplu /ticker/24hr
// endpoint, via the central adapter). Universe call hits at most once
// per 6h. No per-symbol fan-out, no kline/order-book fetches.
//
// This endpoint is purely diagnostic — it does NOT alter the trading
// universe, signal-engine inputs, risk engine, or the worker tick.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [universe, tickers] = await Promise.all([
      getMarketUniverse({ exchange: "binance" }),
      getCachedAllTickers({ exchange: "binance" }),
    ]);
    const scanModes = getScanModesConfig();
    const result = buildUnifiedCandidatePool({
      scanModes,
      universe,
      tickers,
    });
    return ok({
      generatedAt: result.generatedAt,
      summary: result.summary,
      pool: result.pool,
      deepAnalysisCandidates: result.deepAnalysisCandidates,
      filteredOutManualSymbols: result.filteredOutManualSymbols,
      missingMarketDataSymbols: result.missingMarketDataSymbols,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "snapshot failed";
    return fail(`Birleşik aday havuz snapshot alınamadı: ${msg}`, 500);
  }
}
