// AI Aksiyon Merkezi — Faz 4: aksiyon geçmişi read model.
//
// bot_logs tablosundan AI Aksiyon Merkezi event'lerini okuyup kullanıcı
// dostu HistoryItem formatına dönüştürür.
//
// MUTLAK KURALLAR:
//   • Bu modül read-only'dir; DB write yapmaz.
//   • metadataSafe içinde secret/token/key value SIZDIRILMAZ.
//   • Bozuk metadata varsa silently downgrade — endpoint patlamaz.
//   • Hiçbir trade engine, signal threshold veya canlı trading gate
//     kararı bu modül tarafından dokunulmaz.

/** AI Aksiyon Merkezi'nin yazdığı event tip listesi. */
export const AI_ACTION_EVENT_TYPES: readonly string[] = [
  // Apply pipeline
  "ai_action_apply_requested",
  "ai_action_apply_blocked",
  "ai_action_apply_failed",
  "ai_action_applied",
  "ai_action_observation_set",
  // Rollback pipeline
  "ai_action_rollback_requested",
  "ai_action_rollback_blocked",
  "ai_action_rollback_applied",
  "ai_action_rollback_failed",
  // Decision cache
  "ai_decision_cache_hit",
  "ai_decision_cache_miss",
  "ai_decision_refreshed",
  "ai_decision_fallback_cached",
  // Faz 6 — Prompt center
  "ai_action_prompt_requested",
  "ai_action_prompt_generated",
  "ai_action_prompt_blocked",
  "ai_action_prompt_failed",
] as const;

/** Rollback için uygun aksiyon tipleri — yalnızca bu 4 downward tipi geri alınabilir. */
export const ROLLBACK_ELIGIBLE_TYPES: readonly string[] = [
  "UPDATE_RISK_PER_TRADE_DOWN",
  "UPDATE_MAX_DAILY_LOSS_DOWN",
  "UPDATE_MAX_OPEN_POSITIONS_DOWN",
  "UPDATE_MAX_DAILY_TRADES_DOWN",
] as const;

export type HistoryCategory =
  | "action"
  | "decision"
  | "safety"
  | "observation"
  | "prompt";

export type HistoryStatus =
  | "applied"
  | "blocked"
  | "failed"
  | "observed"
  | "requested"
  | "refreshed"
  | "cache_hit"
  | "cache_miss"
  | "fallback"
  | "rollback_applied"
  | "rollback_blocked"
  | "rollback_failed"
  | "prompt_generated"
  | "prompt_blocked"
  | "prompt_failed";

export interface HistoryItem {
  id: string;
  eventType: string;
  category: HistoryCategory;
  status: HistoryStatus;
  title: string;
  summary: string;
  actionType: string | null;
  oldValue: string | null;
  newValue: string | null;
  riskLevel: string | null;
  confidence: number | null;
  source: string | null;
  createdAt: string;
  metadataSafe: Record<string, unknown>;
}

/** Ham bot_logs row tipi (history mapper bekleyen alt küme). */
export interface BotLogRow {
  id: string | number | null;
  event_type: string | null;
  message: string | null;
  metadata: unknown;
  created_at: string | null;
  level?: string | null;
}

// ── Secret filtering ─────────────────────────────────────────────────────────

const SECRET_KEY_PATTERNS: readonly RegExp[] = [
  /apikey/i,
  /api_key/i,
  /\bsecret\b/i,
  /\btoken\b/i,
  /\bpassword\b/i,
  /\bauthorization\b/i,
  /\bbearer\b/i,
  /serviceroleKey/i,
  /service_role_key/i,
  /\bkey\b/i, // catch-all (kullanıcı isimlerini etkilemez — top-level key adı eşleşmesi)
];

function isSecretKey(key: string): boolean {
  // Boolean flag'ler güvenli — örn. hasOpenAiKey/hasServiceRoleKey'i koruyalım.
  if (/^has[A-Z]/.test(key)) return false;
  for (const p of SECRET_KEY_PATTERNS) {
    if (p.test(key)) return true;
  }
  return false;
}

/** Recursively scrubs secret-like keys; returns a clean copy. */
export function sanitizeMetadata(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  if (Array.isArray(input)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (isSecretKey(k)) {
      out[k] = "[REDACTED]";
      continue;
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = sanitizeMetadata(v);
    } else if (Array.isArray(v)) {
      out[k] = v.map((entry) =>
        entry && typeof entry === "object" && !Array.isArray(entry)
          ? sanitizeMetadata(entry)
          : entry,
      );
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ── Mapper ───────────────────────────────────────────────────────────────────

interface MappedMeta {
  category: HistoryCategory;
  status: HistoryStatus;
  title: string;
}

function categoryAndStatus(eventType: string): MappedMeta {
  switch (eventType) {
    case "ai_action_applied":
      return { category: "action", status: "applied", title: "Aksiyon Uygulandı" };
    case "ai_action_apply_blocked":
      return { category: "action", status: "blocked", title: "Aksiyon Bloke Edildi" };
    case "ai_action_apply_failed":
      return { category: "action", status: "failed", title: "Aksiyon Başarısız" };
    case "ai_action_apply_requested":
      return { category: "action", status: "requested", title: "Aksiyon İstendi" };
    case "ai_action_observation_set":
      return {
        category: "observation",
        status: "observed",
        title: "Gözlem Kararı Kaydedildi",
      };
    case "ai_action_rollback_applied":
      return { category: "action", status: "rollback_applied", title: "Aksiyon Geri Alındı" };
    case "ai_action_rollback_blocked":
      return { category: "action", status: "rollback_blocked", title: "Geri Alma Bloke Edildi" };
    case "ai_action_rollback_failed":
      return { category: "action", status: "rollback_failed", title: "Geri Alma Başarısız" };
    case "ai_action_rollback_requested":
      return { category: "action", status: "requested", title: "Geri Alma İstendi" };
    case "ai_decision_refreshed":
      return { category: "decision", status: "refreshed", title: "AI Yorum Yenilendi" };
    case "ai_decision_cache_hit":
      return { category: "decision", status: "cache_hit", title: "AI Yorum (Cache)" };
    case "ai_decision_cache_miss":
      return { category: "decision", status: "cache_miss", title: "AI Yorum Cache Kaçırdı" };
    case "ai_decision_fallback_cached":
      return {
        category: "decision",
        status: "fallback",
        title: "AI Fallback Yorumu",
      };
    case "ai_action_prompt_requested":
      return {
        category: "prompt",
        status: "requested",
        title: "Prompt İstendi",
      };
    case "ai_action_prompt_generated":
      return {
        category: "prompt",
        status: "prompt_generated",
        title: "Prompt Üretildi",
      };
    case "ai_action_prompt_blocked":
      return {
        category: "prompt",
        status: "prompt_blocked",
        title: "Prompt Engellendi",
      };
    case "ai_action_prompt_failed":
      return {
        category: "prompt",
        status: "prompt_failed",
        title: "Prompt Başarısız",
      };
    default:
      return { category: "decision", status: "refreshed", title: eventType };
  }
}

function safeString(v: unknown): string | null {
  if (typeof v === "string" && v.trim().length > 0) return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function safeNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Map a single bot_logs row to a HistoryItem.
 *
 * Defensive: every metadata read is wrapped — bozuk JSON, null veya farklı
 * şema alanları endpoint'i patlatmaz; field eksikse `null` veya boş string
 * döndürülür.
 */
export function mapHistoryItem(row: BotLogRow): HistoryItem | null {
  const eventType = row.event_type ?? "";
  if (!eventType) return null;

  const meta = categoryAndStatus(eventType);

  // metadata herhangi bir şey olabilir — string/jsonb/null. Defensive parse:
  let rawMeta: Record<string, unknown> = {};
  if (row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)) {
    rawMeta = row.metadata as Record<string, unknown>;
  } else if (typeof row.metadata === "string") {
    try {
      const parsed = JSON.parse(row.metadata);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        rawMeta = parsed as Record<string, unknown>;
      }
    } catch {
      // bozuk JSON — sessizce geç
    }
  }

  const metadataSafe = sanitizeMetadata(rawMeta);

  return {
    id: String(row.id ?? `${eventType}:${row.created_at ?? Date.now()}`),
    eventType,
    category: meta.category,
    status: meta.status,
    title: meta.title,
    summary: typeof row.message === "string" ? row.message : "",
    actionType: safeString(rawMeta.actionType ?? rawMeta.action_type),
    oldValue: safeString(rawMeta.oldValue ?? rawMeta.old_value),
    newValue: safeString(rawMeta.newValue ?? rawMeta.new_value),
    riskLevel: safeString(rawMeta.riskLevel ?? rawMeta.risk_level),
    confidence: safeNumber(rawMeta.confidence),
    source: safeString(rawMeta.source),
    createdAt: row.created_at ?? new Date().toISOString(),
    metadataSafe,
  };
}

export function mapHistoryItems(rows: BotLogRow[]): HistoryItem[] {
  const out: HistoryItem[] = [];
  for (const r of rows) {
    try {
      const item = mapHistoryItem(r);
      if (item) out.push(item);
    } catch {
      // tek bir satır hatasında diğerlerini riske atma
    }
  }
  return out;
}

// ── UI yardımcıları ──────────────────────────────────────────────────────────

export const HISTORY_STATUS_LABEL: Record<HistoryStatus, string> = {
  applied: "Uygulandı",
  blocked: "Bloke",
  failed: "Başarısız",
  observed: "Gözlemde",
  requested: "İstendi",
  refreshed: "Yenilendi",
  cache_hit: "Cache",
  cache_miss: "Cache Kaçırdı",
  fallback: "Fallback",
  rollback_applied: "Geri Alındı",
  rollback_blocked: "Geri Alma Bloke",
  rollback_failed: "Geri Alma Başarısız",
  prompt_generated: "Prompt Üretildi",
  prompt_blocked: "Prompt Engellendi",
  prompt_failed: "Prompt Başarısız",
};

export const HISTORY_CATEGORY_LABEL: Record<HistoryCategory, string> = {
  action: "Aksiyon",
  decision: "AI Yorum",
  safety: "Güvenlik",
  observation: "Gözlem",
  prompt: "Prompt",
};
