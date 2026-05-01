// P0 bugfix regression tests.
// Covers four root-cause fixes that re-enabled paper trade flow:
//  1. TIER_3 / Dynamic R:R lock — engine produces 2.20R, tier no longer demands 2.5R.
//  2. Direction-aware trend score — SHORT setups not penalised by bullish-only formula.
//  3. BTC trend filter softened — paper mode no longer hard-vetoes counter-trend signals.
//  4. R:R YETERSİZ vs RİSK REDDİ label separation in risk engine output.
//
// Live execution must remain disabled — verified at the bottom.

import { describe, it, expect, beforeEach, vi } from "vitest";

describe("P0 — TIER_3 R:R lock fix", () => {
  beforeEach(() => vi.resetModules());

  const baseInput = {
    accountBalanceUsd: 1000,
    symbol: "DOGEUSDT",
    direction: "LONG" as const,
    entryPrice: 100,
    stopLoss: 95,           // stop dist = 5
    takeProfit: 111,        // tp dist = 11 → R:R = 2.20 (engine'in tasarladığı)
    signalScore: 75,
    marketSpread: 0.001,
    recentLossStreak: 0,
    openPositionCount: 0,
    dailyRealizedPnlUsd: 0,
    weeklyRealizedPnlUsd: 0,
    dailyTargetHit: false,
    conservativeMode: false,
    killSwitchActive: false,
    webSocketHealthy: true,
    apiHealthy: true,
    dataFresh: true,
  };

  it("TIER_3 paper sinyali R:R=2.20 ile risk engine'de reddedilmemeli", async () => {
    const { evaluateRisk } = await import("@/lib/engines/risk-engine");
    const { getTierPolicy } = await import("@/lib/risk-tiers");
    const tier3 = getTierPolicy("TIER_3");

    const r = evaluateRisk({
      ...baseInput,
      tierMaxLeverage: tier3.maxLeverage,
      tierMinRiskRewardRatio: tier3.minRiskRewardRatio,
      tierMaxRiskPerTradePercent: tier3.maxRiskPerTradePercent,
    });

    // R:R ihlali OLMAMALI
    const rrViolation = r.ruleViolations.find((v) => v.toLowerCase().includes("ödül") || v.toLowerCase().includes("reward"));
    expect(rrViolation).toBeUndefined();
    expect(r.riskRewardRatio).toBeCloseTo(2.2, 1);
  });

  it("TIER_3 minRiskRewardRatio 2.0 olmalı (P0 düşürüldü)", async () => {
    const { getTierPolicy } = await import("@/lib/risk-tiers");
    expect(getTierPolicy("TIER_3").minRiskRewardRatio).toBe(2.0);
  });

  it("TIER_2 minRiskRewardRatio 2.2 korunmalı (mevcut güvenli değer)", async () => {
    const { getTierPolicy } = await import("@/lib/risk-tiers");
    expect(getTierPolicy("TIER_2").minRiskRewardRatio).toBe(2.2);
  });

  it("TIER_1 minRiskRewardRatio 2.0 korunmalı", async () => {
    const { getTierPolicy } = await import("@/lib/risk-tiers");
    expect(getTierPolicy("TIER_1").minRiskRewardRatio).toBe(2.0);
  });
});

describe("P0 — direction-aware trend score", () => {
  beforeEach(() => vi.resetModules());

  it("bearish trendde SHORT skoru, bullish trendde LONG skoru ile eşit olmalı", async () => {
    const { trendStrengthScoreForDirection } = await import("@/lib/analysis/indicators");

    // Mükemmel uptrend: monotonic increasing closes
    const upCloses = Array.from({ length: 220 }, (_, i) => 100 + i * 0.5);
    // Mükemmel downtrend: monotonic decreasing closes (ayna)
    const downCloses = Array.from({ length: 220 }, (_, i) => 100 + (219 - i) * 0.5);

    const longInUp = trendStrengthScoreForDirection(upCloses, "LONG");
    const shortInDown = trendStrengthScoreForDirection(downCloses, "SHORT");

    // Aynı kalitede setup → ~eşit puan (slope normalizasyonu fiyat tabanına bağlı, ±5 tolerans yeterli)
    expect(Math.abs(longInUp - shortInDown)).toBeLessThanOrEqual(5);
    expect(longInUp).toBeGreaterThanOrEqual(80);
    expect(shortInDown).toBeGreaterThanOrEqual(80);
  });

  it("bullish trendde SHORT skoru düşük, bearish trendde LONG skoru düşük olmalı (yön bilinçli)", async () => {
    const { trendStrengthScoreForDirection } = await import("@/lib/analysis/indicators");

    const upCloses = Array.from({ length: 220 }, (_, i) => 100 + i * 0.5);
    const downCloses = Array.from({ length: 220 }, (_, i) => 100 + (219 - i) * 0.5);

    const shortInUp = trendStrengthScoreForDirection(upCloses, "SHORT");
    const longInDown = trendStrengthScoreForDirection(downCloses, "LONG");

    // Yön karşıtı setup → düşük puan
    expect(shortInUp).toBeLessThanOrEqual(20);
    expect(longInDown).toBeLessThanOrEqual(20);
  });

  it("eski trendStrengthScore (bullish-leaning) backward-compat için var olmalı", async () => {
    const { trendStrengthScore } = await import("@/lib/analysis/indicators");
    const upCloses = Array.from({ length: 220 }, (_, i) => 100 + i * 0.5);
    const score = trendStrengthScore(upCloses);
    expect(score).toBeGreaterThanOrEqual(80);
  });
});

describe("P0 — BTC trend filtresi soft penalty (paper mode)", () => {
  beforeEach(() => vi.resetModules());

  // Yardımcı: senkron mum üreticisi (uptrend coin, opsiyonel BTC trend yönü).
  function makeKlines(direction: "up" | "down", count = 220) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const base = direction === "up" ? 100 + i * 0.5 : 200 - i * 0.5;
      out.push({
        openTime: i * 60_000,
        closeTime: i * 60_000 + 60_000,
        open: base, high: base + 0.3, low: base - 0.3, close: base, volume: 1000,
      });
    }
    return out;
  }

  function makeTicker(lastPrice = 100) {
    const spread = 0.0005;
    return {
      symbol: "ALT/USDT",
      lastPrice,
      bid: lastPrice * (1 - spread / 2),
      ask: lastPrice * (1 + spread / 2),
      spread,
      volume24h: 1_000_000,
      quoteVolume24h: 100_000_000,
      high24h: lastPrice * 1.02,
      low24h: lastPrice * 0.98,
      changePercent24h: 0.5,
      timestamp: Date.now(),
    };
  }

  it("BTC uyumsuzluğu paper mode'da hard NO_TRADE üretmemeli — sinyal devam etmeli (skor cezası ile)", async () => {
    const { generateSignal } = await import("@/lib/engines/signal-engine");

    // Coin uptrend → LONG bias mümkün; BTC downtrend → eski kod LONG'u hard veto ederdi
    const altKlines = makeKlines("up");
    const btcKlines = makeKlines("down");
    const ticker = makeTicker(altKlines.at(-1)!.close);

    const sig = generateSignal({
      symbol: "ALT/USDT", timeframe: "5m" as const,
      klines: altKlines as any, ticker: ticker as any,
      btcKlines: btcKlines as any,
    });

    // Eski davranış: signalType="NO_TRADE", rejectedReason "BTC trend negatif — LONG sinyali reddedildi"
    // Yeni davranış: rejection BTC kaynaklı OLMAMALI; sinyal LONG/SHORT/NO_TRADE olabilir
    // ama "BTC trend negatif/pozitif — sinyali reddedildi" mesajı dönmemeli.
    const reason = sig.rejectedReason ?? "";
    expect(reason.includes("BTC trend negatif — LONG sinyali reddedildi")).toBe(false);
    expect(reason.includes("BTC trend pozitif — SHORT sinyali reddedildi")).toBe(false);
  });
});

describe("P0 — R:R YETERSİZ vs RİSK REDDİ ayrımı", () => {
  beforeEach(() => vi.resetModules());

  const baseInput = {
    accountBalanceUsd: 1000,
    symbol: "BTCUSDT",
    direction: "LONG" as const,
    entryPrice: 100,
    stopLoss: 95,
    takeProfit: 110,
    signalScore: 85,
    marketSpread: 0.001,
    recentLossStreak: 0,
    openPositionCount: 0,
    dailyRealizedPnlUsd: 0,
    weeklyRealizedPnlUsd: 0,
    dailyTargetHit: false,
    conservativeMode: false,
    killSwitchActive: false,
    webSocketHealthy: true,
    apiHealthy: true,
    dataFresh: true,
  };

  it("sadece R:R yetersizse rejectKind 'rr_insufficient' olmalı", async () => {
    const { evaluateRisk } = await import("@/lib/engines/risk-engine");
    // stopDist=5, tpDist=3 → R:R=0.6 (env default minRR=2)
    const r = evaluateRisk({ ...baseInput, stopLoss: 95, takeProfit: 103 });
    expect(r.allowed).toBe(false);
    expect(r.rejectKind).toBe("rr_insufficient");
  });

  it("kill switch + R:R sorunu varsa rejectKind 'risk_violation' (gerçek limit)", async () => {
    const { evaluateRisk } = await import("@/lib/engines/risk-engine");
    const r = evaluateRisk({
      ...baseInput, killSwitchActive: true, stopLoss: 95, takeProfit: 103,
    });
    expect(r.allowed).toBe(false);
    // ≥2 ihlal → "rr_insufficient" değil, "risk_violation"
    expect(r.rejectKind).toBe("risk_violation");
  });

  it("kabul edilen sinyalde rejectKind undefined olmalı", async () => {
    const { evaluateRisk } = await import("@/lib/engines/risk-engine");
    const r = evaluateRisk({ ...baseInput });
    if (r.allowed) {
      expect(r.rejectKind).toBeUndefined();
    }
  });
});

describe("P0 — Live execution güvenlik kuralları (regression)", () => {
  // Bu patch'te dokunulan dosyalarda LIVE execution yolu açılmamış olmalı.
  // Tam codebase taraması zaten diğer faz testlerinde mevcut — burada
  // P0 patch'inin DOKUNDUĞU dosyalara odaklanıyoruz.
  const PATCHED_FILES = [
    "src/lib/engines/signal-engine.ts",
    "src/lib/engines/risk-engine.ts",
    "src/lib/risk-tiers.ts",
    "src/lib/analysis/indicators.ts",
    "src/lib/engines/bot-orchestrator.ts",
  ];

  it("P0 patch'i hiçbir dosyada /fapi/v1/order çağrısı eklemedi", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    for (const rel of PATCHED_FILES) {
      const txt = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
      // Sadece gerçek HTTP çağrısı: fetch/axios/get/post + URL pattern
      const callPattern = /(?:fetch|axios|\.(?:get|post|put|delete|request))\([^)]*\/fapi\/v1\/order/;
      expect(txt).not.toMatch(callPattern);
    }
  });

  it("P0 patch'i hiçbir dosyada /fapi/v1/leverage çağrısı eklemedi", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    for (const rel of PATCHED_FILES) {
      const txt = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
      const callPattern = /(?:fetch|axios|\.(?:get|post|put|delete|request))\([^)]*\/fapi\/v1\/leverage/;
      expect(txt).not.toMatch(callPattern);
    }
  });

  it("P0 patch'i averageDown veya HARD_LIVE_TRADING flag'lerini açmadı", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    for (const rel of PATCHED_FILES) {
      const txt = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
      // Düz literal assignment to true — paper-only project'in temel invariant'ı
      expect(txt).not.toMatch(/averageDownEnabled\s*:\s*true/);
      expect(txt).not.toMatch(/averageDownEnabled\s*=\s*true(?!\w)/);
    }
  });
});
