// Market scanner — 2-phase: pre-filter via universe, deep analysis per batch.
// Accepts pre-fetched tickerMap to avoid per-symbol ticker HTTP calls.
// Concurrency-limited kline fetching with exponential backoff (via http.ts).

import type { ExchangeName, Ticker, Timeframe } from "@/lib/exchanges/types";
import { getAdapter } from "@/lib/exchanges/exchange-factory";
import { generateSignal } from "./signal-engine";

export interface ScanRow {
  symbol: string;
  exchange: ExchangeName;
  marketType: "futures";
  price: number;
  volume24hUsd: number;
  spread: number;
  fundingRate: number | null;
  maxLeverage: number;
  trendScore: number;
  momentumScore: number;
  volumeScore: number;
  volatilityScore: number;
  signal: string;
  signalScore: number;
  classification: "tradeable" | "watchlist" | "high_risk" | "avoid" | "no_trade";
  reason: string;
  candleCount: number;
  lastCandleTime: number | null;
  indicatorStatus: string;
  atrPct: number | null;
  rsi: number | null;
}

export interface ScanStats {
  totalUniverse: number;
  preFiltered: number;
  deepAnalyzed: number;
  signalLong: number;
  signalShort: number;
  signalNoTrade: number;
  signalWait: number;
  nextCursor: string;
}

export interface ScanResult {
  rows: ScanRow[];
  stats: ScanStats;
}

export async function scanMarket(opts: {
  exchange: ExchangeName;
  symbols: string[];
  timeframe?: Timeframe;
  concurrency?: number;
  klineLimit?: number;
  tickerMap?: Record<string, Ticker>;
  totalUniverse?: number;
  preFilteredCount?: number;
  nextCursor?: string;
}): Promise<ScanResult> {
  const tf: Timeframe = opts.timeframe ?? "5m";
  const concurrency = Math.max(1, opts.concurrency ?? 5);
  const klineLimit = Math.max(220, opts.klineLimit ?? 250);
  const adapter = getAdapter(opts.exchange);
  const rows: ScanRow[] = [];

  // BTC reference — best effort
  let btcKlines: any[] = [];
  try { btcKlines = await adapter.getKlines("BTC/USDT", tf, klineLimit); } catch { /* non-fatal */ }

  // Process symbols in concurrent batches
  for (let i = 0; i < opts.symbols.length; i += concurrency) {
    const batch = opts.symbols.slice(i, i + concurrency);
    const results = await Promise.allSettled(batch.map((symbol) =>
      analyzeSymbol({ symbol, exchange: opts.exchange, tf, klineLimit, adapter, btcKlines, preTickerMap: opts.tickerMap })
    ));
    for (const r of results) {
      if (r.status === "fulfilled") rows.push(r.value);
    }
  }

  const stats: ScanStats = {
    totalUniverse: opts.totalUniverse ?? opts.symbols.length,
    preFiltered: opts.preFilteredCount ?? opts.symbols.length,
    deepAnalyzed: rows.filter((r) => r.signal !== "ERROR").length,
    signalLong: rows.filter((r) => r.signal === "LONG").length,
    signalShort: rows.filter((r) => r.signal === "SHORT").length,
    signalNoTrade: rows.filter((r) => r.signal === "NO_TRADE").length,
    signalWait: rows.filter((r) => r.signal === "WAIT").length,
    nextCursor: opts.nextCursor ?? "0",
  };

  // Sort: tradeable first → watchlist → rest; within each group by score desc
  rows.sort((a, b) => {
    const order = { tradeable: 0, watchlist: 1, high_risk: 2, avoid: 3, no_trade: 4 };
    const diff = (order[a.classification] ?? 5) - (order[b.classification] ?? 5);
    return diff !== 0 ? diff : b.signalScore - a.signalScore;
  });

  return { rows, stats };
}

async function analyzeSymbol(p: {
  symbol: string;
  exchange: ExchangeName;
  tf: Timeframe;
  klineLimit: number;
  adapter: any;
  btcKlines: any[];
  preTickerMap?: Record<string, Ticker>;
}): Promise<ScanRow> {
  const { symbol, exchange, tf, klineLimit, adapter, btcKlines, preTickerMap } = p;

  try {
    const preTicker = preTickerMap?.[symbol];

    const [klines, ticker, info, funding] = await Promise.all([
      adapter.getKlines(symbol, tf, klineLimit),
      preTicker ? Promise.resolve(preTicker) : adapter.getTicker(symbol),
      adapter.getExchangeInfo(symbol),
      adapter.getFundingRate(symbol),
    ]);

    const sig = generateSignal({ symbol, timeframe: tf, klines, ticker, funding, btcKlines });
    const f = sig.features;

    const trendScore   = typeof f.trendScore      === "number" ? f.trendScore      : 0;
    const volConf      = typeof f.volConf          === "number" ? f.volConf         : 0;
    const macdHist     = typeof f.macdHist         === "number" ? f.macdHist        : 0;
    const volScore     = typeof f.volScore         === "number" ? f.volScore        : 0;
    const rsiVal       = typeof f.rsi              === "number" ? f.rsi             : null;
    const atrPct       = typeof f.atrPctOfClose    === "number" ? f.atrPctOfClose   : null;
    const indStatus    = typeof f.indicatorStatus  === "string" ? f.indicatorStatus : "unknown";
    const candleCount  = typeof f.candleCount      === "number" ? f.candleCount     : klines.length;
    const lastCandle   = typeof f.lastCandleTime   === "number" ? f.lastCandleTime  : null;

    let classification: ScanRow["classification"] = "no_trade";
    let reason = sig.rejectedReason ?? sig.reasons[0] ?? "—";

    if (sig.signalType === "LONG" || sig.signalType === "SHORT") {
      classification = sig.score >= 85 ? "tradeable" : "watchlist";
      reason = `${sig.signalType} skor=${sig.score} — ${sig.reasons[0] ?? ""}`;
    } else if (sig.signalType === "WAIT") {
      classification = "watchlist";
    } else if (ticker.spread > 0.0015) {
      classification = "avoid";
      reason = `Spread yüksek (${(ticker.spread * 100).toFixed(3)}%)`;
    } else if (ticker.quoteVolume24h > 0 && ticker.quoteVolume24h < 5_000_000) {
      classification = "avoid";
      reason = `Düşük hacim ($${(ticker.quoteVolume24h / 1_000_000).toFixed(1)}M)`;
    } else if (indStatus !== "ok" && indStatus !== "pending") {
      classification = "no_trade";
      reason = `Indicator hatası: ${indStatus}`;
    }

    return {
      symbol, exchange, marketType: "futures",
      price: ticker.lastPrice,
      volume24hUsd: ticker.quoteVolume24h,
      spread: ticker.spread,
      fundingRate: funding?.rate ?? null,
      maxLeverage: info?.maxLeverage ?? 0,
      trendScore, momentumScore: macdHist, volumeScore: volConf, volatilityScore: volScore,
      signal: sig.signalType, signalScore: sig.score,
      classification, reason,
      candleCount, lastCandleTime: lastCandle, indicatorStatus: indStatus,
      atrPct, rsi: rsiVal,
    };
  } catch (e: any) {
    return {
      symbol, exchange, marketType: "futures",
      price: 0, volume24hUsd: 0, spread: 0, fundingRate: null, maxLeverage: 0,
      trendScore: 0, momentumScore: 0, volumeScore: 0, volatilityScore: 0,
      signal: "ERROR", signalScore: 0,
      classification: "avoid",
      reason: `Tarama hatası: ${e?.message ?? String(e)}`,
      candleCount: 0, lastCandleTime: null, indicatorStatus: "error",
      atrPct: null, rsi: null,
    };
  }
}
