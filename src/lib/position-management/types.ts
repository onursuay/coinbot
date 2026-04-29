// Faz 21 — Kademeli Pozisyon / Kaldıraç Yönetimi tipleri.
//
// KAPSAM: Bu modül sadece karar/metadata üretir.
//   • Gerçek emir gönderilmez.
//   • Binance private/order endpoint çağrısı yapılmaz.
//   • Kaldıraç execution yoktur.
//   • Zararda pozisyon büyütme kesinlikle önerilmez.
//   • averageDownEnabled=false invariantı korunur.

export type PositionSide = "LONG" | "SHORT";
export type PositionMode = "paper" | "live";

// Possible management actions — all advisory only; no real order execution.
export type PositionManagementAction =
  | "HOLD"
  | "MOVE_SL_TO_BREAKEVEN"
  | "PARTIAL_TAKE_PROFIT"
  | "ENABLE_TRAILING_STOP"
  | "TIGHTEN_TRAILING_STOP"
  | "CONSIDER_PROFIT_SCALE_IN"
  | "EXIT_FULL"
  | "EXIT_PARTIAL"
  | "NO_ACTION"
  | "BLOCK_SCALE_IN_LOSING_POSITION";

// R-multiple stage buckets.
export type ProgressiveStage =
  | "losing"        // < 0R
  | "breakeven"     // 0R – 0.5R
  | "early_profit"  // 0.5R – 1R
  | "at_1r"         // 1R – 1.5R
  | "at_1_5r"       // 1.5R – 2R
  | "at_2r_plus";   // >= 2R

export interface PositionManagementInput {
  symbol: string;
  side: PositionSide;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  quantity: number;
  notionalUsdt: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  rrRatio: number;
  riskAmountUsdt: number;
  /** Optional — computed internally when not provided. */
  currentRMultiple?: number;
  tradeSignalScore: number;
  setupScore: number;
  marketQualityScore: number;
  btcAligned: boolean;
  volumeImpulse: boolean;
  atrPercentile?: number;
  adx?: number;
  sourceDisplay?: string;
  openedAt: string;
  mode: PositionMode;
}

export interface TrailingStopState {
  trailingStopRecommended: boolean;
  /** Recommended new SL level — advisory only, no real order. */
  recommendedStopLoss: number | null;
  stopMoveReason: string | null;
  stopShouldNotMoveReason: string | null;
}

export interface ScaleDecision {
  scaleInAllowed: boolean;
  scaleInBlockedReason: string | null;
  considerScaleIn: boolean;
}

export interface PositionManagementDecision {
  symbol: string;
  side: PositionSide;
  action: PositionManagementAction;
  actionPriority: "high" | "medium" | "low" | "none";
  currentRMultiple: number;
  stage: ProgressiveStage;
  /** Recommended SL — advisory only. */
  recommendedStopLoss: number | null;
  /** Partial TP % — advisory only. */
  recommendedPartialTakeProfitPercent: number | null;
  scaleInAllowed: boolean;
  scaleInBlockedReason: string | null;
  trailingStopRecommended: boolean;
  explanation: string;
  warnings: string[];
  isLive: boolean;
  mode: PositionMode;
}
