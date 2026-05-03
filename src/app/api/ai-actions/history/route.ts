// AI Aksiyon Merkezi — Faz 4: GET /api/ai-actions/history
//
// READ-ONLY endpoint. bot_logs tablosundan AI Aksiyon Merkezi event'lerini
// okuyup HistoryItem listesi döndürür.
//
// Query:
//   • limit (default 50, max 200) — AI event filtreleme JS-tarafında.
//   • sinceDays (default 30, max 180) — created_at >= now - sinceDays.
//     bot_logs büyüdükçe IN(event_type) clause + ORDER BY created_at
//     birleşimi (user_id, created_at) indeksini kullanmaktan kaçınıp
//     Supabase 8s statement timeout'unu tetikliyordu. Tarih cutoff +
//     JS-side event_type filtresi indeksi düzgün kullandırıyor.
//   • category: action | decision | safety | observation | prompt
//   • status: applied | blocked | failed | observed | requested | refreshed |
//             cache_hit | cache_miss | fallback | rollback_* | prompt_*
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
const DEFAULT_SINCE_DAYS = 30;
const MAX_SINCE_DAYS = 180;

const VALID_CATEGORIES: readonly HistoryCategory[] = [
  "action",
  "decision",
  "safety",
  "observation",
  "prompt",
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
  "prompt_generated",
  "prompt_blocked",
  "prompt_failed",
];

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const userId = getCurrentUserId();

    const limitRaw = url.searchParams.get("limit");
    const limit = clampLimit(limitRaw);
    const sinceDaysRaw = url.searchParams.get("sinceDays");
    const sinceDays = clampSinceDays(sinceDaysRaw);
    const sinceCutoff = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
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
        meta: { limit, sinceDays, category, status, supabaseConfigured: false },
      });
    }

    const sb = supabaseAdmin();
    // Üretimde bot_logs çok yoğun (her tick scanner event'i yazıyor); bu yüzden:
    //   1) IN(event_type=AI...) clause'u (user_id, created_at) indeksini
    //      kullanmaktan kaçınıp Supabase 8s timeout'unu tetikliyordu.
    //   2) Saf user_id+created_at order ile over-fetch ise non-AI satırlarla
    //      doluyor ve AI event'leri kaçırılıyor.
    // Çözüm: SQL'de sadece "ai_*" prefix LIKE filtresi (tüm AI event'leri
    // kapsıyor, IN clause'una göre çok daha az kardinaliteli) + JS Set
    // filtresi (yalnızca AI Aksiyon Merkezi event'lerini bırak — örn.
    // ai_decision_requested gibi eski AI yorum event'leri dışarıda kalır).
    const { data, error } = await sb
      .from("bot_logs")
      .select("id, event_type, message, metadata, created_at, level")
      .eq("user_id", userId)
      .gte("created_at", sinceCutoff)
      .like("event_type", "ai\\_%")
      .order("created_at", { ascending: false })
      .limit(Math.min(MAX_LIMIT * 4, 800));

    if (error) {
      return fail("Aksiyon geçmişi alınamadı.", 500, {
        errorSafe: error.message?.slice(0, 200) ?? "unknown",
      });
    }

    // SQL prefix LIKE 'ai\_%' tüm ai_* event'leri yakalar; JS Set filtresi
    // sadece AI Aksiyon Merkezi (Faz 1.0+) event'lerini bırakır.
    const aiEventSet = new Set<string>(AI_ACTION_EVENT_TYPES);
    const aiRows = (data ?? []).filter((r: { event_type?: string | null }) =>
      typeof r.event_type === "string" && aiEventSet.has(r.event_type),
    ) as BotLogRow[];
    let items = mapHistoryItems(aiRows);
    if (category) items = items.filter((i) => i.category === category);
    if (status) items = items.filter((i) => i.status === status);
    items = items.slice(0, limit);

    return ok({
      items,
      count: items.length,
      generatedAt,
      meta: { limit, sinceDays, category, status, supabaseConfigured: true },
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

function clampSinceDays(raw: string | null): number {
  if (!raw) return DEFAULT_SINCE_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SINCE_DAYS;
  return Math.min(MAX_SINCE_DAYS, Math.max(1, Math.trunc(n)));
}
