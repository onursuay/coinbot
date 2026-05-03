// AI Aksiyon Merkezi — Faz 4: GET /api/ai-actions/history
//
// READ-ONLY endpoint. bot_logs tablosundan AI Aksiyon Merkezi event'lerini
// okuyup HistoryItem listesi döndürür.
//
// Query:
//   • limit (default 50, max 200)
//   • category: action | decision | safety | observation
//   • status: applied | blocked | failed | observed | requested | refreshed |
//             cache_hit | cache_miss | fallback
//
// MUTLAK KURALLAR:
//   • DB write yok (insert/update/upsert/delete/rpc set_).
//   • Hiçbir trade engine, signal threshold veya canlı trading gate
//     kararı bu endpoint tarafından dokunulmaz.
//   • Binance API çağrısı yoktur.
//   • Secret/token/API key value HİÇBİR ZAMAN response'a yansımaz —
//     sanitizeMetadata her item için uygulanır.

import { ok, fail } from "@/lib/api-helpers";
import { getCurrentUserId } from "@/lib/auth";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import {
  AI_ACTION_EVENT_TYPES,
  mapHistoryItems,
  type HistoryItem,
  type HistoryCategory,
  type HistoryStatus,
  type BotLogRow,
} from "@/lib/ai-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const VALID_CATEGORIES: readonly HistoryCategory[] = [
  "action",
  "decision",
  "safety",
  "observation",
];
const VALID_STATUSES: readonly HistoryStatus[] = [
  "applied",
  "blocked",
  "failed",
  "observed",
  "requested",
  "refreshed",
  "cache_hit",
  "cache_miss",
  "fallback",
  "rollback_applied",
  "rollback_blocked",
  "rollback_failed",
];

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const userId = getCurrentUserId();

    const limitRaw = url.searchParams.get("limit");
    const limit = clampLimit(limitRaw);
    const categoryRaw = url.searchParams.get("category");
    const category =
      categoryRaw && (VALID_CATEGORIES as readonly string[]).includes(categoryRaw)
        ? (categoryRaw as HistoryCategory)
        : null;
    const statusRaw = url.searchParams.get("status");
    const status =
      statusRaw && (VALID_STATUSES as readonly string[]).includes(statusRaw)
        ? (statusRaw as HistoryStatus)
        : null;

    const generatedAt = new Date().toISOString();

    if (!supabaseConfigured()) {
      return ok({
        items: [] as HistoryItem[],
        count: 0,
        generatedAt,
        meta: { limit, category, status, supabaseConfigured: false },
      });
    }

    const sb = supabaseAdmin();
    // Mevcut kullanıcı için AI event'leri çek. event_type IN (..) filtresi ile
    // diğer event'leri (kill switch, scanner vb.) hariç tut.
    const { data, error } = await sb
      .from("bot_logs")
      .select("id, event_type, message, metadata, created_at, level")
      .eq("user_id", userId)
      .in("event_type", AI_ACTION_EVENT_TYPES as unknown as string[])
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return fail("Aksiyon geçmişi alınamadı.", 500, {
        errorSafe: error.message?.slice(0, 200) ?? "unknown",
      });
    }

    const rows = (data ?? []) as BotLogRow[];
    let items = mapHistoryItems(rows);
    if (category) items = items.filter((i) => i.category === category);
    if (status) items = items.filter((i) => i.status === status);

    return ok({
      items,
      count: items.length,
      generatedAt,
      meta: { limit, category, status, supabaseConfigured: true },
    });
  } catch (e) {
    return fail(
      e instanceof Error ? e.message : "ai-actions/history hata",
      500,
    );
  }
}

function clampLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(n)));
}
