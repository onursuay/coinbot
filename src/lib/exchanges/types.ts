// Shared cross-exchange types. The Signal Engine, Risk Engine, Paper Trading
// Engine, and Dashboard all consume this surface — never raw exchange APIs.

export type ExchangeName = "mexc" | "binance" | "okx" | "bybit";
export type MarketType = "futures" | "spot";
export type MarginMode = "isolated" | "cross";
export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h";
export type OrderSide = "BUY" | "SELL";
export type PositionDirection = "LONG" | "SHORT";

export interface Kline {
  openTime: number; // ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number; // ms
}

export interface Ticker {
  symbol: string;
  lastPrice: number;
  bid: number;
  ask: number;
  spread: number;       // (ask-bid)/mid in fraction (e.g. 0.0005 = 5bps)
  volume24h: number;    // base volume
  quoteVolume24h: number; // quote volume in USDT
  high24h: number;
  low24h: number;
  changePercent24h: number;
  timestamp: number;
}

export interface OrderBookLevel { price: number; size: number }
export interface OrderBook {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: number;
}

export interface FuturesSymbolInfo {
  symbol: string;            // normalized "BTC/USDT"
  exchangeSymbol: string;    // raw exchange symbol e.g. "BTCUSDT" or "BTC-USDT-SWAP"
  baseAsset: string;
  quoteAsset: string;
  marketType: MarketType;
  contractType?: "perpetual" | "delivery";
  minOrderSize: number;      // base units
  minNotional: number;       // quote units
  stepSize: number;
  tickSize: number;
  maxLeverage: number;       // exchange-side cap (we apply system 5x cap on top)
  isActive: boolean;
}

export interface FundingRate {
  symbol: string;
  rate: number;        // last funding rate
  nextFundingTime?: number;
  timestamp: number;
}

export interface BalanceSummary {
  asset: string;
  total: number;
  available: number;
  used: number;
}

export interface ExchangePosition {
  symbol: string;
  direction: PositionDirection;
  size: number;
  entryPrice: number;
  leverage: number;
  marginMode: MarginMode;
  unrealizedPnl: number;
  liquidationPrice?: number;
}

export interface PlaceFuturesOrderPayload {
  symbol: string;
  direction: PositionDirection;
  positionSize: number;       // base units
  leverage: number;
  marginMode: MarginMode;
  stopLoss: number;
  takeProfit: number;
  reduceOnly?: boolean;
  clientOrderId?: string;
}

export interface RateLimitStatus {
  remaining: number;
  reset: number;       // ms timestamp
  used: number;
  limit: number;
}

export interface CredentialValidation {
  ok: boolean;
  reason?: string;
  permissions?: string[];
  hasWithdrawPermission?: boolean;
}

export interface ExchangeAdapter {
  getExchangeName(): ExchangeName;

  // Symbol catalog
  getSymbols(): Promise<string[]>;
  getAllTickers(): Promise<Ticker[]>;
  getFuturesSymbols(): Promise<FuturesSymbolInfo[]>;
  getExchangeInfo(symbol: string): Promise<FuturesSymbolInfo | null>;
  getMinOrderSize(symbol: string): Promise<number>;
  getMaxLeverage(symbol: string): Promise<number>;
  getTickSize(symbol: string): Promise<number>;
  getStepSize(symbol: string): Promise<number>;

  // Market data
  getKlines(symbol: string, timeframe: Timeframe, limit?: number): Promise<Kline[]>;
  getTicker(symbol: string): Promise<Ticker>;
  getOrderBook(symbol: string, depth?: number): Promise<OrderBook>;
  getFundingRate(symbol: string): Promise<FundingRate | null>;

  // Account
  getBalance(): Promise<BalanceSummary[]>;
  getOpenPositions(): Promise<ExchangePosition[]>;

  // Liquidation estimator
  getEstimatedLiquidationPrice(payload: {
    symbol: string;
    direction: PositionDirection;
    entryPrice: number;
    leverage: number;
    marginMode: MarginMode;
  }): Promise<number>;

  // Trading
  setLeverage(symbol: string, leverage: number, marginMode: MarginMode): Promise<void>;
  placeFuturesOrder(payload: PlaceFuturesOrderPayload): Promise<{ orderId: string }>;
  cancelOrder(orderId: string, symbol: string): Promise<void>;
  closePosition(symbol: string): Promise<void>;

  // Streams
  subscribeTicker(symbols: string[], onTick: (t: Ticker) => void): () => void;
  subscribeKlines(
    symbols: string[],
    timeframe: Timeframe,
    onKline: (k: { symbol: string; kline: Kline }) => void
  ): () => void;
  disconnectWebSocket(): void;

  // Diagnostics
  getRateLimitStatus(): RateLimitStatus;
  validateApiCredentials(): Promise<CredentialValidation>;
}
