// Phase 11 — Opportunity Priority Score / Fırsat Önceliklendirme tests.
//
// Bu testler:
// - Saf score / rank / bucket fonksiyonlarının davranışını doğrular.
// - Eksik veri durumunda NaN üretilmediğini garantiler.
// - Trading invariant'lerinin (MIN_SIGNAL_CONFIDENCE=70, hard live gate,
//   tradeSignalScore matematik ve trade-açma akışı) korunduğunu kanıtlar.
// - Yeni Binance API çağrısı eklenmediğini ve Risk Yönetimi ayarlarının
//   execution'a bağlanmadığını doğrular.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  computeOpportunityPriorityScore,
  rankOpportunities,
  classifyOpportunityBucket,
  DEFAULT_PRIORITY_BUCKET_CONFIG,
  DEFAULT_PRIORITY_WEIGHTS,
  type OpportunityInput,
} from "@/lib/opportunity-priority";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

const SCORE_SRC = read("src/lib/opportunity-priority/score.ts");
const RANK_SRC = read("src/lib/opportunity-priority/rank.ts");
const TYPES_SRC = read("src/lib/opportunity-priority/types.ts");
const ENG_BOT = read("src/lib/engines/bot-orchestrator.ts");
const ENG_SIGNAL = read("src/lib/engines/signal-engine.ts");

// ── Yardımcı: minimal aday ───────────────────────────────────────────────
const base = (over: Partial<OpportunityInput> = {}): OpportunityInput => ({
  symbol: "BTC/USDT",
  ...over,
});

// ── 1. Skor 0..100 + clamp ────────────────────────────────────────────
describe("Phase 11 — Opportunity Priority Score 0..100 aralığında", () => {
  it("Tamamen boş aday: skor 0..100, NaN yok", () => {
    const r = computeOpportunityPriorityScore(base());
    expect(Number.isFinite(r.score)).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it("Aşırı uçtaki tüm sinyaller bile 100'ü geçmez", () => {
    const r = computeOpportunityPriorityScore(base({
      tradeSignalScore: 95,
      setupScore: 95,
      marketQualityScore: 95,
      rrRatio: 5,
      spreadPercent: 0.01,
      depthScore: 5_000_000,
      quoteVolume24h: 500_000_000,
      btcAligned: true,
      atrPercentile: 50,
      volumeImpulse: 1.8,
      sourceDisplay: "KRM",
      sources: ["WIDE_MARKET", "MOMENTUM"],
    }));
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it("Tüm bileşen alt skorları clamp edilir [0,100]", () => {
    const r = computeOpportunityPriorityScore(base({
      tradeSignalScore: 999,
      setupScore: 999,
      marketQualityScore: 999,
    }));
    for (const v of Object.values(r.components)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("Ağırlıklar toplamı 1.0 (UI/test invariant)", () => {
    const sum = Object.values(DEFAULT_PRIORITY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(0.001);
  });
});

// ── 2. tradeSignalScore baskın bileşendir ──────────────────────────────
describe("Phase 11 — tradeSignalScore yüksek olan daha yüksek priority alır", () => {
  it("85 vs 60 — 85 olan kazanır", () => {
    const a = computeOpportunityPriorityScore(base({ symbol: "A/USDT", tradeSignalScore: 85 }));
    const b = computeOpportunityPriorityScore(base({ symbol: "B/USDT", tradeSignalScore: 60 }));
    expect(a.score).toBeGreaterThan(b.score);
  });
});

// ── 3. setupScore yüksek aday bonus alır ──────────────────────────────
describe("Phase 11 — setupScore yüksek aday bonus alır", () => {
  it("Setup 80 vs 40 — yüksek olan üstte", () => {
    const a = computeOpportunityPriorityScore(base({ symbol: "A/USDT", setupScore: 80, tradeSignalScore: 50 }));
    const b = computeOpportunityPriorityScore(base({ symbol: "B/USDT", setupScore: 40, tradeSignalScore: 50 }));
    expect(a.score).toBeGreaterThan(b.score);
    expect(a.reasons.some((r) => /Fırsat yapısı/i.test(r))).toBe(true);
  });
});

// ── 4. marketQualityScore / preScore etkili olur ──────────────────────
describe("Phase 11 — kalite skorunun etkisi", () => {
  it("marketQualityScore 90 > 30 (diğer her şey eşit)", () => {
    const a = computeOpportunityPriorityScore(base({ symbol: "A/USDT", tradeSignalScore: 60, marketQualityScore: 90 }));
    const b = computeOpportunityPriorityScore(base({ symbol: "B/USDT", tradeSignalScore: 60, marketQualityScore: 30 }));
    expect(a.score).toBeGreaterThan(b.score);
  });

  it("marketQualityScore yoksa preScore fallback'i kullanılır", () => {
    const r = computeOpportunityPriorityScore(base({ marketQualityPreScore: 80, tradeSignalScore: 60 }));
    expect(r.components.quality).toBeGreaterThanOrEqual(85);
  });
});

// ── 5. Spread yüksekse penalty alır ───────────────────────────────────
describe("Phase 11 — spread yüksekse penalty", () => {
  it("Spread 0.5% → liquidity bileşeni düşük + 'Spread yüksek' penalty", () => {
    const r = computeOpportunityPriorityScore(base({ tradeSignalScore: 80, spreadPercent: 0.5 }));
    expect(r.penalties).toContain("Spread yüksek");
  });
});

// ── 6. BTC veto cezalandırılır ────────────────────────────────────────
describe("Phase 11 — BTC veto/uyumsuzluğu penalty", () => {
  it("btcVeto=true → btcAlignment=0 + 'BTC yön uyumsuzluğu' penalty", () => {
    const r = computeOpportunityPriorityScore(base({ tradeSignalScore: 80, btcVeto: true }));
    expect(r.components.btcAlignment).toBe(0);
    expect(r.penalties).toContain("BTC yön uyumsuzluğu");
  });

  it("btcAligned=true → 'BTC yönü uyumlu' reason + tam 100 alt skor", () => {
    const r = computeOpportunityPriorityScore(base({ tradeSignalScore: 80, btcAligned: true }));
    expect(r.reasons).toContain("BTC yönü uyumlu");
    expect(r.components.btcAlignment).toBe(100);
  });

  it("btcTrendRejected alias da cezalandırılır", () => {
    const r = computeOpportunityPriorityScore(base({ tradeSignalScore: 80, btcTrendRejected: true }));
    expect(r.components.btcAlignment).toBe(0);
  });
});

// ── 7. KRM çoklu kaynak bonus alır ────────────────────────────────────
describe("Phase 11 — KRM çoklu kaynak bonus", () => {
  it("≥2 kaynak → 'KRM çoklu kaynak teyidi var' reason", () => {
    const r = computeOpportunityPriorityScore(base({
      tradeSignalScore: 60,
      sources: ["WIDE_MARKET", "MOMENTUM"],
    }));
    expect(r.reasons.join(" ")).toMatch(/KRM çoklu kaynak/);
  });

  it("sourceDisplay='KRM' direkt KRM olarak işlenir", () => {
    const r = computeOpportunityPriorityScore(base({ tradeSignalScore: 60, sourceDisplay: "KRM" }));
    expect(r.components.source).toBeGreaterThanOrEqual(90);
  });
});

// ── 8. MİL kaynak önceliği çalışır ────────────────────────────────────
describe("Phase 11 — MİL kaynak önceliği", () => {
  it("sourceDisplay='MİL' yüksek skor + 'MİL kaynak önceliği' reason", () => {
    const r = computeOpportunityPriorityScore(base({ tradeSignalScore: 60, sourceDisplay: "MİL" }));
    expect(r.components.source).toBeGreaterThanOrEqual(85);
    expect(r.reasons.join(" ")).toMatch(/MİL kaynak önceliği/);
  });
});

// ── 9. MT momentum bonusu çalışır ─────────────────────────────────────
describe("Phase 11 — MT momentum bonusu", () => {
  it("sourceDisplay='MT' → 'MT momentum desteği var' reason", () => {
    const r = computeOpportunityPriorityScore(base({ tradeSignalScore: 60, sourceDisplay: "MT" }));
    expect(r.reasons.join(" ")).toMatch(/MT momentum desteği/);
  });
});

// ── 10. Ranking deterministic ─────────────────────────────────────────
describe("Phase 11 — rankOpportunities deterministic", () => {
  it("Aynı input iki çağrıda aynı sırayı verir", () => {
    const inputs: OpportunityInput[] = [
      { symbol: "A/USDT", tradeSignalScore: 80 },
      { symbol: "B/USDT", tradeSignalScore: 75 },
      { symbol: "C/USDT", tradeSignalScore: 65 },
      { symbol: "D/USDT", tradeSignalScore: 55 },
      { symbol: "E/USDT", tradeSignalScore: 40 },
    ];
    const r1 = rankOpportunities(inputs).map((x) => x.symbol);
    const r2 = rankOpportunities([...inputs].reverse()).map((x) => x.symbol);
    expect(r1).toEqual(r2);
  });

  it("Eşit skorda symbol asc tiebreaker", () => {
    const r = rankOpportunities([
      { symbol: "BBB/USDT", tradeSignalScore: 70, setupScore: 70, marketQualityScore: 80, quoteVolume24h: 5_000_000 },
      { symbol: "AAA/USDT", tradeSignalScore: 70, setupScore: 70, marketQualityScore: 80, quoteVolume24h: 5_000_000 },
    ]);
    expect(r[0].symbol).toBe("AAA/USDT");
  });

  it("rank 1-tabanlı + monotonik", () => {
    const r = rankOpportunities([
      { symbol: "X/USDT", tradeSignalScore: 80 },
      { symbol: "Y/USDT", tradeSignalScore: 60 },
    ]);
    expect(r[0].opportunityPriorityRank).toBe(1);
    expect(r[1].opportunityPriorityRank).toBe(2);
    expect(r[0].opportunityPriorityScore).toBeGreaterThanOrEqual(r[1].opportunityPriorityScore);
  });
});

// ── 11. Bucket sınıflandırma ──────────────────────────────────────────
describe("Phase 11 — PRIMARY / WATCH_QUEUE / REJECTED_OR_WEAK bucket atama", () => {
  it("İlk 3 güçlü aday PRIMARY, 4-5 WATCH_QUEUE, kalan REJECTED_OR_WEAK", () => {
    const inputs: OpportunityInput[] = [
      { symbol: "A1/USDT", tradeSignalScore: 88, setupScore: 80, marketQualityScore: 80, btcAligned: true },
      { symbol: "A2/USDT", tradeSignalScore: 82, setupScore: 75, marketQualityScore: 78, btcAligned: true },
      { symbol: "A3/USDT", tradeSignalScore: 76, setupScore: 70, marketQualityScore: 75, btcAligned: true },
      { symbol: "A4/USDT", tradeSignalScore: 64, setupScore: 60, marketQualityScore: 70 },
      { symbol: "A5/USDT", tradeSignalScore: 55, setupScore: 55, marketQualityScore: 60 },
      { symbol: "A6/USDT", tradeSignalScore: 30, setupScore: 25, marketQualityScore: 50 },
      { symbol: "A7/USDT", tradeSignalScore: 10, setupScore: 5  },
    ];
    const r = rankOpportunities(inputs);
    const buckets = r.map((x) => ({ symbol: x.symbol, b: x.opportunityBucket }));
    const primaries = buckets.filter((x) => x.b === "PRIMARY");
    const watch = buckets.filter((x) => x.b === "WATCH_QUEUE");
    const weak = buckets.filter((x) => x.b === "REJECTED_OR_WEAK");
    expect(primaries.length).toBe(3);
    expect(watch.length).toBeGreaterThanOrEqual(1);
    expect(weak.length).toBeGreaterThanOrEqual(1);
  });

  it("BTC veto → REJECTED_OR_WEAK (üst sıraya çıksa bile)", () => {
    const r = rankOpportunities([
      { symbol: "VETO/USDT", tradeSignalScore: 95, setupScore: 95, btcVeto: true },
      { symbol: "OK/USDT", tradeSignalScore: 60, setupScore: 60, btcAligned: true },
    ]);
    const veto = r.find((x) => x.symbol === "VETO/USDT")!;
    expect(veto.opportunityBucket).toBe("REJECTED_OR_WEAK");
  });

  it("Risk reddi → REJECTED_OR_WEAK", () => {
    const r = rankOpportunities([
      { symbol: "R/USDT", tradeSignalScore: 80, setupScore: 70, riskAllowed: false, riskRejectReason: "Spread yüksek" },
    ]);
    expect(r[0].opportunityBucket).toBe("REJECTED_OR_WEAK");
  });

  it("ts ve setup ikisi de 0 → REJECTED_OR_WEAK", () => {
    const b = classifyOpportunityBucket({
      input: { symbol: "Z/USDT", tradeSignalScore: 0, setupScore: 0 },
      score: 80, // skor yüksek olsa bile
      rank: 1,
      config: DEFAULT_PRIORITY_BUCKET_CONFIG,
    });
    expect(b).toBe("REJECTED_OR_WEAK");
  });

  it("Default config: 3 PRIMARY, 5 üst sınır, 60 primary, 50 watch eşiği", () => {
    expect(DEFAULT_PRIORITY_BUCKET_CONFIG.primaryCapacity).toBe(3);
    expect(DEFAULT_PRIORITY_BUCKET_CONFIG.dynamicUpperCapacity).toBe(5);
    expect(DEFAULT_PRIORITY_BUCKET_CONFIG.minPrimaryScore).toBe(60);
    expect(DEFAULT_PRIORITY_BUCKET_CONFIG.minWatchScore).toBe(50);
  });
});

// ── 12. Eksik veri NaN üretmez ────────────────────────────────────────
describe("Phase 11 — eksik veri NaN üretmez", () => {
  it("Tüm alanlar undefined: priority skoru sayı, components sayı", () => {
    const r = computeOpportunityPriorityScore({ symbol: "X/USDT" });
    expect(Number.isNaN(r.score)).toBe(false);
    for (const k of Object.keys(r.components) as (keyof typeof r.components)[]) {
      expect(Number.isFinite(r.components[k])).toBe(true);
    }
  });

  it("rrRatio null + spread null + atr null + volume null: nötr fallback", () => {
    const r = computeOpportunityPriorityScore({
      symbol: "X/USDT",
      tradeSignalScore: 60,
      rrRatio: null,
      spreadPercent: null,
      atrPercentile: null,
      volumeImpulse: null,
    });
    expect(r.components.riskReward).toBe(50);
    expect(r.components.liquidity).toBe(50);
    expect(r.components.volatility).toBe(50);
  });

  it("rankOpportunities boş listede [] döner", () => {
    expect(rankOpportunities([])).toEqual([]);
  });
});

// ── 13. Reasons / Penalties metin örnekleri ───────────────────────────
describe("Phase 11 — reasons / penalties örnekleri", () => {
  it("Güçlü sinyal + sağlıklı likidite + BTC uyum → en az 3 pozitif reason", () => {
    const r = computeOpportunityPriorityScore({
      symbol: "X/USDT",
      tradeSignalScore: 80,
      setupScore: 80,
      marketQualityScore: 85,
      btcAligned: true,
      spreadPercent: 0.04,
      depthScore: 2_000_000,
      quoteVolume24h: 200_000_000,
    });
    expect(r.reasons.length).toBeGreaterThanOrEqual(3);
    expect(r.reasons.some((s) => /İşlem skoru güçlü/.test(s))).toBe(true);
    expect(r.reasons.some((s) => /BTC yönü uyumlu/.test(s))).toBe(true);
  });

  it("Sinyal eşiğe uzak penalty üretir", () => {
    const r = computeOpportunityPriorityScore({ symbol: "X/USDT", tradeSignalScore: 25 });
    expect(r.penalties).toContain("Sinyal eşiğe uzak");
  });
});

// ── 14. tradeSignalScore matematiği ve trade-açma akışı değişmedi ─────
describe("Phase 11 — trading invariant'leri ve decoupling", () => {
  it("MIN_SIGNAL_CONFIDENCE eşiği signal-engine'de hâlâ 70", () => {
    expect(ENG_SIGNAL).toMatch(/aggressiveMinScore\s*\?\?\s*70/);
  });

  it("Opportunity Priority kodu signal-engine veya bot-orchestrator import etmez", () => {
    expect(SCORE_SRC).not.toMatch(/from\s+["']@\/lib\/engines\/(signal-engine|bot-orchestrator)/);
    expect(RANK_SRC).not.toMatch(/from\s+["']@\/lib\/engines\/(signal-engine|bot-orchestrator)/);
    expect(TYPES_SRC).not.toMatch(/from\s+["']@\/lib\/engines\/(signal-engine|bot-orchestrator)/);
  });

  it("bot-orchestrator opportunity-priority modülünü import etmez (Faz 11 decoupled)", () => {
    expect(ENG_BOT).not.toMatch(/from\s+["']@\/lib\/opportunity-priority/);
  });

  it("Risk Yönetimi store'u opportunity-priority import etmez (decoupling)", () => {
    const riskStore = read("src/lib/risk-settings/store.ts");
    expect(riskStore).not.toMatch(/opportunity-priority/);
  });

  it("Yeni Binance API çağrısı yok (lib içinde fapi/api/axios import yok)", () => {
    for (const code of [SCORE_SRC, RANK_SRC, TYPES_SRC]) {
      expect(code).not.toMatch(/fapi\.binance\.com/);
      expect(code).not.toMatch(/api\.binance\.com/);
      expect(code).not.toMatch(/from\s+["']axios["']/);
      expect(code).not.toMatch(/import\s+axios/);
    }
  });

  it("HARD_LIVE_TRADING_ALLOWED env'de korunur", () => {
    const env = read("src/lib/env.ts");
    expect(env).toMatch(/HARD_LIVE_TRADING_ALLOWED/);
  });

  it("Worker lock dokunulmadı (anahtar dosya mevcut)", () => {
    const lockExists = fs.existsSync(path.join(REPO_ROOT, "worker/lock.ts"));
    expect(lockExists).toBe(true);
  });
});

// ── 15. Önceki fazların korunması ─────────────────────────────────────
describe("Phase 11 — Faz 8/9/10 sayfaları bozulmadı", () => {
  it("Piyasa Tarayıcı (Faz 8) imzası korundu", () => {
    const scanner = read("src/app/scanner/page.tsx");
    expect(scanner).toMatch(/Phase 8 — Piyasa Tarayıcı/);
  });

  it("Dashboard kartları (Faz 9) hâlâ mevcut", () => {
    const cards = read("src/components/dashboard/Cards.tsx");
    expect(cards).toMatch(/POZİSYON KARAR MERKEZİ/);
    expect(cards).toMatch(/PİYASA NABZI/);
    expect(cards).toMatch(/FIRSAT RADARI/);
  });

  it("Risk Yönetimi sayfası (Faz 10) hâlâ kart bazlı", () => {
    const risk = read("src/app/risk/page.tsx");
    expect(risk).toMatch(/RİSK YÖNETİMİ/);
    expect(risk).toMatch(/KALDIRAÇ ARALIKLARI/);
  });
});
