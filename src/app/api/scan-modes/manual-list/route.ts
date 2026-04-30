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
import type { MarketSymbolInfo } from "@/lib/market-universe/types";

// Manuel İzleme Listesi mutation endpoints.
// Her çağrıdan önce ensureScanModesHydrated() ile DB durumu yüklenir;
// add/remove sonrası store kendisi best-effort persist eder. Hiçbir trade
// engine/canlı gate etkilenmez. Universe lookup hâlâ Phase-2 cache (6h TTL)
// üzerinden gider — yeni Binance trafiği eklenmez.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Aynı fallback listesi search/route.ts ile tutarlı tutulur.
// Binance HTTP 451 (bölge kısıtı) durumunda temel doğrulama için kullanılır.
const FALLBACK_UNIVERSE: MarketSymbolInfo[] = [
  "BTC","ETH","SOL","BNB","XRP","ADA","DOGE","AVAX","DOT","MATIC",
  "LINK","UNI","ATOM","LTC","BCH","FIL","ICP","APT","OP","ARB",
  "SUI","TRX","NEAR","INJ","PEPE","WIF","BONK","JTO","JUP","PYTH",
].map((base) => ({
  symbol: `${base}/USDT`,
  baseAsset: base,
  quoteAsset: "USDT",
  contractType: "perpetual" as const,
  status: "TRADING",
}));

const STABLECOIN_BASES = new Set(["USDT","USDC","BUSD","DAI","TUSD","USDP","FDUSD","USDD","PYUSD"]);

// Binance erişilemezken temel format doğrulaması: "XXX/USDT" olmalı, stablecoin olmamalı.
function resolveWithFormatFallback(raw: string): string | null {
  const trimmed = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!trimmed) return null;
  let candidate = trimmed;
  if (!candidate.includes("/") && !candidate.includes("-")) {
    candidate = candidate.endsWith("USDT") ? candidate.replace(/USDT$/, "/USDT") : `${candidate}/USDT`;
  }
  candidate = candidate.replace("-", "/");
  const [base, quote] = candidate.split("/");
  if (!base || quote !== "USDT") return null;
  if (STABLECOIN_BASES.has(base)) return null;
  return `${base}/USDT`;
}

const AddBody = z.object({ symbol: z.string().min(1) });

export async function POST(req: Request) {
  const parsed = await parseBody(req, AddBody);
  if (isResponse(parsed)) return parsed;

  try {
    await ensureScanModesHydrated();

    // Universe doğrulaması — 451/ağ hatası durumunda fallback + format kontrolüne geçilir.
    let universe: MarketSymbolInfo[];
    let universeFailed = false;
    try {
      universe = await getMarketUniverse({ exchange: "binance" });
      if (universe.length === 0) { universe = FALLBACK_UNIVERSE; universeFailed = true; }
    } catch {
      universe = FALLBACK_UNIVERSE;
      universeFailed = true;
    }

    let resolved = resolveManualListSymbol(parsed.symbol, universe);
    if (!resolved && universeFailed) {
      // Fallback listesinde de bulunamadı; temel format doğrulamasına geç.
      resolved = resolveWithFormatFallback(parsed.symbol);
    }

    if (!resolved) {
      return fail(
        universeFailed
          ? "Sembol formatı geçersiz (örn: SOL/USDT). Piyasa listesi şu an alınamadı."
          : "Sembol Binance Futures uygun evrende bulunamadı (USDT perpetual TRADING)",
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
