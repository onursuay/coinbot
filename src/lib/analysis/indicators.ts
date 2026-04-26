// Lightweight pure-TS technical indicators. Server-side or client-side safe.
// All inputs are oldest-first arrays (kline order).

import type { Kline } from "@/lib/exchanges/types";

export function sma(values: number[], period: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : NaN);
  }
  return out;
}

export function ema(values: number[], period: number): number[] {
  const out: number[] = [];
  const k = 2 / (period + 1);
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (i < period - 1) { out.push(NaN); continue; }
    if (i === period - 1) {
      let s = 0; for (let j = 0; j < period; j++) s += values[j];
      prev = s / period;
      out.push(prev);
      continue;
    }
    prev = v * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function rsi(values: number[], period = 14): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = values[i] - values[i - 1];
    if (ch >= 0) gain += ch; else loss -= ch;
  }
  let avgG = gain / period, avgL = loss / period;
  out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = period + 1; i < values.length; i++) {
    const ch = values[i] - values[i - 1];
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

export function macd(values: number[], fast = 12, slow = 26, signalP = 9) {
  const ef = ema(values, fast);
  const es = ema(values, slow);
  const macdLine = values.map((_, i) => (Number.isFinite(ef[i]) && Number.isFinite(es[i]) ? ef[i] - es[i] : NaN));
  const valid = macdLine.map((v) => (Number.isFinite(v) ? v : 0));
  const signal = ema(valid, signalP).map((v, i) => (Number.isFinite(macdLine[i]) ? v : NaN));
  const hist = macdLine.map((v, i) => (Number.isFinite(v) && Number.isFinite(signal[i]) ? v - signal[i] : NaN));
  return { macd: macdLine, signal, hist };
}

export function bollinger(values: number[], period = 20, mult = 2) {
  const m = sma(values, period);
  const upper: number[] = [], lower: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { upper.push(NaN); lower.push(NaN); continue; }
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += (values[j] - m[i]) ** 2;
    const sd = Math.sqrt(s / period);
    upper.push(m[i] + mult * sd);
    lower.push(m[i] - mult * sd);
  }
  return { middle: m, upper, lower };
}

export function atr(klines: Kline[], period = 14): number[] {
  const trs: number[] = [];
  for (let i = 0; i < klines.length; i++) {
    if (i === 0) { trs.push(klines[i].high - klines[i].low); continue; }
    const prev = klines[i - 1].close;
    const tr = Math.max(klines[i].high - klines[i].low, Math.abs(klines[i].high - prev), Math.abs(klines[i].low - prev));
    trs.push(tr);
  }
  // Wilder smoothing
  const out: number[] = new Array(klines.length).fill(NaN);
  if (trs.length < period) return out;
  let s = 0; for (let i = 0; i < period; i++) s += trs[i];
  out[period - 1] = s / period;
  for (let i = period; i < trs.length; i++) {
    out[i] = (out[i - 1] * (period - 1) + trs[i]) / period;
  }
  return out;
}

export function vwap(klines: Kline[]): number[] {
  let pv = 0, vol = 0;
  return klines.map((k) => {
    const tp = (k.high + k.low + k.close) / 3;
    pv += tp * k.volume;
    vol += k.volume;
    return vol > 0 ? pv / vol : NaN;
  });
}

export function volumeMA(klines: Kline[], period = 20): number[] {
  return sma(klines.map((k) => k.volume), period);
}

// Find recent swing high/low using fractal-like rule.
export function recentSwing(klines: Kline[], lookback = 30): { swingHigh: number; swingLow: number } {
  const slice = klines.slice(-Math.max(5, lookback));
  let high = -Infinity, low = Infinity;
  for (const k of slice) { if (k.high > high) high = k.high; if (k.low < low) low = k.low; }
  return { swingHigh: high, swingLow: low };
}

// Wick anomaly: latest candle wick > 2x body relative to prior median.
export function wickAnomaly(klines: Kline[]): boolean {
  if (klines.length < 5) return false;
  const last = klines[klines.length - 1];
  const body = Math.abs(last.close - last.open);
  const upperWick = last.high - Math.max(last.open, last.close);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  if (body <= 0) return upperWick + lowerWick > 0;
  return upperWick > 2 * body || lowerWick > 2 * body;
}

// Trend strength score 0-100 from EMA stack and slope.
export function trendStrengthScore(closes: number[]): number {
  const e20 = ema(closes, 20).at(-1) ?? NaN;
  const e50 = ema(closes, 50).at(-1) ?? NaN;
  const e200 = ema(closes, 200).at(-1) ?? NaN;
  const last = closes.at(-1) ?? NaN;
  if (![e20, e50, e200, last].every(Number.isFinite)) return 0;
  let score = 50;
  if (last > e20) score += 8; else score -= 8;
  if (e20 > e50) score += 12; else score -= 12;
  if (e50 > e200) score += 15; else score -= 15;
  // slope of EMA20 over last 5
  const e20s = ema(closes, 20);
  const slope = (e20s.at(-1)! - e20s.at(-6)!) / Math.max(1e-9, Math.abs(e20s.at(-6)!));
  score += Math.max(-15, Math.min(15, slope * 1000));
  return Math.max(0, Math.min(100, score));
}

export function volatilityScore(klines: Kline[]): number {
  const a = atr(klines).at(-1) ?? NaN;
  const last = klines.at(-1)?.close ?? NaN;
  if (!Number.isFinite(a) || !Number.isFinite(last) || last === 0) return 0;
  const pct = (a / last) * 100;
  // sweet spot 0.5%–2.5% per candle for selected timeframes.
  if (pct < 0.2) return 20;
  if (pct < 0.5) return 50;
  if (pct < 1.5) return 90;
  if (pct < 2.5) return 75;
  if (pct < 4) return 45;
  return 15;
}

export function volumeConfirmationScore(klines: Kline[]): number {
  const vMa = volumeMA(klines, 20).at(-1) ?? NaN;
  const v = klines.at(-1)?.volume ?? NaN;
  if (!Number.isFinite(vMa) || !Number.isFinite(v) || vMa === 0) return 0;
  const ratio = v / vMa;
  if (ratio >= 1.5) return 95;
  if (ratio >= 1.1) return 75;
  if (ratio >= 0.8) return 55;
  if (ratio >= 0.5) return 35;
  return 15;
}
