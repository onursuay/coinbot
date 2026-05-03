// AI Aksiyon Merkezi — Faz 1.1 cache/refresh katmanı.
//
// Görev:
//   • Sayfa her açıldığında OpenAI çağırma — snapshot hash + TTL ile
//     cache mantığı uygula.
//   • Cache hit ise kullanıcıya geçmiş yorumu döndür.
//   • Snapshot değiştiyse veya TTL doldu ise yeniden çağır ve cache'e yaz.
//   • Manuel "Analizi Yenile" override force=true ile cache'i bypass eder.
//
// SAFETY:
//   • Bu modül ayar değiştirmez, emir açmaz.
//   • Cache yalnızca AI yorumunu (read-only metin) tutar.
//   • Secret/API key cache içinde tutulmaz.
//   • In-memory module-level Map: tek-instance Vercel cold start'ında
//     yeniden oluşur — bu güvenli; sadece bir refresh tetiklenir.

import { createHash } from "node:crypto";
import type { AIDecisionOutput } from "@/lib/ai-decision";

/** Cache TTL'i — bu süre içinde aynı hash için yeniden OpenAI çağrısı yapılmaz. */
export const DECISION_CACHE_TTL_MS = 30 * 60 * 1000; // 30 dk

/**
 * Snapshot — generator input'unun değişen alanları. AI yorumunu invalide
 * etmek için yeterli, ama küçük değişikliklere (timestamp, nanosecond)
 * duyarsız.
 */
export interface DecisionSnapshot {
  closedTrades: number;
  openPositions: number;
  totalPnl: number;
  dailyPnl: number;
  winRate: number;
  profitFactor: number;
  /** Sıralı plan id+tip listesi. Sıra bağımsız hash için sortlanır. */
  actionPlans: { id: string; type: string }[];
  riskSettingsSummary: {
    riskPerTradePercent: number;
    dailyMaxLossPercent: number;
    defaultMaxOpenPositions: number;
    dynamicMaxOpenPositions: number;
    maxDailyTrades: number;
  };
}

export interface CachedDecisionEntry {
  hash: string;
  decision: AIDecisionOutput;
  /** epoch ms */
  generatedAt: number;
  /** AI live mi yoksa fallback mı; secret içermez. */
  source: "openai_live" | "openai_fallback";
}

/**
 * Cache durumu — UI'a "Cache / Yeni / Veri değişti" mesajı göstermek için.
 */
export type CacheStatus =
  | "fresh"          // hash uyuşuyor + TTL içinde → cache döndü
  | "no_cache"       // hiç yorum üretilmemiş → ilk çağrı
  | "stale_data"     // snapshot hash değişti → yeni çağrı
  | "stale_ttl"      // TTL doldu → yeni çağrı
  | "force_refresh"; // manuel override

/**
 * Stable JSON serialization for hashing — alfabetik anahtar sırası, NaN/Infinity
 * yerine null. actionPlans arr id'ye göre sortlanır (sıra bağımsız hash).
 */
function stableStringify(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (typeof val === "number" && !Number.isFinite(val)) return null;
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val;
  });
}

/** Snapshot için deterministic hash. */
export function hashSnapshot(s: DecisionSnapshot): string {
  // actionPlans sırasını id'ye göre normalize et — tek bir kombinasyon hash
  // üretir; aynı plan listesi farklı sırada gelirse cache'i invalide etmez.
  const plansSorted = [...s.actionPlans].sort((a, b) => a.id.localeCompare(b.id));
  const normalized: DecisionSnapshot = { ...s, actionPlans: plansSorted };
  // Sayısal alanları 4 ondalığa yuvarla — küçük floating point gürültüsünden
  // kaynaklı false invalidation'ı önle.
  const round = (n: number) => (Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0);
  const stable: DecisionSnapshot = {
    closedTrades: Math.trunc(s.closedTrades),
    openPositions: Math.trunc(s.openPositions),
    totalPnl: round(s.totalPnl),
    dailyPnl: round(s.dailyPnl),
    winRate: round(s.winRate),
    profitFactor: round(s.profitFactor),
    actionPlans: normalized.actionPlans,
    riskSettingsSummary: {
      riskPerTradePercent: round(s.riskSettingsSummary.riskPerTradePercent),
      dailyMaxLossPercent: round(s.riskSettingsSummary.dailyMaxLossPercent),
      defaultMaxOpenPositions: Math.trunc(s.riskSettingsSummary.defaultMaxOpenPositions),
      dynamicMaxOpenPositions: Math.trunc(s.riskSettingsSummary.dynamicMaxOpenPositions),
      maxDailyTrades: Math.trunc(s.riskSettingsSummary.maxDailyTrades),
    },
  };
  return createHash("sha256").update(stableStringify(stable)).digest("hex");
}

// ── Module-level cache (single-tenant) ───────────────────────────────────────

let cache: CachedDecisionEntry | null = null;

export function getCached(): CachedDecisionEntry | null {
  return cache ? { ...cache } : null;
}

export function setCached(entry: CachedDecisionEntry): void {
  cache = { ...entry };
}

export function clearCachedForTests(): void {
  cache = null;
}

/**
 * Cache decision: snapshot ve TTL'e göre cache hit/miss kararı verir.
 *
 * Kurallar:
 *   • force=true → her zaman miss → "force_refresh".
 *   • cache yok → "no_cache".
 *   • hash farklı → "stale_data".
 *   • generatedAt + TTL < now → "stale_ttl".
 *   • aksi → "fresh" (cache'i kullan).
 */
export interface CacheDecisionInput {
  snapshotHash: string;
  now?: number;
  force?: boolean;
  ttlMs?: number;
}

export interface CacheDecisionResult {
  status: CacheStatus;
  /** "fresh" ise hit; diğer her durumda yeni AI çağrısı yapılır. */
  hit: boolean;
  cached: CachedDecisionEntry | null;
  ageMs: number | null;
  ttlMs: number;
}

export function evaluateCache(
  input: CacheDecisionInput,
): CacheDecisionResult {
  const ttlMs = input.ttlMs ?? DECISION_CACHE_TTL_MS;
  const now = input.now ?? Date.now();
  const cached = getCached();
  const ageMs = cached ? now - cached.generatedAt : null;

  if (input.force === true) {
    return { status: "force_refresh", hit: false, cached, ageMs, ttlMs };
  }
  if (!cached) {
    return { status: "no_cache", hit: false, cached: null, ageMs: null, ttlMs };
  }
  if (cached.hash !== input.snapshotHash) {
    return { status: "stale_data", hit: false, cached, ageMs, ttlMs };
  }
  if (ageMs != null && ageMs > ttlMs) {
    return { status: "stale_ttl", hit: false, cached, ageMs, ttlMs };
  }
  return { status: "fresh", hit: true, cached, ageMs, ttlMs };
}

export const CACHE_STATUS_LABEL: Record<CacheStatus, string> = {
  fresh: "Güncel",
  stale_data: "Veri değişti, yenilendi",
  stale_ttl: "TTL doldu, yenilendi",
  no_cache: "İlk analiz",
  force_refresh: "Manuel yenileme",
};
