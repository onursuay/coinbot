// Faz 16 — Triple-gate fail-closed guard.
// Tüm koşullar sağlansa bile execution bu fazda engellenir.
// Gerçek Binance çağrısı için tüm üç kapının da açık olması gerekir:
//   1. HARD_LIVE_TRADING_ALLOWED=true (env)
//   2. trading_mode='live' (DB)
//   3. enable_live_trading=true (DB)

import { env } from "@/lib/env";
import type {
  LiveOrderRequest,
  LiveExecutionGuardResult,
  LiveExecutionMode,
} from "./types";

const MIN_SIGNAL_SCORE = 70;
const MIN_RR_RATIO = 2;

const BLOCKED_ENV: LiveExecutionGuardResult = {
  allowed: false,
  reason: "HARD_LIVE_TRADING_ALLOWED env flag is false — live execution permanently disabled in this environment",
  gate: "env_hard_gate",
};

const BLOCKED_DB_MODE: LiveExecutionGuardResult = {
  allowed: false,
  reason: "DB trading_mode is not 'live'",
  gate: "db_trading_mode",
};

const BLOCKED_DB_ENABLE: LiveExecutionGuardResult = {
  allowed: false,
  reason: "DB enable_live_trading is not true",
  gate: "db_enable_live_trading",
};

export function checkLiveExecutionGuard(
  req: LiveOrderRequest,
  mode: LiveExecutionMode,
): LiveExecutionGuardResult {
  // Gate 1: env hard gate (immutable — env var cannot be overridden by DB)
  if (!env.hardLiveTradingAllowed) return BLOCKED_ENV;

  // Gate 2: DB trading_mode
  if (mode.dbTradingMode !== "live") return BLOCKED_DB_MODE;

  // Gate 3: DB enable_live_trading
  if (!mode.dbEnableLiveTrading) return BLOCKED_DB_ENABLE;

  // Request-level checks
  if (req.tradeMode !== "live") {
    return { allowed: false, reason: "Request tradeMode is not 'live'", gate: "req_trade_mode" };
  }
  if (req.executionType !== "real") {
    return { allowed: false, reason: "Request executionType is not 'real'", gate: "req_execution_type" };
  }
  if (req.tradeSignalScore < MIN_SIGNAL_SCORE) {
    return { allowed: false, reason: `Signal score ${req.tradeSignalScore} below minimum ${MIN_SIGNAL_SCORE}`, gate: "signal_score" };
  }
  if (!req.stopLoss || req.stopLoss <= 0) {
    return { allowed: false, reason: "stopLoss is missing or invalid", gate: "stop_loss" };
  }
  if (!req.takeProfit || req.takeProfit <= 0) {
    return { allowed: false, reason: "takeProfit is missing or invalid", gate: "take_profit" };
  }
  if (req.rrRatio < MIN_RR_RATIO) {
    return { allowed: false, reason: `rrRatio ${req.rrRatio} below minimum ${MIN_RR_RATIO}`, gate: "rr_ratio" };
  }
  if (!req.symbol || req.symbol.trim().length === 0) {
    return { allowed: false, reason: "symbol is missing", gate: "symbol" };
  }
  if (!req.quantity || req.quantity <= 0) {
    return { allowed: false, reason: "quantity must be > 0", gate: "quantity" };
  }
  if (!req.clientOrderId || req.clientOrderId.trim().length === 0) {
    return { allowed: false, reason: "clientOrderId is missing", gate: "client_order_id" };
  }

  return { allowed: true, reason: "All gates passed", gate: "all_passed" };
}
