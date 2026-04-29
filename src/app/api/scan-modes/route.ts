import { z } from "zod";
import { ok, fail, parseBody, isResponse } from "@/lib/api-helpers";
import {
  ensureScanModesHydrated,
  getScanModesConfig,
  updateScanModesConfig,
} from "@/lib/scan-modes";

// Scan Modes config endpoint.
// GET ilk çağrıda Supabase `bot_settings.scan_modes_config` kolonundan
// hydrate eder; PUT değişiklikleri DB'ye yazar (best-effort). Hiçbir
// trade engine, signal/risk engine veya canlı trading gate'i bu route
// üzerinden değiştirilemez. Hiçbir Binance API çağrısı yapılmaz.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureScanModesHydrated();
    return ok(getScanModesConfig());
  } catch (e) {
    const msg = e instanceof Error ? e.message : "scan modes hydrate failed";
    return fail(`Tarama modları okunamadı: ${msg}`, 500);
  }
}

const Body = z.object({
  wideMarket: z.object({ active: z.boolean() }).partial().optional(),
  momentum: z.object({ active: z.boolean() }).partial().optional(),
  manualList: z.object({ active: z.boolean() }).partial().optional(),
});

export async function PUT(req: Request) {
  const parsed = await parseBody(req, Body);
  if (isResponse(parsed)) return parsed;
  try {
    await ensureScanModesHydrated();
    const next = updateScanModesConfig(parsed);
    return ok(next);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "scan modes update failed";
    return fail(`Tarama modları güncellenemedi: ${msg}`, 500);
  }
}
