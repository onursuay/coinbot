// Faz 16 — Live Execution Adapter Skeleton
// Bu fazda gerçek Binance order endpoint çağrısı yapılmaz.
// Tüm tipler ve guard altyapısı kurulur; execution her zaman engellenir.

export type TradeSide = "LONG" | "SHORT";
export type EntryType = "MARKET" | "LIMIT";
export type TradeMode = "paper" | "live";
export type ExecutionType = "real" | "simulated";

export interface LiveOrderRequest {
  symbol: string;
  side: TradeSide;
  quantity: number;
  leverage: number;
  entryType: EntryType;
  stopLoss: number;
  takeProfit: number;
  clientOrderId: string;
  tradeSignalScore: number;
  rrRatio: number;
  sourceDisplay: string;
  tradeMode: TradeMode;
  executionType: ExecutionType;
}

export interface LiveCloseRequest {
  symbol: string;
  side: TradeSide;
  quantity: number;
  clientOrderId: string;
  tradeMode: TradeMode;
  executionType: ExecutionType;
  closeReason: string;
}

export type LiveExecutionStatus =
  | "blocked"
  | "not_implemented"
  | "success"
  | "error";

export interface LiveExecutionGuardResult {
  allowed: boolean;
  reason: string;
  gate: string;
}

export interface LiveOrderResult {
  status: LiveExecutionStatus;
  guardResult: LiveExecutionGuardResult;
  orderId?: string;
  message: string;
  executedAt?: string;
}

export interface LiveExecutionMode {
  hardLiveAllowed: boolean;
  dbTradingMode: string | null;
  dbEnableLiveTrading: boolean | null;
}

export const LIVE_EXECUTION_NOT_IMPLEMENTED = "LIVE_EXECUTION_NOT_IMPLEMENTED" as const;
