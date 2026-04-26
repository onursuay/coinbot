// Binance USDT-M Futures adapter (public market data).
// Trading endpoints intentionally throw — gated behind LIVE_TRADING and risk engine.

import type {
  BalanceSummary, CredentialValidation, ExchangeAdapter, ExchangeName,
  ExchangePosition, FundingRate, FuturesSymbolInfo, Kline, OrderBook,
  PlaceFuturesOrderPayload, PositionDirection, RateLimitStatus, Ticker, Timeframe,
} from "../types";
import { fetchJson } from "../http";
import { fromCanonical, toCanonical } from "../symbol-normalizer";

const FAPI = "https://fapi.binance.com";

const TF: Record<Timeframe, string> = { "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h" };

let cache: { at: number; data: FuturesSymbolInfo[] } | null = null;
const TTL = 60_000;

function raw(symbol: string): string { return fromCanonical(toCanonical(symbol), "binance"); }

export class BinanceAdapter implements ExchangeAdapter {
  private rate: RateLimitStatus = { remaining: 2400, used: 0, limit: 2400, reset: Date.now() + 60_000 };
  getExchangeName(): ExchangeName { return "binance"; }

  async getSymbols(): Promise<string[]> { return (await this.getFuturesSymbols()).map((s) => s.symbol); }

  async getFuturesSymbols(): Promise<FuturesSymbolInfo[]> {
    if (cache && Date.now() - cache.at < TTL) return cache.data;
    const json = await fetchJson<any>(`${FAPI}/fapi/v1/exchangeInfo`);
    const arr: any[] = json?.symbols ?? [];
    const data: FuturesSymbolInfo[] = arr
      .filter((s) => s.contractType === "PERPETUAL" && s.quoteAsset === "USDT" && s.status === "TRADING")
      .map((s): FuturesSymbolInfo => {
        const lot = s.filters?.find((f: any) => f.filterType === "LOT_SIZE") ?? {};
        const px = s.filters?.find((f: any) => f.filterType === "PRICE_FILTER") ?? {};
        const notional = s.filters?.find((f: any) => f.filterType === "MIN_NOTIONAL") ?? {};
        return {
          symbol: `${s.baseAsset}/${s.quoteAsset}`,
          exchangeSymbol: s.symbol,
          baseAsset: s.baseAsset,
          quoteAsset: s.quoteAsset,
          marketType: "futures",
          contractType: "perpetual",
          minOrderSize: Number(lot.minQty ?? 0.001),
          minNotional: Number(notional.notional ?? 5),
          stepSize: Number(lot.stepSize ?? 0.001),
          tickSize: Number(px.tickSize ?? 0.01),
          maxLeverage: 20,
          isActive: true,
        };
      });
    cache = { at: Date.now(), data };
    return data;
  }

  async getExchangeInfo(symbol: string): Promise<FuturesSymbolInfo | null> {
    return (await this.getFuturesSymbols()).find((s) => s.symbol === toCanonical(symbol)) ?? null;
  }
  async getMinOrderSize(s: string) { return (await this.getExchangeInfo(s))?.minOrderSize ?? 0.001; }
  async getMaxLeverage(s: string) { return (await this.getExchangeInfo(s))?.maxLeverage ?? 20; }
  async getTickSize(s: string) { return (await this.getExchangeInfo(s))?.tickSize ?? 0.01; }
  async getStepSize(s: string) { return (await this.getExchangeInfo(s))?.stepSize ?? 0.001; }

  async getKlines(symbol: string, timeframe: Timeframe, limit = 200): Promise<Kline[]> {
    const json = await fetchJson<any[]>(`${FAPI}/fapi/v1/klines?symbol=${raw(symbol)}&interval=${TF[timeframe]}&limit=${limit}`);
    return (json ?? []).map((k: any[]): Kline => ({
      openTime: Number(k[0]),
      open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]),
      volume: Number(k[5]), closeTime: Number(k[6]),
    }));
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const r = raw(symbol);
    const [t, book] = await Promise.all([
      fetchJson<any>(`${FAPI}/fapi/v1/ticker/24hr?symbol=${r}`),
      fetchJson<any>(`${FAPI}/fapi/v1/ticker/bookTicker?symbol=${r}`),
    ]);
    const last = Number(t.lastPrice ?? 0);
    const bid = Number(book.bidPrice ?? last);
    const ask = Number(book.askPrice ?? last);
    const mid = bid && ask ? (bid + ask) / 2 : last || 1;
    return {
      symbol: toCanonical(symbol),
      lastPrice: last, bid, ask,
      spread: mid > 0 ? Math.max(0, (ask - bid) / mid) : 0,
      volume24h: Number(t.volume ?? 0),
      quoteVolume24h: Number(t.quoteVolume ?? 0),
      high24h: Number(t.highPrice ?? last),
      low24h: Number(t.lowPrice ?? last),
      changePercent24h: Number(t.priceChangePercent ?? 0),
      timestamp: Date.now(),
    };
  }

  async getOrderBook(symbol: string, depth = 20): Promise<OrderBook> {
    const json = await fetchJson<any>(`${FAPI}/fapi/v1/depth?symbol=${raw(symbol)}&limit=${Math.min(50, depth)}`);
    return {
      symbol: toCanonical(symbol),
      bids: (json.bids ?? []).slice(0, depth).map((b: any[]) => ({ price: Number(b[0]), size: Number(b[1]) })),
      asks: (json.asks ?? []).slice(0, depth).map((b: any[]) => ({ price: Number(b[0]), size: Number(b[1]) })),
      timestamp: Date.now(),
    };
  }

  async getFundingRate(symbol: string): Promise<FundingRate | null> {
    try {
      const json = await fetchJson<any>(`${FAPI}/fapi/v1/premiumIndex?symbol=${raw(symbol)}`);
      return {
        symbol: toCanonical(symbol),
        rate: Number(json.lastFundingRate ?? 0),
        nextFundingTime: Number(json.nextFundingTime ?? 0) || undefined,
        timestamp: Date.now(),
      };
    } catch { return null; }
  }

  async getBalance(): Promise<BalanceSummary[]> { return []; }
  async getOpenPositions(): Promise<ExchangePosition[]> { return []; }

  async getEstimatedLiquidationPrice(p: { direction: PositionDirection; entryPrice: number; leverage: number }) {
    const buf = 0.95;
    return p.direction === "LONG"
      ? p.entryPrice * (1 - (1 / Math.max(1, p.leverage)) * buf)
      : p.entryPrice * (1 + (1 / Math.max(1, p.leverage)) * buf);
  }

  async setLeverage(): Promise<void> { /* no-op */ }
  async placeFuturesOrder(): Promise<{ orderId: string }> { throw new Error("LIVE_TRADING disabled at adapter level"); }
  async cancelOrder(): Promise<void> { throw new Error("LIVE_TRADING disabled at adapter level"); }
  async closePosition(): Promise<void> { throw new Error("LIVE_TRADING disabled at adapter level"); }

  subscribeTicker(): () => void { return () => undefined; }
  subscribeKlines(): () => void { return () => undefined; }
  disconnectWebSocket(): void { /* none */ }

  getRateLimitStatus(): RateLimitStatus { return this.rate; }
  async validateApiCredentials(): Promise<CredentialValidation> {
    return { ok: false, reason: "Credential validation runs in API route with encrypted secrets" };
  }
}
