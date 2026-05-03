// AI Aksiyon Merkezi — Faz 1.1: GET /api/ai-actions/decision
//
// Snapshot + hash + TTL cache mantığı ile AI yorumunu yönetir. Sayfa
// her açıldığında otomatik çağrılabilir; OpenAI yalnızca veri değiştiyse
// veya TTL dolduysa tetiklenir.
//
// MUTLAK KURALLAR:
//   • Bu endpoint hiçbir ayar değiştirmez (DB write yok).
//   • Hiçbir trade engine, signal threshold veya canlı trading gate
//     kararı dokunulmaz.
//   • Binance API çağrısı yoktur.
//   • Cache sadece AI yorumunu (read-only metin) tutar; secret YOK.
//
// Query: ?force=true → manuel override, cache bypass.

import { ok, fail } from "@/lib/api-helpers";
import { getCurrentUserId } from "@/lib/auth";
import { botLog } from "@/lib/logger";
import {
  buildAIActionsResult,
  hashSnapshot,
  evaluateCache,
  setCached,
  type DecisionSnapshot,
  type CacheStatus,
  CACHE_STATUS_LABEL,
} from "@/lib/ai-actions";
import {
  buildAIDecisionContext,
  callAIDecision,
  readOpenAIConfigFromEnv,
} from "@/lib/ai-decision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const userId = getCurrentUserId();
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "true";

    // 1. Snapshot inşa et — buildAIActionsResult deterministic generator
    //    çıktısını ve performans/risk özetini hesaplar (LLM YOK).
    const planResult = await buildAIActionsResult(userId);
    const ss = planResult.sourceSnapshot;
    const snapshot: DecisionSnapshot = {
      closedTrades: ss.closedTrades,
      openPositions: ss.openPositions,
      totalPnl: ss.totalPnl,
      dailyPnl: ss.dailyPnl,
      winRate: ss.winRate,
      profitFactor: ss.profitFactor,
      actionPlans: planResult.plans.map((p) => ({ id: p.id, type: p.type })),
      riskSettingsSummary: ss.riskSettingsSummary,
    };
    const snapshotHash = hashSnapshot(snapshot);

    // 2. Cache kontrolü.
    const cacheResult = evaluateCache({ snapshotHash, force });

    if (cacheResult.hit && cacheResult.cached) {
      // CACHE HIT — OpenAI çağrısı yapılmaz.
      void botLog({
        userId,
        level: "info",
        eventType: "ai_decision_cache_hit",
        message: `AI yorum cache'den döndü hash=${snapshotHash.slice(0, 12)} age=${Math.round((cacheResult.ageMs ?? 0) / 1000)}s`,
        metadata: {
          snapshotHash,
          ageSec: Math.round((cacheResult.ageMs ?? 0) / 1000),
          ttlSec: Math.round(cacheResult.ttlMs / 1000),
          cacheStatus: cacheResult.status,
        },
      });
      return ok({
        decision: cacheResult.cached.decision,
        snapshot,
        snapshotHash,
        generatedAt: new Date(cacheResult.cached.generatedAt).toISOString(),
        ageSec: Math.round((cacheResult.ageMs ?? 0) / 1000),
        ttlSec: Math.round(cacheResult.ttlMs / 1000),
        source: "cache",
        sourceLabel: cacheResult.cached.source === "openai_fallback" ? "Cache · Fallback" : "Cache",
        cacheStatus: cacheResult.status as CacheStatus,
        cacheStatusLabel: CACHE_STATUS_LABEL[cacheResult.status],
      });
    }

    // 3. Cache miss → yeni AI çağrısı. Snapshot'tan AIDecisionContext üret.
    const cfg = readOpenAIConfigFromEnv();
    void botLog({
      userId,
      level: "info",
      eventType: "ai_decision_cache_miss",
      message: `AI yorum yeniden üretiliyor reason=${cacheResult.status} hash=${snapshotHash.slice(0, 12)}`,
      metadata: {
        snapshotHash,
        cacheStatus: cacheResult.status,
        previousAgeSec:
          cacheResult.ageMs != null ? Math.round(cacheResult.ageMs / 1000) : null,
        hasOpenAiKey: !!cfg.apiKey,
      },
    });

    const context = buildAIDecisionContext({
      mode: "paper",
      closedTradesRecent: [],
      openPositions: [],
      scanRowsCount: 0,
      // Performans+risk özetini context'e dahil et:
      riskConfig: {
        riskPerTradePercent: ss.riskSettingsSummary.riskPerTradePercent,
        dailyMaxLossPercent: ss.riskSettingsSummary.dailyMaxLossPercent,
        totalBotCapitalUsdt: 0,
        defaultMaxOpenPositions: ss.riskSettingsSummary.defaultMaxOpenPositions,
        dynamicMaxOpenPositions: ss.riskSettingsSummary.dynamicMaxOpenPositions,
        maxDailyTrades: ss.riskSettingsSummary.maxDailyTrades,
        averageDownEnabled: false,
        liveExecutionBound: false,
        leverageExecutionBound: false,
        has30xConfigured: false,
      },
    });

    const aiResponse = await callAIDecision(context, {
      apiKey: cfg.apiKey,
      model: cfg.model,
      onLog: (event, meta) => {
        void botLog({
          userId,
          level: meta.fallbackReason ? "warn" : "info",
          eventType: event,
          message: `AI cache-refresh: ${event}`,
          metadata: { snapshotHash, ...meta },
        });
      },
    });

    const isFallback = aiResponse.fallback !== null;
    const generatedAt = Date.now();

    setCached({
      hash: snapshotHash,
      decision: aiResponse.data,
      generatedAt,
      source: isFallback ? "openai_fallback" : "openai_live",
    });

    void botLog({
      userId,
      level: isFallback ? "warn" : "info",
      eventType: isFallback ? "ai_decision_fallback_cached" : "ai_decision_refreshed",
      message: `AI yorum üretildi status=${aiResponse.data.status} action=${aiResponse.data.actionType} confidence=${aiResponse.data.confidence}`,
      metadata: {
        snapshotHash,
        cacheStatus: cacheResult.status,
        status: aiResponse.data.status,
        actionType: aiResponse.data.actionType,
        confidence: aiResponse.data.confidence,
        riskLevel: aiResponse.data.riskLevel,
        fallbackReason: aiResponse.fallback,
        durationMs: aiResponse.meta.durationMs,
        hasOpenAiKey: !!cfg.apiKey,
        // OpenAI key value KESİNLİKLE loglanmıyor.
      },
    });

    return ok({
      decision: aiResponse.data,
      snapshot,
      snapshotHash,
      generatedAt: new Date(generatedAt).toISOString(),
      ageSec: 0,
      ttlSec: Math.round(cacheResult.ttlMs / 1000),
      source: isFallback ? "ai_fallback" : "ai",
      sourceLabel: isFallback ? "Yeni AI yorumu (fallback)" : "Yeni AI yorumu",
      cacheStatus: cacheResult.status,
      cacheStatusLabel: CACHE_STATUS_LABEL[cacheResult.status],
      fallbackReason: aiResponse.fallback,
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "ai-actions/decision hata", 500);
  }
}
