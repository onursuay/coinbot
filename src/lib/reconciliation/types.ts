// Faz 18 — DB / exchange reconciliation tipleri.
// Saf veri tipleri; hiçbir Binance private/order endpoint çağrısı yok.

export type TradeSide = "LONG" | "SHORT";

export type ReconciliationSeverity = "info" | "warning" | "critical";

export type ReconciliationIssueCode =
  | "DB_OPEN_EXCHANGE_MISSING"
  | "EXCHANGE_OPEN_DB_MISSING"
  | "SIZE_MISMATCH"
  | "SIDE_MISMATCH"
  | "PRICE_MISMATCH"
  | "STATUS_MISMATCH"
  | "DUPLICATE_OPEN_POSITION"
  | "UNKNOWN";

export interface ExchangePositionSnapshot {
  symbol: string;
  side: TradeSide;
  quantity: number;
  entryPrice: number;
  status: "open" | "closed";
}

export interface DbTradeSnapshot {
  id: string;
  symbol: string;
  side: TradeSide;
  quantity: number;
  entryPrice: number;
  status: "open" | "closed";
  clientOrderId?: string | null;
}

export interface ReconciliationIssue {
  code: ReconciliationIssueCode;
  severity: ReconciliationSeverity;
  symbol: string;
  side?: TradeSide;
  message: string;
  dbId?: string | null;
}

export interface ReconciliationResult {
  ok: boolean;
  issueCount: number;
  criticalCount: number;
  issues: ReconciliationIssue[];
  generatedAt: string;
}

// Tolerances for numeric comparison.
export const SIZE_TOLERANCE_PCT = 0.5;     // 0.5%
export const PRICE_TOLERANCE_PCT = 0.5;    // 0.5%
