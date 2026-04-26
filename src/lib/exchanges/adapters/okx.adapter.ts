// OKX adapter — public futures (perpetual SWAP) market data.
// Trading endpoints throw — guarded by LIVE_TRADING and risk engine at higher layer.

import type {
  BalanceSummary, CredentialValidation, ExchangeAdapter, ExchangeName,
  ExchangePosition, FundingRate, FuturesSymbolInfo, Kline, OrderBook,
  PlaceFuturesOrderPayload, PositionDirection, RateLimitStatus, Ticker, Timeframe,
} from "../types";
import { fetchJson } from "../http";
import { fromCanonical, toCanonical } from "../symbol-normalizer";

const BASE = "https://www.okx.com";

const TF: Record<Timeframe, string> = { "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1H", "4h": "4H" };

let cache: { at: number; data: FuturesSymbolInfo[] } | null = null;
const TTL = 60_000;

function inst(symbol: string): string { return fromCanonical(toCanonical(symbol), "okx"); }

export class OkxAdapter implements ExchangeAdapter {
  private rate: RateLimitStatus = { remaining: 600, used: 0, limit: 600, reset: Date.now() + 60_000 };
  getExchangeName(): ExchangeName { return "okx"; }

  async getSymbols(): Promise<string[]> { return (await this.getFuturesSymbols()).map((s) => s.symbol); }

  async getFuturesSymbols(): Promise<FuturesSymbolInfo[]> {
    if (cache && Date.now() - cache.at < TTL) return cache.data;
    const json = await fetchJson<any>(`${BASE}/api/v5/public/instruments?instType=SWAP`);
    const arr: any[] = json?.data ?? [];
    const data: FuturesSymbolInfo[] = arr
      .filter((d) => d.settleCcy === "USDT" && d.state === "live")
      .map((d): FuturesSymbolInfo => {
        const [base, quote] = String(d.instId).split("-");
        return {
          symbol: `${base}/${quote}`,
          exchangeSymbol: d.instId,
          baseAsset: base,
          quoteAsset: quote,
          marketType: "futures",
          contractType: "perpetual",
          minOrderSize: Number(d.minSz ?? 1),
          minNotional: 0,
          stepSize: Number(d.lotSz ?? 1),
          tickSize: Number(d.tickSz ?? 0.01),
          maxLeverage: Number(d.lever ?? 20),
          isActive: true,
        };
      });
    cache = { at: Date.now(), data };
    return data;
  }

  async getExchangeInfo(s: string) { return (await this.getFuturesSymbols()).find((x) => x.symbol === toCanonical(s)) ?? null; }
  async getMinOrderSize(s: string) { return (await this.getExchangeInfo(s))?.minOrderSize ?? 1; }
  async getMaxLeverage(s: string) { return (await this.getExchangeInfo(s))?.maxLeverage ?? 20; }
  async getTickSize(s: string) { return (await this.getExchangeInfo(s))?.tickSize ?? 0.01; }
  async getStepSize(s: string) { return (await this.getExchangeInfo(s))?.stepSize ?? 1; }

  async getKlines(symbol: string, timeframe: Timeframe, limit = 200): Promise<Kline[]> {
    const json = await fetchJson<any>(`${BASE}/api/v5/market/candles?instId=${inst(symbol)}&bar=${TF[timeframe]}&limit=${limit}`);
    const arr: any[] = json?.data ?? [];
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

  async getAllTickers(): Promise<Ticker[]> {
    const json = await fetchJson<any>(`${BASE}/api/v5/market/tickers?instType=SWAP`);
    const arr: any[] = json?.data ?? [];
    return arr
      .filter((d: any) => String(d.instId).endsWith("-USDT-SWAP"))
      .map((d: any): Ticker => {
        const last = Number(d.last ?? 0);
        const bid = Number(d.bidPx ?? last);
        const ask = Number(d.askPx ?? last);
        const mid = bid && ask ? (bid + ask) / 2 : last || 1;
        return {
          symbol: toCanonical(d.instId),
          lastPrice: last, bid, ask,
          spread: mid > 0 ? Math.max(0, (ask - bid) / mid) : 0,
          volume24h: Number(d.vol24h ?? 0),
          quoteVolume24h: Number(d.volCcy24h ?? 0),
          high24h: Number(d.high24h ?? last),
          low24h: Number(d.low24h ?? last),
          changePercent24h: last && Number(d.open24h) ? ((last - Number(d.open24h)) / Number(d.open24h)) * 100 : 0,
          timestamp: Date.now(),
        };
      });
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const json = await fetchJson<any>(`${BASE}/api/v5/market/ticker?instId=${inst(symbol)}`);
    const d = json?.data?.[0] ?? {};
    const last = Number(d.last ?? 0);
    const bid = Number(d.bidPx ?? last);
    const ask = Number(d.askPx ?? last);
    const mid = bid && ask ? (bid + ask) / 2 : last || 1;
    return {
      symbol: toCanonical(symbol),
      lastPrice: last, bid, ask,
      spread: mid > 0 ? Math.max(0, (ask - bid) / mid) : 0,
      volume24h: Number(d.vol24h ?? 0),
      quoteVolume24h: Number(d.volCcy24h ?? 0),
      high24h: Number(d.high24h ?? last),
      low24h: Number(d.low24h ?? last),
      changePercent24h: last && Number(d.open24h) ? ((last - Number(d.open24h)) / Number(d.open24h)) * 100 : 0,
      timestamp: Date.now(),
    };
  }

  async getOrderBook(symbol: string, depth = 20): Promise<OrderBook> {
    const json = await fetchJson<any>(`${BASE}/api/v5/market/books?instId=${inst(symbol)}&sz=${Math.min(50, depth)}`);
    const d = json?.data?.[0] ?? {};
    return {
      symbol: toCanonical(symbol),
      bids: (d.bids ?? []).slice(0, depth).map((b: string[]) => ({ price: Number(b[0]), size: Number(b[1]) })),
      asks: (d.asks ?? []).slice(0, depth).map((b: string[]) => ({ price: Number(b[0]), size: Number(b[1]) })),
      timestamp: Date.now(),
    };
  }

  async getFundingRate(symbol: string): Promise<FundingRate | null> {
    try {
      const json = await fetchJson<any>(`${BASE}/api/v5/public/funding-rate?instId=${inst(symbol)}`);
      const d = json?.data?.[0]; if (!d) return null;
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
