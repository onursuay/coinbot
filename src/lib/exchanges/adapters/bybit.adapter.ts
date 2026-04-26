// Bybit V5 USDT Perpetual adapter (public market data).
// Trading endpoints throw — guarded by LIVE_TRADING and risk engine at higher layer.

import type {
  BalanceSummary, CredentialValidation, ExchangeAdapter, ExchangeName,
  ExchangePosition, FundingRate, FuturesSymbolInfo, Kline, OrderBook,
  PlaceFuturesOrderPayload, PositionDirection, RateLimitStatus, Ticker, Timeframe,
} from "../types";
import { fetchJson } from "../http";
import { fromCanonical, toCanonical } from "../symbol-normalizer";

const BASE = "https://api.bybit.com";

const TF: Record<Timeframe, string> = { "1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240" };

let cache: { at: number; data: FuturesSymbolInfo[] } | null = null;
const TTL = 60_000;

function raw(symbol: string): string { return fromCanonical(toCanonical(symbol), "bybit"); }

export class BybitAdapter implements ExchangeAdapter {
  private rate: RateLimitStatus = { remaining: 600, used: 0, limit: 600, reset: Date.now() + 60_000 };
  getExchangeName(): ExchangeName { return "bybit"; }

  async getSymbols(): Promise<string[]> { return (await this.getFuturesSymbols()).map((s) => s.symbol); }

  async getFuturesSymbols(): Promise<FuturesSymbolInfo[]> {
    if (cache && Date.now() - cache.at < TTL) return cache.data;
    const json = await fetchJson<any>(`${BASE}/v5/market/instruments-info?category=linear`);
    const arr: any[] = json?.result?.list ?? [];
    const data: FuturesSymbolInfo[] = arr
      .filter((s) => s.quoteCoin === "USDT" && s.status === "Trading")
      .map((s): FuturesSymbolInfo => ({
        symbol: `${s.baseCoin}/${s.quoteCoin}`,
        exchangeSymbol: s.symbol,
        baseAsset: s.baseCoin,
        quoteAsset: s.quoteCoin,
        marketType: "futures",
        contractType: "perpetual",
        minOrderSize: Number(s.lotSizeFilter?.minOrderQty ?? 0.001),
        minNotional: Number(s.lotSizeFilter?.minNotionalValue ?? 5),
        stepSize: Number(s.lotSizeFilter?.qtyStep ?? 0.001),
        tickSize: Number(s.priceFilter?.tickSize ?? 0.01),
        maxLeverage: Number(s.leverageFilter?.maxLeverage ?? 20),
        isActive: true,
      }));
    cache = { at: Date.now(), data };
    return data;
  }

  async getExchangeInfo(s: string) { return (await this.getFuturesSymbols()).find((x) => x.symbol === toCanonical(s)) ?? null; }
  async getMinOrderSize(s: string) { return (await this.getExchangeInfo(s))?.minOrderSize ?? 0.001; }
  async getMaxLeverage(s: string) { return (await this.getExchangeInfo(s))?.maxLeverage ?? 20; }
  async getTickSize(s: string) { return (await this.getExchangeInfo(s))?.tickSize ?? 0.01; }
  async getStepSize(s: string) { return (await this.getExchangeInfo(s))?.stepSize ?? 0.001; }

  async getKlines(symbol: string, timeframe: Timeframe, limit = 200): Promise<Kline[]> {
    const json = await fetchJson<any>(`${BASE}/v5/market/kline?category=linear&symbol=${raw(symbol)}&interval=${TF[timeframe]}&limit=${limit}`);
    const arr: any[] = json?.result?.list ?? [];
    return arr.reverse().map((k: string[]): Kline => {
      const t = Number(k[0]);
      return {
        openTime: t,
        open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]),
        volume: Number(k[5]),
        closeTime: t + 60_000,
      };
    });
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const json = await fetchJson<any>(`${BASE}/v5/market/tickers?category=linear&symbol=${raw(symbol)}`);
    const d = json?.result?.list?.[0] ?? {};
    const last = Number(d.lastPrice ?? 0);
    const bid = Number(d.bid1Price ?? last);
    const ask = Number(d.ask1Price ?? last);
    const mid = bid && ask ? (bid + ask) / 2 : last || 1;
    return {
      symbol: toCanonical(symbol),
      lastPrice: last, bid, ask,
      spread: mid > 0 ? Math.max(0, (ask - bid) / mid) : 0,
      volume24h: Number(d.volume24h ?? 0),
      quoteVolume24h: Number(d.turnover24h ?? 0),
      high24h: Number(d.highPrice24h ?? last),
      low24h: Number(d.lowPrice24h ?? last),
      changePercent24h: Number(d.price24hPcnt ?? 0) * 100,
      timestamp: Date.now(),
    };
  }

  async getOrderBook(symbol: string, depth = 20): Promise<OrderBook> {
    const json = await fetchJson<any>(`${BASE}/v5/market/orderbook?category=linear&symbol=${raw(symbol)}&limit=${Math.min(50, depth)}`);
    const d = json?.result ?? {};
    return {
      symbol: toCanonical(symbol),
      bids: (d.b ?? []).slice(0, depth).map((b: string[]) => ({ price: Number(b[0]), size: Number(b[1]) })),
      asks: (d.a ?? []).slice(0, depth).map((b: string[]) => ({ price: Number(b[0]), size: Number(b[1]) })),
      timestamp: Date.now(),
    };
  }

  async getFundingRate(symbol: string): Promise<FundingRate | null> {
    try {
      const json = await fetchJson<any>(`${BASE}/v5/market/tickers?category=linear&symbol=${raw(symbol)}`);
      const d = json?.result?.list?.[0]; if (!d) return null;
      return {
        symbol: toCanonical(symbol),
        rate: Number(d.fundingRate ?? 0),
        nextFundingTime: Number(d.nextFundingTime ?? 0) || undefined,
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
  async setLeverage(): Promise<void> {}
  async placeFuturesOrder(_p: PlaceFuturesOrderPayload): Promise<{ orderId: string }> { throw new Error("LIVE_TRADING disabled at adapter level"); }
  async cancelOrder(): Promise<void> { throw new Error("LIVE_TRADING disabled at adapter level"); }
  async closePosition(): Promise<void> { throw new Error("LIVE_TRADING disabled at adapter level"); }
  subscribeTicker(): () => void { return () => undefined; }
  subscribeKlines(): () => void { return () => undefined; }
  disconnectWebSocket(): void {}
  getRateLimitStatus(): RateLimitStatus { return this.rate; }
  async validateApiCredentials(): Promise<CredentialValidation> { return { ok: false, reason: "Credential validation runs in API route" }; }
}
