// MEXC adapter — futures-first.
// Public REST: https://contract.mexc.com (futures), https://api.mexc.com (spot).
// Trading endpoints are guarded behind LIVE_TRADING and credential validation
// at a higher layer (see live-trading-guard). This adapter never auto-trades.

import type {
  BalanceSummary, CredentialValidation, ExchangeAdapter, ExchangeName,
  ExchangePosition, FundingRate, FuturesSymbolInfo, Kline, OrderBook,
  PlaceFuturesOrderPayload, PositionDirection, RateLimitStatus, Ticker, Timeframe,
} from "../types";
import { fetchJson } from "../http";
import { fromCanonical, toCanonical } from "../symbol-normalizer";

const FUTURES_BASE = "https://contract.mexc.com";

const TF_TO_MEXC: Record<Timeframe, string> = {
  "1m": "Min1",
  "5m": "Min5",
  "15m": "Min15",
  "1h": "Min60",
  "4h": "Hour4",
};

function toMexcContract(symbol: string): string {
  const [base, quote] = symbol.split("/");
  return `${(base ?? symbol).toUpperCase()}_${(quote ?? "USDT").toUpperCase()}`;
}
function fromMexcContract(raw: string): string {
  const [b, q] = raw.split("_");
  return `${(b ?? raw).toUpperCase()}/${(q ?? "USDT").toUpperCase()}`;
}

let cachedSymbols: { at: number; data: FuturesSymbolInfo[] } | null = null;
const SYMBOL_TTL = 60_000;

export class MexcAdapter implements ExchangeAdapter {
  private rate: RateLimitStatus = { remaining: 1200, used: 0, limit: 1200, reset: Date.now() + 60_000 };

  getExchangeName(): ExchangeName { return "mexc"; }

  async getSymbols(): Promise<string[]> {
    const list = await this.getFuturesSymbols();
    return list.map((s) => s.symbol);
  }

  async getFuturesSymbols(): Promise<FuturesSymbolInfo[]> {
    if (cachedSymbols && Date.now() - cachedSymbols.at < SYMBOL_TTL) return cachedSymbols.data;
    const json = await fetchJson<any>(`${FUTURES_BASE}/api/v1/contract/detail`);
    const arr = Array.isArray(json?.data) ? json.data : [];
    const data: FuturesSymbolInfo[] = arr
      .filter((d: any) => d?.quoteCoin === "USDT")
      .map((d: any): FuturesSymbolInfo => ({
        symbol: fromMexcContract(d.symbol),
        exchangeSymbol: d.symbol,
        baseAsset: d.baseCoin,
        quoteAsset: d.quoteCoin,
        marketType: "futures",
        contractType: "perpetual",
        minOrderSize: Number(d.minVol ?? 1),
        minNotional: Number(d.minVol ?? 1) * Number(d.contractSize ?? 0),
        stepSize: Number(d.contractSize ?? 0.0001),
        tickSize: Number(d.priceUnit ?? 0.01),
        maxLeverage: Number(d.maxLeverage ?? 20),
        isActive: d.state === 0 || d.state === "ENABLED" || d.state === undefined,
      }));
    cachedSymbols = { at: Date.now(), data };
    return data;
  }

  async getExchangeInfo(symbol: string): Promise<FuturesSymbolInfo | null> {
    const list = await this.getFuturesSymbols();
    return list.find((s) => s.symbol === toCanonical(symbol)) ?? null;
  }
  async getMinOrderSize(symbol: string): Promise<number> { return (await this.getExchangeInfo(symbol))?.minOrderSize ?? 1; }
  async getMaxLeverage(symbol: string): Promise<number> { return (await this.getExchangeInfo(symbol))?.maxLeverage ?? 20; }
  async getTickSize(symbol: string): Promise<number> { return (await this.getExchangeInfo(symbol))?.tickSize ?? 0.01; }
  async getStepSize(symbol: string): Promise<number> { return (await this.getExchangeInfo(symbol))?.stepSize ?? 0.0001; }

  async getKlines(symbol: string, timeframe: Timeframe, limit = 250): Promise<Kline[]> {
    const tf = TF_TO_MEXC[timeframe];
    const contract = toMexcContract(symbol);
    const nowSec = Math.floor(Date.now() / 1000);
    const durationSec = Math.ceil((limit * intervalToMs(timeframe)) / 1000);
    const startSec = nowSec - durationSec;
    const url = `${FUTURES_BASE}/api/v1/contract/kline/${contract}?interval=${tf}&start=${startSec}&end=${nowSec}`;
    const json = await fetchJson<any>(url);
    const d = json?.data;
    if (!d || !Array.isArray(d.time) || d.time.length === 0) {
      // Fallback: try without time range (some symbols may not support range params)
      const fallback = await fetchJson<any>(`${FUTURES_BASE}/api/v1/contract/kline/${contract}?interval=${tf}`).catch(() => null);
      const fd = fallback?.data;
      if (!fd || !Array.isArray(fd.time) || fd.time.length === 0) return [];
      return parseMexcKlines(fd, limit, timeframe);
    }
    return parseMexcKlines(d, limit, timeframe);
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const contract = toMexcContract(symbol);
    const json = await fetchJson<any>(`${FUTURES_BASE}/api/v1/contract/ticker?symbol=${contract}`);
    const d = json?.data ?? {};
    const last = Number(d.lastPrice ?? d.fairPrice ?? 0);
    const bid = Number(d.bid1 ?? last);
    const ask = Number(d.ask1 ?? last);
    const mid = bid && ask ? (bid + ask) / 2 : last || 1;
    return {
      symbol: toCanonical(symbol),
      lastPrice: last,
      bid, ask,
      spread: mid > 0 ? Math.max(0, (ask - bid) / mid) : 0,
      volume24h: Number(d.volume24 ?? 0),
      quoteVolume24h: Number(d.amount24 ?? 0),
      high24h: Number(d.high24Price ?? last),
      low24h: Number(d.lower24Price ?? last),
      changePercent24h: Number(d.riseFallRate ?? 0) * 100,
      timestamp: Date.now(),
    };
  }

  async getOrderBook(symbol: string, depth = 20): Promise<OrderBook> {
    const contract = toMexcContract(symbol);
    const json = await fetchJson<any>(`${FUTURES_BASE}/api/v1/contract/depth/${contract}?limit=${depth}`);
    const d = json?.data ?? {};
    const bids = (d.bids ?? []).slice(0, depth).map((x: any[]) => ({ price: Number(x[0]), size: Number(x[1]) }));
    const asks = (d.asks ?? []).slice(0, depth).map((x: any[]) => ({ price: Number(x[0]), size: Number(x[1]) }));
    return { symbol: toCanonical(symbol), bids, asks, timestamp: Date.now() };
  }

  async getFundingRate(symbol: string): Promise<FundingRate | null> {
    const contract = toMexcContract(symbol);
    try {
      const json = await fetchJson<any>(`${FUTURES_BASE}/api/v1/contract/funding_rate/${contract}`);
      const d = json?.data;
      if (!d) return null;
      return {
        symbol: toCanonical(symbol),
        rate: Number(d.fundingRate ?? 0),
        nextFundingTime: d.nextSettleTime ? Number(d.nextSettleTime) : undefined,
        timestamp: Date.now(),
      };
    } catch { return null; }
  }

  async getBalance(): Promise<BalanceSummary[]> {
    // Authenticated endpoint — guarded. Returning empty list keeps UI honest in PAPER mode.
    return [];
  }
  async getOpenPositions(): Promise<ExchangePosition[]> { return []; }

  async getEstimatedLiquidationPrice(p: {
    symbol: string; direction: PositionDirection; entryPrice: number; leverage: number;
  }): Promise<number> {
    // Conservative estimator (no maintenance margin nuance): liq ≈ entry * (1 ∓ 1/leverage * 0.95).
    const buffer = 0.95;
    if (p.direction === "LONG") return p.entryPrice * (1 - (1 / Math.max(1, p.leverage)) * buffer);
    return p.entryPrice * (1 + (1 / Math.max(1, p.leverage)) * buffer);
  }

  async setLeverage(): Promise<void> { /* no-op until live trading is enabled */ }

  async placeFuturesOrder(_payload: PlaceFuturesOrderPayload): Promise<{ orderId: string }> {
    throw new Error("LIVE_TRADING disabled — placeFuturesOrder blocked at adapter level");
  }
  async cancelOrder(): Promise<void> {
    throw new Error("LIVE_TRADING disabled — cancelOrder blocked at adapter level");
  }
  async closePosition(): Promise<void> {
    throw new Error("LIVE_TRADING disabled — closePosition blocked at adapter level");
  }

  subscribeTicker(): () => void { return () => undefined; }
  subscribeKlines(): () => void { return () => undefined; }
  disconnectWebSocket(): void { /* no persistent ws in serverless context */ }

  getRateLimitStatus(): RateLimitStatus { return this.rate; }
  async validateApiCredentials(): Promise<CredentialValidation> {
    return { ok: false, reason: "Credential validation runs in API route with encrypted secrets" };
  }
}

function parseMexcKlines(d: any, limit: number, timeframe: Timeframe): Kline[] {
  const len = d.time.length;
  const start = Math.max(0, len - limit);
  const out: Kline[] = [];
  for (let i = start; i < len; i++) {
    const openMs = Number(d.time[i]) * 1000;
    if (!Number.isFinite(openMs) || openMs <= 0) continue;
    const o = Number(d.open?.[i] ?? NaN);
    const h = Number(d.high?.[i] ?? NaN);
    const l = Number(d.low?.[i] ?? NaN);
    const c = Number(d.close?.[i] ?? NaN);
    const v = Number(d.vol?.[i] ?? d.amount?.[i] ?? 0);
    if (![o, h, l, c].every(Number.isFinite)) continue;
    out.push({
      openTime: openMs,
      open: o, high: h, low: l, close: c,
      volume: Number.isFinite(v) ? v : 0,
      closeTime: openMs + intervalToMs(timeframe) - 1,
    });
  }
  return out;
}

function intervalToMs(tf: Timeframe): number {
  return { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000 }[tf];
}

// Helper for routes: convert canonical -> mexc raw if needed
export function mexcRawSymbol(symbol: string): string {
  return fromCanonical(toCanonical(symbol), "mexc");
}
