// Futures-first signal engine. Multi-filter; never relies on a single indicator.
// Outputs: LONG | SHORT | WAIT | EXIT_LONG | EXIT_SHORT | NO_TRADE with score 0-100 and reasons.

import type { Kline, Ticker, FundingRate, Timeframe } from "@/lib/exchanges/types";
import {
  atr, ema, macd, rsi, recentSwing, trendStrengthScore,
  volatilityScore, volumeConfirmationScore, wickAnomaly,
} from "@/lib/analysis/indicators";

export type SignalType = "LONG" | "SHORT" | "WAIT" | "EXIT_LONG" | "EXIT_SHORT" | "NO_TRADE";

export interface SignalContext {
  symbol: string;
  timeframe: Timeframe;
  klines: Kline[];
  ticker: Ticker;
  funding?: FundingRate | null;
  btcKlines?: Kline[]; // BTC/USDT trend reference on same timeframe
}

export interface SignalResult {
  symbol: string;
  timeframe: Timeframe;
  signalType: SignalType;
  score: number;             // 0..100
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskRewardRatio: number | null;
  reasons: string[];
  rejectedReason?: string;
  features: Record<string, number | string | boolean | null>;
}

const MAX_SPREAD_FRACTION = 0.0015; // 15 bps cap

export function generateSignal(ctx: SignalContext): SignalResult {
  const { symbol, timeframe, klines, ticker, funding, btcKlines } = ctx;
  const reasons: string[] = [];

  if (klines.length < 210) {
    return base("NO_TRADE", "Yeterli mum verisi yok (en az 210 mum gerekli)");
  }

  const closes = klines.map((k) => k.close);
  const last = closes.at(-1)!;

  const e20 = ema(closes, 20).at(-1)!;
  const e50 = ema(closes, 50).at(-1)!;
  const e200 = ema(closes, 200).at(-1)!;
  const r = rsi(closes, 14).at(-1)!;
  const m = macd(closes);
  const macdLine = m.macd.at(-1)!;
  const macdSig = m.signal.at(-1)!;
  const macdHist = m.hist.at(-1)!;
  const a14 = atr(klines, 14).at(-1)!;
  const swing = recentSwing(klines, 30);
  const trendScore = trendStrengthScore(closes);
  const volScore = volatilityScore(klines);
  const volConf = volumeConfirmationScore(klines);
  const wickAnom = wickAnomaly(klines);

  // Spread filter
  if (ticker.spread > MAX_SPREAD_FRACTION) {
    return base("NO_TRADE", `Spread çok yüksek (${(ticker.spread * 100).toFixed(3)}%) — işlem açma`);
  }

  // Volume sanity
  const minQuoteVol = 5_000_000; // 5M USDT 24h
  if (ticker.quoteVolume24h && ticker.quoteVolume24h < minQuoteVol) {
    return base("NO_TRADE", "24s hacim eşik altı — likidite yetersiz");
  }

  if (wickAnom) reasons.push("Son mumda anormal iğne tespit edildi (uyarı)");

  // BTC trend alignment
  let btcUp: boolean | null = null;
  if (btcKlines && btcKlines.length >= 60) {
    const bc = btcKlines.map((k) => k.close);
    const be20 = ema(bc, 20).at(-1)!;
    const be50 = ema(bc, 50).at(-1)!;
    btcUp = be20 >= be50;
    reasons.push(`BTC trend ${btcUp ? "pozitif" : "negatif"} (EMA20 vs EMA50)`);
  }

  // Volatility filter
  if (volScore < 30) {
    return base("NO_TRADE", "Aşırı düşük veya aşırı yüksek volatilite — fırsat kalitesiz");
  }

  // Determine candidate direction by EMA stack and momentum
  const longBias = last > e50 && e20 > e50 && macdHist > 0 && r >= 35 && r <= 70;
  const shortBias = last < e50 && e20 < e50 && macdHist < 0 && r <= 65 && r >= 30;

  if (!longBias && !shortBias) {
    return base("WAIT", "Trend ve momentum belirsiz");
  }

  const direction: "LONG" | "SHORT" = longBias ? "LONG" : "SHORT";

  // BTC alignment veto
  if (btcUp !== null) {
    if (direction === "LONG" && btcUp === false) {
      return base("NO_TRADE", "BTC trend negatif — LONG açılmaz");
    }
    if (direction === "SHORT" && btcUp === true) {
      return base("NO_TRADE", "BTC trend pozitif — SHORT açılmaz");
    }
  }

  // Stop-loss & take-profit
  let stop: number, take: number;
  const atrStopMult = 1.5;
  if (direction === "LONG") {
    const swingStop = swing.swingLow;
    const atrStop = last - a14 * atrStopMult;
    stop = Math.min(swingStop, atrStop);
    if (stop >= last) stop = last - a14 * atrStopMult;
    const dist = last - stop;
    take = last + dist * 2.2;
  } else {
    const swingStop = swing.swingHigh;
    const atrStop = last + a14 * atrStopMult;
    stop = Math.max(swingStop, atrStop);
    if (stop <= last) stop = last + a14 * atrStopMult;
    const dist = stop - last;
    take = last - dist * 2.2;
  }
  const stopDistPct = Math.abs((last - stop) / last) * 100;
  if (stopDistPct < 0.15) {
    return base("NO_TRADE", "Stop mesafesi çok dar — gürültüde tetiklenir");
  }
  if (stopDistPct > 6) {
    return base("NO_TRADE", "Stop mesafesi çok geniş — risk/ödül kötü");
  }
  const rr = direction === "LONG"
    ? (take - last) / (last - stop)
    : (last - take) / (stop - last);
  if (rr < 2) {
    return base("NO_TRADE", `Risk/ödül oranı yetersiz (1:${rr.toFixed(2)})`);
  }
  reasons.push(`Risk/ödül 1:${rr.toFixed(2)}`);

  // Funding rate guard
  if (funding) {
    const fr = funding.rate;
    if (direction === "LONG" && fr > 0.0008) reasons.push("Funding pozitif (LONG için maliyetli)");
    if (direction === "SHORT" && fr < -0.0008) reasons.push("Funding negatif (SHORT için maliyetli)");
    if (Math.abs(fr) > 0.003) {
      return base("NO_TRADE", "Funding rate aşırı — pozisyon yönü maliyetli/risksiz değil");
    }
  }

  // Compose score
  let score = 0;
  score += trendScore * 0.35;
  score += volConf * 0.25;
  score += volScore * 0.15;
  score += Math.min(25, Math.max(0, (rr - 2) * 8)); // bonus rr above 2
  if (direction === "LONG" && e50 > e200) score += 5;
  if (direction === "SHORT" && e50 < e200) score += 5;
  if (wickAnom) score -= 10;
  score = Math.max(0, Math.min(100, Math.round(score)));

  reasons.push(`EMA stack ${direction === "LONG" ? "20>50" : "20<50"}`);
  reasons.push(`RSI=${r.toFixed(1)}`);
  reasons.push(`MACD hist=${macdHist.toFixed(4)}`);
  reasons.push(`ATR(14)=${a14.toFixed(4)}, stop ${stopDistPct.toFixed(2)}%`);
  reasons.push(`Trend score=${trendScore.toFixed(0)}, Vol score=${volScore.toFixed(0)}, Vol confirm=${volConf.toFixed(0)}`);

  if (score < 70) {
    return {
      symbol, timeframe,
      signalType: "NO_TRADE",
      score,
      entryPrice: last, stopLoss: stop, takeProfit: take, riskRewardRatio: rr,
      reasons,
      rejectedReason: `Sinyal skoru yetersiz (${score} < 70)`,
      features: { ema20: e20, ema50: e50, ema200: e200, rsi: r, macdHist, atr: a14, trendScore, volScore, volConf },
    };
  }

  return {
    symbol, timeframe,
    signalType: direction,
    score,
    entryPrice: last,
    stopLoss: stop,
    takeProfit: take,
    riskRewardRatio: rr,
    reasons,
    features: { ema20: e20, ema50: e50, ema200: e200, rsi: r, macdHist, atr: a14, trendScore, volScore, volConf, wickAnom },
  };

  function base(kind: SignalType, reason: string): SignalResult {
    return {
      symbol, timeframe,
      signalType: kind,
      score: 0,
      entryPrice: null, stopLoss: null, takeProfit: null, riskRewardRatio: null,
      reasons: [reason],
      rejectedReason: kind === "NO_TRADE" ? reason : undefined,
      features: {},
    };
  }
}
