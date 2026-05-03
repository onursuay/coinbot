// AI Aksiyon Merkezi — Faz 1.1 cache/refresh testleri.
//
// Doğrulanan invaryantlar:
//   • Aynı snapshot için hash deterministic ve sıra-bağımsız (actionPlans).
//   • Küçük floating point gürültüsü hash'i değiştirmez.
//   • Snapshot değişirse hash değişir.
//   • evaluateCache: fresh / stale_data / stale_ttl / no_cache / force_refresh.
//   • Cache içinde API key/secret tutulmaz (tip seviyesinde de yok).
//   • CACHE_STATUS_LABEL Türkçe etiketleri içerir.

import { describe, it, expect, beforeEach } from "vitest";
import {
  hashSnapshot,
  evaluateCache,
  getCached,
  setCached,
  clearCachedForTests,
  DECISION_CACHE_TTL_MS,
  CACHE_STATUS_LABEL,
  type DecisionSnapshot,
} from "@/lib/ai-actions";

function baseSnapshot(): DecisionSnapshot {
  return {
    closedTrades: 25,
    openPositions: 1,
    totalPnl: 12.345,
    dailyPnl: -1.234,
    winRate: 44,
    profitFactor: 1.35,
    actionPlans: [
      { id: "p1", type: "UPDATE_RISK_PER_TRADE_DOWN" },
      { id: "p2", type: "SET_OBSERVATION_MODE" },
    ],
    riskSettingsSummary: {
      riskPerTradePercent: 3,
      dailyMaxLossPercent: 10,
      defaultMaxOpenPositions: 3,
      dynamicMaxOpenPositions: 5,
      maxDailyTrades: 10,
    },
  };
}

beforeEach(() => clearCachedForTests());

describe("hashSnapshot — determinism", () => {
  it("aynı snapshot için aynı hash", () => {
    expect(hashSnapshot(baseSnapshot())).toBe(hashSnapshot(baseSnapshot()));
  });

  it("actionPlans sırasından bağımsız", () => {
    const a = baseSnapshot();
    const b = baseSnapshot();
    b.actionPlans = [...b.actionPlans].reverse();
    expect(hashSnapshot(a)).toBe(hashSnapshot(b));
  });

  it("küçük floating point gürültüsü 4 ondalık ile yutulur", () => {
    const a = baseSnapshot();
    const b = baseSnapshot();
    b.totalPnl = 12.34500001;
    b.profitFactor = 1.34999999;
    // round(1.34999999 * 10000) = 13500, round(1.35 * 10000) = 13500 → eşit.
    expect(hashSnapshot(a)).toBe(hashSnapshot(b));
  });

  it("snapshot değerleri değişirse hash değişir", () => {
    const a = baseSnapshot();
    const b = baseSnapshot();
    b.totalPnl = 100;
    expect(hashSnapshot(a)).not.toBe(hashSnapshot(b));
  });

  it("riskSettingsSummary değişirse hash değişir", () => {
    const a = baseSnapshot();
    const b = baseSnapshot();
    b.riskSettingsSummary.riskPerTradePercent = 2;
    expect(hashSnapshot(a)).not.toBe(hashSnapshot(b));
  });

  it("plan listesi değişirse hash değişir", () => {
    const a = baseSnapshot();
    const b = baseSnapshot();
    b.actionPlans.push({ id: "p3", type: "UPDATE_MAX_DAILY_TRADES_DOWN" });
    expect(hashSnapshot(a)).not.toBe(hashSnapshot(b));
  });
});

describe("evaluateCache — durum makinesi", () => {
  const HASH_A = "a".repeat(64);
  const HASH_B = "b".repeat(64);

  it("cache yokken no_cache döner", () => {
    const r = evaluateCache({ snapshotHash: HASH_A });
    expect(r.status).toBe("no_cache");
    expect(r.hit).toBe(false);
  });

  it("aynı hash + TTL içinde fresh döner", () => {
    setCached({
      hash: HASH_A,
      decision: {} as any,
      generatedAt: Date.now() - 1000,
      source: "openai_live",
    });
    const r = evaluateCache({ snapshotHash: HASH_A });
    expect(r.status).toBe("fresh");
    expect(r.hit).toBe(true);
  });

  it("hash farklıysa stale_data döner", () => {
    setCached({
      hash: HASH_A,
      decision: {} as any,
      generatedAt: Date.now() - 1000,
      source: "openai_live",
    });
    const r = evaluateCache({ snapshotHash: HASH_B });
    expect(r.status).toBe("stale_data");
    expect(r.hit).toBe(false);
  });

  it("TTL doldu ise stale_ttl döner", () => {
    const oldGenerated = Date.now() - DECISION_CACHE_TTL_MS - 1000;
    setCached({
      hash: HASH_A,
      decision: {} as any,
      generatedAt: oldGenerated,
      source: "openai_live",
    });
    const r = evaluateCache({ snapshotHash: HASH_A });
    expect(r.status).toBe("stale_ttl");
    expect(r.hit).toBe(false);
  });

  it("force=true → force_refresh, fresh cache olsa bile miss", () => {
    setCached({
      hash: HASH_A,
      decision: {} as any,
      generatedAt: Date.now(),
      source: "openai_live",
    });
    const r = evaluateCache({ snapshotHash: HASH_A, force: true });
    expect(r.status).toBe("force_refresh");
    expect(r.hit).toBe(false);
  });

  it("custom ttlMs/now ile çalışır (test injection)", () => {
    const t0 = 1_000_000_000_000;
    setCached({
      hash: HASH_A,
      decision: {} as any,
      generatedAt: t0,
      source: "openai_live",
    });
    // 5 dk geçti, TTL=10 dk → fresh
    const r1 = evaluateCache({
      snapshotHash: HASH_A,
      now: t0 + 5 * 60_000,
      ttlMs: 10 * 60_000,
    });
    expect(r1.status).toBe("fresh");
    // 15 dk geçti, TTL=10 dk → stale_ttl
    const r2 = evaluateCache({
      snapshotHash: HASH_A,
      now: t0 + 15 * 60_000,
      ttlMs: 10 * 60_000,
    });
    expect(r2.status).toBe("stale_ttl");
  });
});

describe("Cache yapısı — secret leak yok", () => {
  it("CachedDecisionEntry tip alanları sadece hash + decision + meta", () => {
    setCached({
      hash: "x".repeat(64),
      decision: {
        status: "OBSERVE",
        riskLevel: "MEDIUM",
        mainFinding: "x",
        systemInterpretation: "y",
        recommendation: "z",
        actionType: "OBSERVE",
        confidence: 70,
        requiresUserApproval: false,
        observeDays: 14,
        blockedBy: [],
        suggestedPrompt: null,
        safetyNotes: ["AI uygulamaz."],
        appliedToTradeEngine: false,
      } as any,
      generatedAt: 1,
      source: "openai_live",
    });
    const got = getCached();
    expect(got).toBeTruthy();
    const keys = Object.keys(got!);
    expect(keys).toEqual(
      expect.arrayContaining(["hash", "decision", "generatedAt", "source"]),
    );
    // apiKey/secret/token alanı YOK.
    expect(keys).not.toContain("apiKey");
    expect(keys).not.toContain("openaiKey");
    expect(keys).not.toContain("secret");
  });
});

describe("CACHE_STATUS_LABEL — Türkçe etiketler", () => {
  it("tüm durumlar için etiket var", () => {
    expect(CACHE_STATUS_LABEL.fresh).toBe("Güncel");
    expect(CACHE_STATUS_LABEL.stale_data).toBe("Veri değişti, yenilendi");
    expect(CACHE_STATUS_LABEL.stale_ttl).toBe("TTL doldu, yenilendi");
    expect(CACHE_STATUS_LABEL.no_cache).toBe("İlk analiz");
    expect(CACHE_STATUS_LABEL.force_refresh).toBe("Manuel yenileme");
  });
});
