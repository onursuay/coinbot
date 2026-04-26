// Market scanner — yüksek hacim, makul spread, uygun volatilite, BTC uyumu.
// Her sembol için kline + indicators + signal hesaplanır.
// Features always populated — scanner scores never zero when data exists.

import type { ExchangeName, Timeframe } from "@/lib/exchanges/types";
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
  // Debug fields — always present
  candleCount: number;
  lastCandleTime: number | null;
  indicatorStatus: string;
  atrPct: number | null;
  rsi: number | null;
}

export async function scanMarket(opts: {
  exchange: ExchangeName;
  symbols: string[];
  timeframe?: Timeframe;
}): Promise<ScanRow[]> {
  const tf: Timeframe = opts.timeframe ?? "5m";
  const adapter = getAdapter(opts.exchange);
  const rows: ScanRow[] = [];

  // BTC reference — best effort
  let btcKlines: any[] = [];
  try { btcKlines = await adapter.getKlines("BTC/USDT", tf, 250); } catch { /* non-fatal */ }

  for (const symbol of opts.symbols) {
    try {
      const [klines, ticker, info, funding] = await Promise.all([
        adapter.getKlines(symbol, tf, 250),
        adapter.getTicker(symbol),
        adapter.getExchangeInfo(symbol),
        adapter.getFundingRate(symbol),
      ]);

      const sig = generateSignal({ symbol, timeframe: tf, klines, ticker, funding, btcKlines });
      const f = sig.features;

      // Scores — pulled from features (always populated now, even on early exit)
      const trendScore   = typeof f.trendScore   === "number" ? f.trendScore   : 0;
      const volScore     = typeof f.volScore      === "number" ? f.volScore     : 0;
      const volConf      = typeof f.volConf       === "number" ? f.volConf      : 0;
      const macdHist     = typeof f.macdHist      === "number" ? f.macdHist     : 0;
      const rsiVal       = typeof f.rsi           === "number" ? f.rsi          : null;
      const atrPct       = typeof f.atrPctOfClose === "number" ? f.atrPctOfClose: null;
      const indStatus    = typeof f.indicatorStatus === "string" ? f.indicatorStatus : "unknown";
      const candleCount  = typeof f.candleCount   === "number" ? f.candleCount  : klines.length;
      const lastCandle   = typeof f.lastCandleTime === "number" ? f.lastCandleTime : null;

      // Classification & reason
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

      rows.push({
        symbol, exchange: opts.exchange, marketType: "futures",
        price: ticker.lastPrice,
        volume24hUsd: ticker.quoteVolume24h,
        spread: ticker.spread,
        fundingRate: funding?.rate ?? null,
        maxLeverage: info?.maxLeverage ?? 0,
        trendScore,
        momentumScore: macdHist,
        volumeScore: volConf,
        volatilityScore: volScore,
        signal: sig.signalType,
        signalScore: sig.score,
        classification,
        reason,
        candleCount,
        lastCandleTime: lastCandle,
        indicatorStatus: indStatus,
        atrPct,
        rsi: rsiVal,
      });
    } catch (e: any) {
      rows.push({
        symbol, exchange: opts.exchange, marketType: "futures",
        price: 0, volume24hUsd: 0, spread: 0, fundingRate: null, maxLeverage: 0,
        trendScore: 0, momentumScore: 0, volumeScore: 0, volatilityScore: 0,
        signal: "ERROR", signalScore: 0,
        classification: "avoid",
        reason: `Tarama hatası: ${e?.message ?? String(e)}`,
        candleCount: 0, lastCandleTime: null, indicatorStatus: "error",
        atrPct: null, rsi: null,
      });
    }
  }
  return rows;
}
