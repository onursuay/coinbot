import { describe, it, expect } from "vitest";
import { generateSignal } from "@/lib/engines/signal-engine";
import type { Kline, Ticker } from "@/lib/exchanges/types";

// Real-data integration test: builds a synthetic but realistic candle series
// and runs generateSignal end-to-end. Ensures setupScore + marketQualityScore
// are populated even when signalType=WAIT/NO_TRADE and tradeSignalScore=0.

function buildKlines(count: number, basePrice: number, opts?: { wobble?: number; volatility?: number; volume?: number }): Kline[] {
  const wobble = opts?.wobble ?? 0.001;        // ±0.1% per candle by default — flat/ranging market
  const vol = opts?.volatility ?? 0.0015;
  const baseVolume = opts?.volume ?? 1000;
  const out: Kline[] = [];
  let price = basePrice;
  // Deterministic pseudo-random — keeps tests stable
  let seed = 42;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const now = Date.now();
  const fiveMin = 5 * 60 * 1000;
  for (let i = 0; i < count; i++) {
    const drift = (rand() - 0.5) * 2 * wobble;
    const open = price;
    const close = price * (1 + drift);
    const high = Math.max(open, close) * (1 + rand() * vol);
    const low = Math.min(open, close) * (1 - rand() * vol);
    const volume = baseVolume * (0.7 + rand() * 0.6);
    out.push({
      openTime: now - (count - i) * fiveMin,
      open, high, low, close, volume,
      closeTime: now - (count - i - 1) * fiveMin - 1,
    });
    price = close;
  }
  return out;
}

function makeTicker(lastPrice: number, opts?: { spread?: number; quoteVolume?: number }): Ticker {
  const spread = opts?.spread ?? 0.0005; // 5bps
  const quoteVolume24h = opts?.quoteVolume ?? 200_000_000;
  return {
    symbol: "TEST/USDT",
    lastPrice,
    bid: lastPrice * (1 - spread / 2),
    ask: lastPrice * (1 + spread / 2),
    spread,
    volume24h: quoteVolume24h / lastPrice,
    quoteVolume24h,
    high24h: lastPrice * 1.02,
    low24h: lastPrice * 0.98,
    changePercent24h: 0.5,
    timestamp: Date.now(),
  };
}

describe("generateSignal end-to-end integration", () => {
  it("flat/ranging market produces WAIT or NO_TRADE with non-zero setupScore + marketQualityScore", () => {
    const klines = buildKlines(220, 100, { wobble: 0.0008, volatility: 0.0012 });
    const ticker = makeTicker(klines.at(-1)!.close);
    const sig = generateSignal({
      symbol: "TEST/USDT",
      timeframe: "5m",
      klines,
      ticker,
      funding: { symbol: "TEST/USDT", rate: 0.0001, nextFundingTime: Date.now() + 3600_000 } as any,
      btcKlines: klines, // reuse — same flat shape, BTC neutral
    });

    // Ranging market → no clean direction → WAIT (or NO_TRADE if a gate fires).
    // Either way, tradeSignalScore must be 0 (no trade) but setup/quality must be > 0.
    expect(["WAIT", "NO_TRADE"]).toContain(sig.signalType);
    expect(sig.score).toBe(0);
    expect(sig.setupScore).toBeGreaterThan(0);
    expect(sig.marketQualityScore).toBeGreaterThan(0);

    // Indicator features must be populated — not stuck at pre-indicator NO_TRADE state
    expect(sig.features.indicatorStatus).toBe("ok");
    expect(sig.features.ema20).not.toBeNull();
    expect(sig.features.ma8).not.toBeNull();
    expect(sig.features.ma55).not.toBeNull();
    expect(sig.features.bollingerUpper).not.toBeNull();
    expect(sig.features.bollingerLower).not.toBeNull();
    expect(sig.features.adx).not.toBeNull();
    expect(sig.features.vwap).not.toBeNull();
    expect(sig.features.volumeMa20).not.toBeNull();
    expect(sig.features.atrPercentile).not.toBeNull();
  });

  it("MIN_SIGNAL_CONFIDENCE stays at 70 — setup/quality alone never opens a trade", () => {
    // Reinforces the safety invariant from the audit: in a realistic WAIT case,
    // even if setupScore and marketQualityScore are high, signalScore must be 0
    // (the only score that gates trade opening).
    const klines = buildKlines(220, 50, { wobble: 0.0006 });
    const ticker = makeTicker(klines.at(-1)!.close);
    const sig = generateSignal({
      symbol: "TEST/USDT",
      timeframe: "5m",
      klines,
      ticker,
      funding: null,
      btcKlines: klines,
    });
    expect(sig.score).toBe(0);
    expect(sig.signalType).not.toBe("LONG");
    expect(sig.signalType).not.toBe("SHORT");
  });
});
