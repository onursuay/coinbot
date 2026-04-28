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
    if (!Number.isFinite(v)) { out.push(NaN); continue; }
    if (i < period - 1) { out.push(NaN); continue; }
    if (i === period - 1) {
      let s = 0;
      let valid = true;
      for (let j = 0; j < period; j++) {
        if (!Number.isFinite(values[j])) { valid = false; break; }
        s += values[j];
      }
      if (!valid) { out.push(NaN); continue; }
      prev = s / period;
      out.push(prev);
      continue;
    }
    if (!Number.isFinite(prev)) { out.push(NaN); continue; }
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
  const macdLine = values.map((_, i) =>
    Number.isFinite(ef[i]) && Number.isFinite(es[i]) ? ef[i] - es[i] : NaN,
  );
  const valid = macdLine.map((v) => (Number.isFinite(v) ? v : 0));
  const signal = ema(valid, signalP).map((v, i) => (Number.isFinite(macdLine[i]) ? v : NaN));
  const hist = macdLine.map((v, i) =>
    Number.isFinite(v) && Number.isFinite(signal[i]) ? v - signal[i] : NaN,
  );
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
    const k = klines[i];
    if (!Number.isFinite(k.high) || !Number.isFinite(k.low) || !Number.isFinite(k.close)) {
      trs.push(NaN);
      continue;
    }
    if (i === 0) { trs.push(k.high - k.low); continue; }
    const prev = klines[i - 1].close;
    if (!Number.isFinite(prev)) { trs.push(k.high - k.low); continue; }
    trs.push(Math.max(k.high - k.low, Math.abs(k.high - prev), Math.abs(k.low - prev)));
  }
  const out: number[] = new Array(klines.length).fill(NaN);
  if (trs.length < period) return out;
  let s = 0, validCount = 0;
  for (let i = 0; i < period; i++) {
    if (Number.isFinite(trs[i])) { s += trs[i]; validCount++; }
  }
  if (validCount < period) return out;
  out[period - 1] = s / period;
  for (let i = period; i < trs.length; i++) {
    if (!Number.isFinite(out[i - 1]) || !Number.isFinite(trs[i])) continue;
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

export function recentSwing(klines: Kline[], lookback = 30): { swingHigh: number; swingLow: number } {
  const slice = klines.slice(-Math.max(5, lookback));
  let high = -Infinity, low = Infinity;
  for (const k of slice) {
    if (Number.isFinite(k.high) && k.high > high) high = k.high;
    if (Number.isFinite(k.low) && k.low < low) low = k.low;
  }
  return { swingHigh: high, swingLow: low };
}

export function wickAnomaly(klines: Kline[]): boolean {
  if (klines.length < 5) return false;
  const last = klines[klines.length - 1];
  if (!Number.isFinite(last.high) || !Number.isFinite(last.low)) return false;
  const body = Math.abs(last.close - last.open);
  const upperWick = last.high - Math.max(last.open, last.close);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  if (body <= 0) return upperWick + lowerWick > 0;
  return upperWick > 2 * body || lowerWick > 2 * body;
}

export function trendStrengthScore(closes: number[]): number {
  if (closes.length < 200) return 0;
  const e20 = ema(closes, 20).at(-1) ?? NaN;
  const e50 = ema(closes, 50).at(-1) ?? NaN;
  const e200 = ema(closes, 200).at(-1) ?? NaN;
  const last = closes.at(-1) ?? NaN;
  if (![e20, e50, e200, last].every(Number.isFinite)) return 0;
  let score = 50;
  if (last > e20) score += 8; else score -= 8;
  if (e20 > e50) score += 12; else score -= 12;
  if (e50 > e200) score += 15; else score -= 15;
  const e20s = ema(closes, 20);
  const v1 = e20s.at(-1)!;
  const v6 = e20s.at(-6)!;
  if (Number.isFinite(v1) && Number.isFinite(v6) && Math.abs(v6) > 1e-9) {
    const slope = (v1 - v6) / Math.abs(v6);
    score += Math.max(-15, Math.min(15, slope * 1000));
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

// Adjusted for 5m–15m timeframes: major coins have ATR/close ~0.1–0.4% on 5m.
export function volatilityScore(klines: Kline[]): number {
  const a = atr(klines, 14).at(-1) ?? NaN;
  const last = klines.at(-1)?.close ?? NaN;
  if (!Number.isFinite(a) || !Number.isFinite(last) || last === 0) return 0;
  const pct = (a / last) * 100;
  if (pct < 0.03) return 5;   // dead market
  if (pct < 0.08) return 30;  // very low — scalp edge-case
  if (pct < 0.5)  return 70;  // normal for 5m/15m on majors
  if (pct < 2.0)  return 90;  // sweet spot for 1h/4h or volatile 5m
  if (pct < 4.0)  return 60;  // elevated, still tradeable
  if (pct < 7.0)  return 30;  // high risk
  return 10;                   // too volatile
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

// ADX — Average Directional Index (Wilder's smoothing, period typically 14).
// Returns array of ADX values indexed same as input klines.
// First valid ADX at index ~(2*period - 1). Returns NaN before that.
export function adx(klines: Kline[], period = 14): number[] {
  const n = klines.length;
  const out: number[] = new Array(n).fill(NaN);
  if (n < period * 2) return out;

  // True range and directional movements for each bar
  const trs: number[] = new Array(n).fill(0);
  const plusDMs: number[] = new Array(n).fill(0);
  const minusDMs: number[] = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const k = klines[i];
    const p = klines[i - 1];
    if (!Number.isFinite(k.high) || !Number.isFinite(k.low) || !Number.isFinite(p.close)) continue;
    trs[i] = Math.max(k.high - k.low, Math.abs(k.high - p.close), Math.abs(k.low - p.close));
    const upMove = Number.isFinite(p.high) ? k.high - p.high : 0;
    const downMove = Number.isFinite(p.low) ? p.low - k.low : 0;
    if (upMove > downMove && upMove > 0) plusDMs[i] = upMove;
    if (downMove > upMove && downMove > 0) minusDMs[i] = downMove;
  }

  // Wilder initial sums (bars 1..period)
  let smTR = trs.slice(1, period + 1).reduce((a, b) => a + b, 0);
  let smPlus = plusDMs.slice(1, period + 1).reduce((a, b) => a + b, 0);
  let smMinus = minusDMs.slice(1, period + 1).reduce((a, b) => a + b, 0);

  const dxArr: number[] = new Array(n).fill(NaN);
  const dx = (smP: number, smM: number, smT: number): number => {
    if (smT <= 0) return NaN;
    const pDI = 100 * smP / smT;
    const mDI = 100 * smM / smT;
    const s = pDI + mDI;
    return s <= 0 ? 0 : 100 * Math.abs(pDI - mDI) / s;
  };
  dxArr[period] = dx(smPlus, smMinus, smTR);

  for (let i = period + 1; i < n; i++) {
    smTR = smTR - smTR / period + trs[i];
    smPlus = smPlus - smPlus / period + plusDMs[i];
    smMinus = smMinus - smMinus / period + minusDMs[i];
    dxArr[i] = dx(smPlus, smMinus, smTR);
  }

  // ADX = Wilder average of DX over `period`; first valid at index (2*period - 1)
  const initDX = dxArr.slice(period, period * 2).filter(Number.isFinite);
  if (initDX.length < period) return out;
  let adxVal = initDX.reduce((a, b) => a + b, 0) / initDX.length;
  out[period * 2 - 1] = adxVal;

  for (let i = period * 2; i < n; i++) {
    if (!Number.isFinite(dxArr[i])) continue;
    adxVal = (adxVal * (period - 1) + dxArr[i]) / period;
    out[i] = adxVal;
  }
  return out;
}

// ATR percentile — what percentile is the current ATR among the last `lookback` ATR values.
// Returns 0-100; NaN when insufficient data. Requires period+5 candles minimum.
export function atrPercentile(klines: Kline[], period = 14, lookback = 50): number[] {
  const atrArr = atr(klines, period);
  const out: number[] = new Array(klines.length).fill(NaN);
  for (let i = period; i < klines.length; i++) {
    const curr = atrArr[i];
    if (!Number.isFinite(curr)) continue;
    const start = Math.max(period - 1, i - lookback + 1);
    const window = atrArr.slice(start, i + 1).filter(Number.isFinite);
    if (window.length < 3) continue;
    const rank = window.filter((v) => v <= curr).length;
    out[i] = Math.round((rank / window.length) * 100);
  }
  return out;
}

// Extended Bollinger — adds normalised width and %B position to the standard bands.
// width = (upper - lower) / middle (bandwidth normalised to price level)
// position = (close - lower) / (upper - lower), i.e. %B (0-1 range, can exceed)
export function bollingerBands(values: number[], period = 20, mult = 2): {
  upper: number[];
  middle: number[];
  lower: number[];
  width: number[];
  position: number[];
} {
  const { middle, upper, lower } = bollinger(values, period, mult);
  const n = values.length;
  const width: number[] = new Array(n).fill(NaN);
  const position: number[] = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const m = middle[i], u = upper[i], l = lower[i];
    if (Number.isFinite(m) && m > 0 && Number.isFinite(u) && Number.isFinite(l)) {
      width[i] = (u - l) / m;
    }
    if (Number.isFinite(u) && Number.isFinite(l) && u > l) {
      position[i] = (values[i] - l) / (u - l);
    }
  }
  return { upper, middle, lower, width, position };
}
