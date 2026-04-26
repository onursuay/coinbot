// Futures-first signal engine. Multi-filter; never relies on a single indicator.
// Outputs: LONG | SHORT | WAIT | EXIT_LONG | EXIT_SHORT | NO_TRADE with score 0-100 and reasons.
//
// Key design: ALL features are computed upfront and included in every return path,
// including early exits, so scanner always has meaningful scores.

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
  btcKlines?: Kline[];
}

export interface SignalResult {
  symbol: string;
  timeframe: Timeframe;
  signalType: SignalType;
  score: number;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskRewardRatio: number | null;
  reasons: string[];
  rejectedReason?: string;
  // Always populated — scanner depends on these even for NO_TRADE returns.
  features: Record<string, number | string | boolean | null>;
}

const MAX_SPREAD_FRACTION = 0.0015; // 15 bps cap
// Only block on truly dead markets (vol < 5). Normal 5m candles easily clear this.
const MIN_VOL_SCORE_FOR_TRADE = 15;

export function generateSignal(ctx: SignalContext): SignalResult {
  const { symbol, timeframe, klines, ticker, funding, btcKlines } = ctx;

  // ── Baseline features — populated incrementally, returned in every path ──
  const features: Record<string, number | string | boolean | null> = {
    candleCount: klines.length,
    lastCandleTime: klines.at(-1)?.closeTime ?? null,
    indicatorStatus: "pending",
  };

  const earlyExit = (kind: SignalType, reason: string): SignalResult => ({
    symbol, timeframe, signalType: kind, score: 0,
    entryPrice: null, stopLoss: null, takeProfit: null, riskRewardRatio: null,
    reasons: [reason], rejectedReason: kind === "NO_TRADE" ? reason : undefined,
    features: { ...features },
  });

  // ── Candle count guard ──
  if (klines.length < 210) {
    features.indicatorStatus = "insufficient_candles";
    return earlyExit("NO_TRADE", `Yetersiz mum verisi (${klines.length} mum, min 210 gerekli)`);
  }

  // ── Compute all indicators ──
  const closes = klines.map((k) => k.close);
  const last = closes.at(-1)!;

  const e20Arr = ema(closes, 20);
  const e50Arr = ema(closes, 50);
  const e200Arr = ema(closes, 200);
  const e20 = e20Arr.at(-1) ?? NaN;
  const e50 = e50Arr.at(-1) ?? NaN;
  const e200 = e200Arr.at(-1) ?? NaN;

  if (![e20, e50, e200].every(Number.isFinite)) {
    features.indicatorStatus = "ema_calculation_failed";
    return earlyExit("NO_TRADE", "Gösterge hesabı başarısız (EMA) — veri kalitesi kontrol edin");
  }

  const rsiArr = rsi(closes, 14);
  const r = rsiArr.at(-1) ?? NaN;

  const { hist: macdHistArr, macd: macdLineArr, signal: macdSignalArr } = macd(closes);
  const macdHist = macdHistArr.at(-1) ?? NaN;
  const macdLine = macdLineArr.at(-1) ?? NaN;

  const a14 = atr(klines, 14).at(-1) ?? NaN;
  const swing = recentSwing(klines, 30);
  const trendScore = trendStrengthScore(closes);
  const volScore = volatilityScore(klines);
  const volConf = volumeConfirmationScore(klines);
  const wickAnom = wickAnomaly(klines);

  // Populate features regardless of what happens next
  Object.assign(features, {
    indicatorStatus: "ok",
    ema20: Number.isFinite(e20) ? +e20.toFixed(6) : null,
    ema50: Number.isFinite(e50) ? +e50.toFixed(6) : null,
    ema200: Number.isFinite(e200) ? +e200.toFixed(6) : null,
    rsi: Number.isFinite(r) ? +r.toFixed(2) : null,
    macdHist: Number.isFinite(macdHist) ? +macdHist.toFixed(6) : null,
    macdLine: Number.isFinite(macdLine) ? +macdLine.toFixed(6) : null,
    atr: Number.isFinite(a14) ? +a14.toFixed(6) : null,
    trendScore,
    volScore,
    volConf,
    wickAnom,
    spread: +ticker.spread.toFixed(6),
    atrPctOfClose: Number.isFinite(a14) && last > 0 ? +((a14 / last) * 100).toFixed(4) : null,
  });

  // ── Spread filter ──
  if (ticker.spread > MAX_SPREAD_FRACTION) {
    return earlyExit("NO_TRADE", `Spread çok yüksek (${(ticker.spread * 100).toFixed(3)}%) — max ${(MAX_SPREAD_FRACTION * 100).toFixed(1)}bps`);
  }

  // ── Volume / liquidity sanity ──
  const minQuoteVol = 5_000_000;
  if (ticker.quoteVolume24h > 0 && ticker.quoteVolume24h < minQuoteVol) {
    return earlyExit("NO_TRADE", `24s hacim düşük ($${(ticker.quoteVolume24h / 1_000_000).toFixed(1)}M < $5M) — likidite yetersiz`);
  }

  // ── Volatility gate — only blocks truly dead markets ──
  if (volScore < MIN_VOL_SCORE_FOR_TRADE) {
    const pct = features.atrPctOfClose ?? 0;
    return earlyExit("NO_TRADE", `Piyasa ölü (ATR/close=${pct}%) — işlem açılamaz`);
  }

  const reasons: string[] = [];
  if (wickAnom) reasons.push("Son mumda anormal iğne (uyarı)");

  // ── BTC trend reference ──
  let btcUp: boolean | null = null;
  if (btcKlines && btcKlines.length >= 60) {
    const bc = btcKlines.map((k) => k.close);
    const be20 = ema(bc, 20).at(-1) ?? NaN;
    const be50 = ema(bc, 50).at(-1) ?? NaN;
    if (Number.isFinite(be20) && Number.isFinite(be50)) {
      btcUp = be20 >= be50;
      reasons.push(`BTC trend ${btcUp ? "pozitif" : "negatif"} (EMA20 vs EMA50)`);
      features.btcUp = btcUp;
    }
  }

  // ── Direction determination ──
  const rsiOk = Number.isFinite(r);
  const longBias =
    last > e50 && e20 > e50 &&
    Number.isFinite(macdHist) && macdHist > 0 &&
    rsiOk && r >= 35 && r <= 70;
  const shortBias =
    last < e50 && e20 < e50 &&
    Number.isFinite(macdHist) && macdHist < 0 &&
    rsiOk && r <= 65 && r >= 30;

  if (!longBias && !shortBias) {
    const why = buildNoDirectionReason(last, e20, e50, macdHist, r, rsiOk);
    return { ...earlyExit("WAIT", `Trend/momentum belirsiz — ${why}`), signalType: "WAIT" };
  }

  const direction: "LONG" | "SHORT" = longBias ? "LONG" : "SHORT";

  // ── BTC alignment veto ──
  if (btcUp !== null) {
    if (direction === "LONG" && !btcUp)
      return earlyExit("NO_TRADE", "BTC trend negatif — LONG sinyali reddedildi");
    if (direction === "SHORT" && btcUp)
      return earlyExit("NO_TRADE", "BTC trend pozitif — SHORT sinyali reddedildi");
  }

  // ── Stop-loss & take-profit (ATR + swing based) ──
  if (!Number.isFinite(a14) || a14 <= 0) {
    return earlyExit("NO_TRADE", "ATR hesaplanamadı — stop mesafesi belirlenemiyor");
  }

  const atrMult = 1.5;
  let stop: number, take: number;

  if (direction === "LONG") {
    const swingStop = swing.swingLow;
    const atrStop = last - a14 * atrMult;
    stop = Math.min(swingStop, atrStop);
    if (stop >= last) stop = last - a14 * atrMult;
    const dist = last - stop;
    take = last + dist * 2.2;
  } else {
    const swingStop = swing.swingHigh;
    const atrStop = last + a14 * atrMult;
    stop = Math.max(swingStop, atrStop);
    if (stop <= last) stop = last + a14 * atrMult;
    const dist = stop - last;
    take = last - dist * 2.2;
  }

  const stopDistPct = Math.abs((last - stop) / last) * 100;

  if (stopDistPct < 0.1) {
    return earlyExit("NO_TRADE", `Stop mesafesi çok dar (${stopDistPct.toFixed(3)}%) — gürültüde tetiklenir`);
  }
  if (stopDistPct > 8) {
    return earlyExit("NO_TRADE", `Stop mesafesi çok geniş (${stopDistPct.toFixed(2)}%) — pozisyon küçük kalır`);
  }

  const rr = direction === "LONG"
    ? (take - last) / (last - stop)
    : (last - take) / (stop - last);

  if (rr < 2) {
    return earlyExit("NO_TRADE", `Risk/ödül yetersiz (1:${rr.toFixed(2)} < 1:2)`);
  }

  // ── Funding rate guard ──
  if (funding) {
    const fr = funding.rate;
    features.fundingRate = fr;
    if (direction === "LONG" && fr > 0.0008) reasons.push("Funding pozitif — LONG için maliyetli");
    if (direction === "SHORT" && fr < -0.0008) reasons.push("Funding negatif — SHORT için maliyetli");
    if (Math.abs(fr) > 0.003) {
      return earlyExit("NO_TRADE", `Funding rate aşırı (${(fr * 100).toFixed(4)}%) — işlem açılmaz`);
    }
  }

  // ── Signal score composition ──
  let score = 0;
  score += trendScore * 0.35;
  score += volConf * 0.25;
  score += volScore * 0.15;
  score += Math.min(25, Math.max(0, (rr - 2) * 8));
  if (direction === "LONG" && e50 > e200) score += 5;
  if (direction === "SHORT" && e50 < e200) score += 5;
  if (wickAnom) score -= 8;
  score = Math.max(0, Math.min(100, Math.round(score)));

  features.signalScore = score;
  features.stopDistPct = +stopDistPct.toFixed(3);
  features.rr = +rr.toFixed(2);

  reasons.push(`${direction}: EMA${e20 > e50 ? "20>50" : "20<50"}${e50 > e200 ? ">200" : "<200"}`);
  reasons.push(`RSI=${Number.isFinite(r) ? r.toFixed(1) : "N/A"}`);
  reasons.push(`MACD hist=${Number.isFinite(macdHist) ? macdHist.toFixed(5) : "N/A"}`);
  reasons.push(`ATR=${a14.toFixed(4)} (${stopDistPct.toFixed(2)}% stop), R:R=1:${rr.toFixed(2)}`);
  reasons.push(`Scores: trend=${trendScore} vol=${volScore} volConf=${volConf}`);

  if (score < 70) {
    return {
      symbol, timeframe, signalType: "NO_TRADE", score,
      entryPrice: last, stopLoss: stop, takeProfit: take, riskRewardRatio: rr,
      reasons,
      rejectedReason: `Sinyal skoru düşük (${score}/100 < 70)`,
      features: { ...features },
    };
  }

  return {
    symbol, timeframe, signalType: direction, score,
    entryPrice: last, stopLoss: stop, takeProfit: take, riskRewardRatio: rr,
    reasons, features: { ...features },
  };
}

function buildNoDirectionReason(
  last: number, e20: number, e50: number,
  macdHist: number, r: number, rsiOk: boolean,
): string {
  const parts: string[] = [];
  if (last > e50 && last < e20) parts.push("fiyat EMA20-50 arası");
  else if (last > e50) parts.push("fiyat EMA50 üstü");
  else parts.push("fiyat EMA50 altı");
  if (Number.isFinite(macdHist)) {
    if (macdHist > 0) parts.push("MACD pozitif");
    else parts.push("MACD negatif");
  }
  if (rsiOk) {
    if (r > 70) parts.push(`RSI aşırı alım (${r.toFixed(0)})`);
    else if (r < 30) parts.push(`RSI aşırı satım (${r.toFixed(0)})`);
    else parts.push(`RSI=${r.toFixed(0)}`);
  }
  return parts.join(", ") || "yeterli koşul yok";
}
