// AI Aksiyon Merkezi — Faz 2/3: GET /api/ai-actions
//
// READ-ONLY endpoint. Snapshot helper aracılığıyla canonical kaynaklardan
// okuma yapar ve deterministic generator ile ActionPlan[] döndürür.
//
// MUTLAK KURALLAR:
//   • Hiçbir ayar değiştirilmez (DB write yok).
//   • Hiçbir trade engine ayarı, risk ayarı, signal threshold, kaldıraç
//     execution veya canlı trading gate kararı bu endpoint tarafından
//     dokunulmaz.
//   • Binance API çağrısı yoktur.

import { ok, fail } from "@/lib/api-helpers";
import { getCurrentUserId } from "@/lib/auth";
import { buildAIActionsResult } from "@/lib/ai-actions/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = getCurrentUserId();
    const payload = await buildAIActionsResult(userId);
    return ok(payload);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "ai-actions hata", 500);
  }
}
