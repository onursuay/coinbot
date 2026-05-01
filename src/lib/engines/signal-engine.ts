// Futures-first signal engine. Multi-filter; never relies on a single indicator.
// Outputs: LONG | SHORT | WAIT | EXIT_LONG | EXIT_SHORT | NO_TRADE with score 0-100 and reasons.
//
// Key design: ALL features are computed upfront and included in every return path,
// including early exits, so scanner always has meaningful scores.

import type { Kline, Ticker, FundingRate, Timeframe } from "@/lib/exchanges/types";
import {
  atr, ema, sma, macd, rsi, recentSwing, trendStrengthScore, trendStrengthScoreForDirection,
  volatilityScore, volumeConfirmationScore, wickAnomaly,
  adx, atrPercentile, bollingerBands, vwap, volumeMA,
} from "@/lib/analysis/indicators";
import {
  computeDirectionExplainability,
} from "@/lib/direction-explainability";
import type {
  DirectionCandidate as DirectionCandidateType,
  DirectionExplainability,
  WaitReasonCode as WaitReasonCodeType,
} from "@/lib/direction-explainability";

export type SignalType = "LONG" | "SHORT" | "WAIT" | "EXIT_LONG" | "EXIT_SHORT" | "NO_TRADE";

// Direction explainability — observation-only, never gates trade opening.
// Faz 12: kanonik tipler src/lib/direction-explainability altına taşındı.
export type DirectionCandidate = DirectionCandidateType;
export type WaitReasonCode = WaitReasonCodeType;

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
  score: number;              // trade confidence — 0 for WAIT / early-exit NO_TRADE (= tradeSignalScore)
  setupScore: number;         // opportunity quality (10-component), >0 whenever indicators computed
  marketQualityScore: number; // coin tradability quality (volume/spread/ATR/funding/data)
  // Direction explainability — informational only, NEVER used as a trade-open gate.
  // signalType / score remain the only fields that decide whether a trade is opened.
  longSetupScore: number;          // 0-100 bull-side hypothesis strength
  shortSetupScore: number;         // 0-100 bear-side hypothesis strength
  directionCandidate: DirectionCandidate;
  directionConfidence: number;     // 0-100 normalised lead margin between long/short setups
  waitReasonCodes: WaitReasonCode[];
  /** Faz 12 — en fazla 2–3 ana sebebi içeren kısa Türkçe özet (display only). */
  waitReasonSummary: string;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskRewardRatio: number | null;
  reasons: string[];
  rejectedReason?: string;
  // Populated when score is 50-69: the direction that almost qualified.
  // Allows orchestrator to log near-miss signals without opening a trade.
  nearMissDirection?: "LONG" | "SHORT";
  // Always populated — scanner depends on these even for NO_TRADE returns.
  features: Record<string, number | string | boolean | null | string[]>;
}

const MAX_SPREAD_FRACTION = 0.0015; // 15 bps cap
// Only block on truly dead markets (vol < 5). Normal 5m candles easily clear this.
const MIN_VOL_SCORE_FOR_TRADE = 15;

export function generateSignal(ctx: SignalContext): SignalResult {
  const { symbol, timeframe, klines, ticker, funding, btcKlines } = ctx;

  // ── Baseline features — populated incrementally, returned in every path ──
  const features: Record<string, number | string | boolean | null | string[]> = {
    candleCount: klines.length,
    lastCandleTime: klines.at(-1)?.closeTime ?? null,
    indicatorStatus: "pending",
  };

  const earlyExit = (kind: SignalType, reason: string): SignalResult => ({
    symbol, timeframe, signalType: kind, score: 0,
    // setupScore/marketQualityScore: populated after indicators are computed.
    // For pre-indicator exits (insufficient candles, EMA fail) these are 0.
    setupScore: typeof features.setupScore === "number" ? (features.setupScore as number) : 0,
    marketQualityScore: typeof features.marketQualityScore === "number" ? (features.marketQualityScore as number) : 0,
    longSetupScore: typeof features.longSetupScore === "number" ? (features.longSetupScore as number) : 0,
    shortSetupScore: typeof features.shortSetupScore === "number" ? (features.shortSetupScore as number) : 0,
    directionCandidate: (typeof features.directionCandidate === "string"
      ? features.directionCandidate as DirectionCandidate
      : "NONE"),
    directionConfidence: typeof features.directionConfidence === "number" ? (features.directionConfidence as number) : 0,
    waitReasonCodes: Array.isArray((features as any).waitReasonCodes) ? ((features as any).waitReasonCodes as WaitReasonCode[]) : [],
    waitReasonSummary: typeof features.waitReasonSummary === "string" ? (features.waitReasonSummary as string) : "",
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

  // ── New indicators ──
  // MA8 / MA55 (simple moving average for short/mid trend alignment)
  const ma8Arr = sma(closes, 8);
  const ma55Arr = sma(closes, 55);
  const ma8Val = ma8Arr.at(-1) ?? NaN;
  const ma55Val = ma55Arr.at(-1) ?? NaN;
  const ma8Prev = ma8Arr.at(-6) ?? NaN;
  const ma55Prev = ma55Arr.at(-6) ?? NaN;
  const ma8Slope = Number.isFinite(ma8Val) && Number.isFinite(ma8Prev) && Math.abs(ma8Prev) > 1e-9
    ? (ma8Val - ma8Prev) / Math.abs(ma8Prev) : NaN;
  const ma55Slope = Number.isFinite(ma55Val) && Number.isFinite(ma55Prev) && Math.abs(ma55Prev) > 1e-9
    ? (ma55Val - ma55Prev) / Math.abs(ma55Prev) : NaN;
  const ma8AboveMa55 = Number.isFinite(ma8Val) && Number.isFinite(ma55Val) ? ma8Val > ma55Val : null;
  const priceAboveMa8 = Number.isFinite(ma8Val) ? last > ma8Val : null;
  const priceAboveMa55 = Number.isFinite(ma55Val) ? last > ma55Val : null;

  // Bollinger Bands (extended: width + position)
  const bb = bollingerBands(closes, 20, 2);
  const bbUpper = bb.upper.at(-1) ?? NaN;
  const bbMiddle = bb.middle.at(-1) ?? NaN;
  const bbLower = bb.lower.at(-1) ?? NaN;
  const bbWidth = bb.width.at(-1) ?? NaN;
  const bbPosition = bb.position.at(-1) ?? NaN; // %B: <0 below lower, >1 above upper
  const recentWidths = bb.width.slice(-20).filter(Number.isFinite);
  const avgBbWidth = recentWidths.length > 0 ? recentWidths.reduce((a, b) => a + b, 0) / recentWidths.length : NaN;
  const bbSqueeze = Number.isFinite(bbWidth) && Number.isFinite(avgBbWidth) ? bbWidth < avgBbWidth * 0.8 : false;
  const bbExpansion = Number.isFinite(bbWidth) && Number.isFinite(avgBbWidth) ? bbWidth > avgBbWidth * 1.2 : false;
  const bbBreakoutUp = Number.isFinite(bbUpper) ? last > bbUpper : false;
  const bbBreakoutDown = Number.isFinite(bbLower) ? last < bbLower : false;

  // ADX — trend strength
  const adxArr = adx(klines, 14);
  const adxVal = adxArr.at(-1) ?? NaN;
  const adxTrendStrength = Number.isFinite(adxVal)
    ? adxVal >= 30 ? "strong" : adxVal >= 20 ? "emerging" : "flat"
    : "unknown";

  // VWAP — session fair value reference
  const vwapArr = vwap(klines);
  const vwapVal = vwapArr.at(-1) ?? NaN;
  const priceAboveVwap = Number.isFinite(vwapVal) ? last > vwapVal : null;

  // Volume MA20 and Volume Impulse (ratio of last volume to MA20)
  const vma20Arr = volumeMA(klines, 20);
  const vma20 = vma20Arr.at(-1) ?? NaN;
  const lastVol = klines.at(-1)?.volume ?? NaN;
  const volumeImpulse = Number.isFinite(vma20) && vma20 > 0 ? lastVol / vma20 : NaN;

  // ATR Percentile — relative volatility (0 = lowest recent ATR, 100 = highest)
  const atrPctArr = atrPercentile(klines, 14, 50);
  const atrPctileVal = atrPctArr.at(-1) ?? NaN;

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
    // MA8 / MA55
    ma8: Number.isFinite(ma8Val) ? +ma8Val.toFixed(6) : null,
    ma55: Number.isFinite(ma55Val) ? +ma55Val.toFixed(6) : null,
    ma8Slope: Number.isFinite(ma8Slope) ? +ma8Slope.toFixed(6) : null,
    ma55Slope: Number.isFinite(ma55Slope) ? +ma55Slope.toFixed(6) : null,
    ma8AboveMa55,
    priceAboveMa8,
    priceAboveMa55,
    // Bollinger
    bollingerUpper: Number.isFinite(bbUpper) ? +bbUpper.toFixed(6) : null,
    bollingerMiddle: Number.isFinite(bbMiddle) ? +bbMiddle.toFixed(6) : null,
    bollingerLower: Number.isFinite(bbLower) ? +bbLower.toFixed(6) : null,
    bollingerWidth: Number.isFinite(bbWidth) ? +bbWidth.toFixed(6) : null,
    bollingerPosition: Number.isFinite(bbPosition) ? +bbPosition.toFixed(4) : null,
    bollingerSqueeze: bbSqueeze,
    bollingerExpansion: bbExpansion,
    bollingerBreakoutUp: bbBreakoutUp,
    bollingerBreakoutDown: bbBreakoutDown,
    // ADX
    adx: Number.isFinite(adxVal) ? +adxVal.toFixed(2) : null,
    adxTrendStrength,
    // VWAP
    vwap: Number.isFinite(vwapVal) ? +vwapVal.toFixed(6) : null,
    priceAboveVwap,
    // Volume
    volumeMa20: Number.isFinite(vma20) ? +vma20.toFixed(2) : null,
    volumeImpulse: Number.isFinite(volumeImpulse) ? +volumeImpulse.toFixed(4) : null,
    // ATR Percentile
    atrPercentile: Number.isFinite(atrPctileVal) ? atrPctileVal : null,
  });

  // ── setupScore: 10-component opportunity quality score (0-100) ──
  // Computed here so all downstream earlyExit calls carry it via { ...features }.
  // Direction-agnostic: measures setup quality regardless of LONG/SHORT/WAIT.
  // Weights sum to 100; each component is independently scored.
  let ss = 0;

  // 1. EMA20/EMA50/EMA200 trend alignment (12pts)
  {
    const emaBullish = e20 > e50 && e50 > e200;
    const emaBearish = e20 < e50 && e50 < e200;
    const emaPartial = (e20 > e50) !== (e50 > e200); // one cross but not both
    if (emaBullish || emaBearish) ss += 12;
    else if (emaPartial) ss += 6;
    else ss += 3;
  }

  // 2. MA8/MA55 short/mid trend alignment (12pts)
  if (Number.isFinite(ma8Val) && Number.isFinite(ma55Val)) {
    const maDiff = Math.abs(ma8Val - ma55Val) / (Math.abs(ma55Val) || 1);
    const maAlignBull = ma8Val > ma55Val && last > ma8Val;
    const maAlignBear = ma8Val < ma55Val && last < ma8Val;
    if ((maAlignBull || maAlignBear) && maDiff > 0.003) ss += 12;
    else if (maAlignBull || maAlignBear) ss += 8;
    else ss += 4;
  } else {
    ss += 4; // no data, partial credit
  }

  // 3. MACD histogram strength (12pts)
  if (Number.isFinite(macdHist) && last > 0) {
    const histPct = Math.abs(macdHist) / last * 100;
    if (histPct > 0.02) ss += 12;
    else if (histPct > 0.005) ss += 8;
    else if (histPct > 0) ss += 5;
    // 0 = no contribution
  }

  // 4. RSI healthy zone (8pts) — rewards tradeable non-extreme RSI
  if (Number.isFinite(r)) {
    if (r >= 40 && r <= 60) ss += 8;        // neutral ready zone
    else if (r >= 35 && r <= 70) ss += 6;   // tradeable range
    else if (r >= 25 && r <= 80) ss += 3;
    // extreme overbought/oversold = 0
  }

  // 5. Bollinger Band behaviour (12pts)
  if (Number.isFinite(bbWidth) && Number.isFinite(bbPosition)) {
    const volImpOk = Number.isFinite(volumeImpulse) && volumeImpulse >= 1.3;
    if ((bbBreakoutUp || bbBreakoutDown) && volImpOk) ss += 12; // breakout + volume = real move
    else if (bbBreakoutUp || bbBreakoutDown) ss += 6;           // breakout without volume confirmation
    else if (bbSqueeze && volImpOk) ss += 10;                   // squeeze + rising volume = setup
    else if (bbSqueeze) ss += 8;                                // squeeze = potential
    else if (bbExpansion && volImpOk) ss += 6;                  // expansion + volume
    else ss += 4;                                               // normal
  } else {
    ss += 4;
  }

  // 6. ADX trend strength (10pts)
  if (Number.isFinite(adxVal)) {
    if (adxVal >= 30) ss += 10;
    else if (adxVal >= 20) ss += 7;
    else if (adxVal >= 15) ss += 4;
    else ss += 1; // very flat market
  } else {
    ss += 4; // no data
  }

  // 7. VWAP proximity — fair value setup zone (8pts)
  if (Number.isFinite(vwapVal) && vwapVal > 0) {
    const vwapDiff = Math.abs(last - vwapVal) / vwapVal;
    if (vwapDiff < 0.003) ss += 8;       // very close to VWAP = fair value zone
    else if (vwapDiff < 0.01) ss += 6;
    else if (vwapDiff < 0.03) ss += 4;
    else ss += 2;                         // far from VWAP
  } else {
    ss += 4; // no VWAP data
  }

  // 8. Volume impulse (12pts)
  if (Number.isFinite(volumeImpulse)) {
    if (volumeImpulse >= 2.0) ss += 12;
    else if (volumeImpulse >= 1.5) ss += 9;
    else if (volumeImpulse >= 1.1) ss += 6;
    else if (volumeImpulse >= 0.8) ss += 3;
    // < 0.8 = weak volume = 0
  }

  // 9. EMA20 slope / trend momentum (8pts)
  {
    const v1 = e20Arr.at(-1) ?? NaN;
    const v6 = e20Arr.at(-6) ?? NaN;
    if (Number.isFinite(v1) && Number.isFinite(v6) && Math.abs(v6) > 1e-9) {
      const slopeAbs = Math.abs((v1 - v6) / Math.abs(v6));
      if (slopeAbs > 0.002) ss += 8;
      else if (slopeAbs > 0.0008) ss += 5;
      else ss += 2;
    } else {
      ss += 3;
    }
  }

  // 10. ATR percentile health (6pts) — rewards moderate volatility, penalises extremes
  if (Number.isFinite(atrPctileVal)) {
    if (atrPctileVal >= 20 && atrPctileVal <= 80) ss += 6;   // healthy range
    else if (atrPctileVal >= 10 && atrPctileVal <= 90) ss += 3;
    else ss += 1;                                             // extreme low/high volatility
  } else {
    ss += 3; // no ATR percentile data, neutral
  }

  const setupScore = Math.max(0, Math.min(100, ss));
  features.setupScore = setupScore;

  // ── marketQualityScore: coin tradability quality (0-100) ──
  // Based on available data at signal-engine level: volume, spread, funding, ATR health.
  // Order book depth component is added by the orchestrator which has that data.
  // Weights: volume 25, spread 20, ATR/volatility health 20, funding 15, data quality 10, pump proxy 10
  {
    let mqs = 0;
    // Volume (25pts)
    const vol24h = ticker.quoteVolume24h;
    let mqsVol = 0;
    if (vol24h >= 500_000_000) mqsVol = 25;
    else if (vol24h >= 100_000_000) mqsVol = 20;
    else if (vol24h >= 50_000_000) mqsVol = 15;
    else if (vol24h >= 10_000_000) mqsVol = 10;
    else mqsVol = 4;
    mqs += mqsVol;
    // Spread (20pts)
    const spreadPct = ticker.spread * 100;
    let mqsSpread = 0;
    if (spreadPct < 0.01) mqsSpread = 20;
    else if (spreadPct < 0.05) mqsSpread = 16;
    else if (spreadPct < 0.1) mqsSpread = 10;
    else if (spreadPct < 0.15) mqsSpread = 5;
    // > 0.15% = 0
    mqs += mqsSpread;
    // ATR/volatility health (20pts) — same as volScore proxy
    let mqsAtr = 0;
    if (volScore >= 70) mqsAtr = 20;
    else if (volScore >= 50) mqsAtr = 14;
    else if (volScore >= 30) mqsAtr = 7;
    mqs += mqsAtr;
    // Funding normalcy (15pts)
    let mqsFunding = 0;
    if (funding) {
      const fr = Math.abs(funding.rate * 100);
      if (fr < 0.01) mqsFunding = 15;
      else if (fr < 0.05) mqsFunding = 12;
      else if (fr < 0.1) mqsFunding = 7;
      else if (fr < 0.3) mqsFunding = 2;
    } else {
      mqsFunding = 10; // unknown = neutral
    }
    mqs += mqsFunding;
    // Data quality (10pts) — reached this point = indicators all computed
    const mqsDataQuality = 10;
    mqs += mqsDataQuality;
    // Pump/dump proxy (10pts) — spread low + volatility healthy
    let mqsPumpDump = 0;
    if (spreadPct < 0.05 && volScore >= 30) mqsPumpDump = 10;
    else if (spreadPct < 0.1 && volScore >= 30) mqsPumpDump = 6;
    else mqsPumpDump = 2;
    mqs += mqsPumpDump;

    features.marketQualityScore = Math.max(0, Math.min(85, Math.round(mqs)));
    // Capped at 85: orchestrator can add up to 15pts for order book depth to reach 100
    // Diagnostic sub-component scores — display/logging only, never used in trade logic.
    features.mqsVolumeScore = mqsVol;
    features.mqsSpreadScore = mqsSpread;
    features.mqsAtrScore = mqsAtr;
    features.mqsFundingScore = mqsFunding;
    features.mqsDataQualityScore = mqsDataQuality;
    features.mqsPumpDumpScore = mqsPumpDump;
  }

  // ── BTC trend reference (computed early so directional scoring can include it) ──
  // The reasons[] push is deferred until after the WAIT branch, so existing user-facing
  // text ordering is preserved.
  let btcUp: boolean | null = null;
  if (btcKlines && btcKlines.length >= 60) {
    const bc = btcKlines.map((k) => k.close);
    const be20 = ema(bc, 20).at(-1) ?? NaN;
    const be50 = ema(bc, 50).at(-1) ?? NaN;
    if (Number.isFinite(be20) && Number.isFinite(be50)) {
      btcUp = be20 >= be50;
      features.btcUp = btcUp;
    }
  }

  // ── Direction explainability — long/short setup hypotheses + WAIT reason codes ──
  // Diagnostic-only: these scores describe which side the indicator stack leans towards.
  // They NEVER gate trade opening; the LONG/SHORT bias check below is the real gate.
  // Faz 12 — implementation moved to src/lib/direction-explainability/.
  const dirExp: DirectionExplainability = computeDirectionExplainability({
    last, e20, e50, e200, ma8: ma8Val, ma55: ma55Val,
    macdHist, rsi: r,
    bbBreakoutUp, bbBreakoutDown, bbMiddle, bbPosition,
    adxVal, vwapVal, priceAboveVwap,
    volumeImpulse, atrPctileVal, btcUp,
  });
  features.longSetupScore = dirExp.longSetupScore;
  features.shortSetupScore = dirExp.shortSetupScore;
  features.directionCandidate = dirExp.directionCandidate;
  features.directionConfidence = dirExp.directionConfidence;
  features.waitReasonCodes = dirExp.waitReasonCodes;
  features.waitReasonSummary = dirExp.waitReasonSummary;

  // ── Spread filter ──
  if (ticker.spread > MAX_SPREAD_FRACTION) {
    return earlyExit("NO_TRADE", `Spread çok yüksek (${(ticker.spread * 100).toFixed(3)}%) — max ${(MAX_SPREAD_FRACTION * 100).toFixed(1)}bps`);
  }

  // ── Volume / liquidity sanity ──
  // vol=0 means no data or dead coin — reject it; do NOT use > 0 guard.
  const minQuoteVol = 5_000_000;
  if (ticker.quoteVolume24h < minQuoteVol) {
    return earlyExit("NO_TRADE", `24s hacim düşük ($${(ticker.quoteVolume24h / 1_000_000).toFixed(1)}M < $5M) — likidite yetersiz`);
  }

  // ── Volatility gate — only blocks truly dead markets ──
  if (volScore < MIN_VOL_SCORE_FOR_TRADE) {
    const pct = features.atrPctOfClose ?? 0;
    return earlyExit("NO_TRADE", `Piyasa ölü (ATR/close=${pct}%) — işlem açılamaz`);
  }

  const reasons: string[] = [];
  if (wickAnom) reasons.push("Son mumda anormal iğne (uyarı)");

  // BTC trend reference text is appended once direction/no-direction is known so the
  // ordering matches the previous output (BTC line came right before direction text).
  if (btcUp !== null) {
    reasons.push(`BTC trend ${btcUp ? "pozitif" : "negatif"} (EMA20 vs EMA50)`);
  }

  // ── Direction determination ──
  // Strict AND-gate that has always governed real trade-opening — UNCHANGED.
  // The new long/short setup scores feed scan diagnostics only and never replace this.
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
    const dirText = dirExp.waitReasonSummary || "Yön teyidi bekleniyor";
    return { ...earlyExit("WAIT", `${dirText} — ${why}`), signalType: "WAIT" };
  }

  const direction: "LONG" | "SHORT" = longBias ? "LONG" : "SHORT";

  // Direction firing — no longer "waiting"; keep features in sync with returned object.
  features.waitReasonCodes = [];
  features.waitReasonSummary = "";

  // ── BTC alignment — P0 bugfix: paper-only project, hard veto → soft penalty.
  // Filtre AÇIK kalıyor (CLAUDE.md kuralı) ama trade'i komple bloklamıyor;
  // composite score'dan ceza puanı düşülüyor. Live execution kalıcı kapalı.
  let btcMisaligned = false;
  if (btcUp !== null) {
    btcMisaligned = (direction === "LONG" && !btcUp) || (direction === "SHORT" && btcUp);
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
  // P0 bugfix: trendScore yerine direction-aware trendScoreDir kullanılıyor.
  // Eski trendScore (bullish-leaning) features.trendScore'da diagnostic kalır;
  // composite skor SHORT için bearish alignment'ı LONG için bullish alignment ile
  // matematiksel olarak eşit ödüllendirir.
  const trendScoreDir = trendStrengthScoreForDirection(closes, direction);
  let score = 0;
  score += trendScoreDir * 0.35;
  score += volConf * 0.25;
  score += volScore * 0.15;
  score += Math.min(25, Math.max(0, (rr - 2) * 8));
  if (direction === "LONG" && e50 > e200) score += 5;
  if (direction === "SHORT" && e50 < e200) score += 5;
  if (wickAnom) score -= 8;
  // P0 bugfix: BTC uyumsuzluğu hard veto değil, soft penalty (-12).
  if (btcMisaligned) score -= 12;
  score = Math.max(0, Math.min(100, Math.round(score)));

  features.signalScore = score;
  features.stopDistPct = +stopDistPct.toFixed(3);
  features.rr = +rr.toFixed(2);

  reasons.push(`${direction}: EMA${e20 > e50 ? "20>50" : "20<50"}${e50 > e200 ? ">200" : "<200"}`);
  reasons.push(`RSI=${Number.isFinite(r) ? r.toFixed(1) : "N/A"}`);
  reasons.push(`MACD hist=${Number.isFinite(macdHist) ? macdHist.toFixed(5) : "N/A"}`);
  reasons.push(`ATR=${a14.toFixed(4)} (${stopDistPct.toFixed(2)}% stop), R:R=1:${rr.toFixed(2)}`);
  reasons.push(`Scores: trend=${trendScore} vol=${volScore} volConf=${volConf}`);

  const mqs = typeof features.marketQualityScore === "number" ? (features.marketQualityScore as number) : 0;

  if (score < 70) {
    return {
      symbol, timeframe, signalType: "NO_TRADE", score,
      setupScore,
      marketQualityScore: mqs,
      longSetupScore: dirExp.longSetupScore,
      shortSetupScore: dirExp.shortSetupScore,
      directionCandidate: dirExp.directionCandidate,
      directionConfidence: dirExp.directionConfidence,
      waitReasonCodes: dirExp.waitReasonCodes,
      waitReasonSummary: dirExp.waitReasonSummary,
      entryPrice: last, stopLoss: stop, takeProfit: take, riskRewardRatio: rr,
      reasons,
      rejectedReason: `Sinyal skoru düşük (${score}/100 < 70)`,
      // near-miss: score 50-69 passed all other filters — direction is valid but score too low
      nearMissDirection: score >= 50 ? direction : undefined,
      features: { ...features },
    };
  }

  return {
    symbol, timeframe, signalType: direction, score,
    setupScore,
    marketQualityScore: mqs,
    longSetupScore: dirExp.longSetupScore,
    shortSetupScore: dirExp.shortSetupScore,
    directionCandidate: dirExp.directionCandidate,
    directionConfidence: dirExp.directionConfidence,
    // For a fired LONG/SHORT signal we keep waitReasonCodes empty — there is no "waiting".
    waitReasonCodes: [],
    waitReasonSummary: "",
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
