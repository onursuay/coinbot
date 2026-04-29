// Faz 16 — Mock adapter (test only).
// Deterministic, no network calls, no Supabase.
// Sadece testlerde kullanılır; worker/production kodunda import edilmez.

import { checkLiveExecutionGuard } from "./guard";
import type {
  LiveOrderRequest,
  LiveOrderResult,
  LiveExecutionMode,
} from "./types";

export function mockOpenLiveOrder(
  req: LiveOrderRequest,
  mode: LiveExecutionMode,
  overrides?: { forceAllow?: boolean; mockOrderId?: string },
): LiveOrderResult {
  const guardResult = overrides?.forceAllow
    ? { allowed: true, reason: "mock override", gate: "mock" }
    : checkLiveExecutionGuard(req, mode);

  if (!guardResult.allowed) {
    return {
      status: "blocked",
      guardResult,
      message: `Mock blocked: ${guardResult.reason}`,
    };
  }

  if (overrides?.forceAllow && overrides?.mockOrderId) {
    return {
      status: "success",
      guardResult,
      orderId: overrides.mockOrderId,
      message: "Mock order executed (test only)",
      executedAt: new Date().toISOString(),
    };
  }

  return {
    status: "not_implemented",
    guardResult,
    message: "LIVE_EXECUTION_NOT_IMPLEMENTED",
  };
}

export function buildMockMode(over: Partial<LiveExecutionMode> = {}): LiveExecutionMode {
  return {
    hardLiveAllowed: false,
    dbTradingMode: "paper",
    dbEnableLiveTrading: false,
    ...over,
  };
}
