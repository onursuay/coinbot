// Market scanner — yüksek hacim, makul spread, uygun volatilite, BTC uyumu.
// Sonuç: per-symbol classification (Tradeable | Watchlist | Avoid | High risk | No trade).

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
}

export async function scanMarket(opts: {
  exchange: ExchangeName;
  symbols: string[];
  timeframe?: Timeframe;
}): Promise<ScanRow[]> {
  const tf: Timeframe = opts.timeframe ?? "15m";
  const adapter = getAdapter(opts.exchange);
  const rows: ScanRow[] = [];

  // BTC reference once
  let btcKlines: any[] = [];
  try { btcKlines = await adapter.getKlines("BTC/USDT", tf, 250); } catch { /* optional */ }

  for (const symbol of opts.symbols) {
    try {
      const [klines, ticker, info, funding] = await Promise.all([
        adapter.getKlines(symbol, tf, 250),
        adapter.getTicker(symbol),
        adapter.getExchangeInfo(symbol),
        adapter.getFundingRate(symbol),
      ]);
      const sig = generateSignal({ symbol, timeframe: tf, klines, ticker, funding, btcKlines });

      let classification: ScanRow["classification"] = "no_trade";
      let reason = sig.rejectedReason ?? sig.reasons[0] ?? "—";
      if (sig.signalType === "LONG" || sig.signalType === "SHORT") {
        classification = sig.score >= 85 ? "tradeable" : "watchlist";
        reason = `${sig.signalType} skor ${sig.score}`;
      } else if (ticker.spread > 0.0015) {
        classification = "avoid";
      } else if (ticker.quoteVolume24h && ticker.quoteVolume24h < 5_000_000) {
        classification = "avoid";
      } else if (sig.signalType === "WAIT") {
        classification = "watchlist";
      }

      rows.push({
        symbol, exchange: opts.exchange, marketType: "futures",
        price: ticker.lastPrice,
        volume24hUsd: ticker.quoteVolume24h,
        spread: ticker.spread,
        fundingRate: funding?.rate ?? null,
        maxLeverage: info?.maxLeverage ?? 0,
        trendScore: Number(sig.features.trendScore ?? 0),
        momentumScore: Number(sig.features.macdHist ?? 0),
        volumeScore: Number(sig.features.volConf ?? 0),
        volatilityScore: Number(sig.features.volScore ?? 0),
        signal: sig.signalType,
        signalScore: sig.score,
        classification,
        reason,
      });
    } catch (e: any) {
      rows.push({
        symbol, exchange: opts.exchange, marketType: "futures",
        price: 0, volume24hUsd: 0, spread: 0, fundingRate: null, maxLeverage: 0,
        trendScore: 0, momentumScore: 0, volumeScore: 0, volatilityScore: 0,
        signal: "ERROR", signalScore: 0,
        classification: "avoid", reason: e?.message ?? "tarama hatası",
      });
    }
  }
  return rows;
}
