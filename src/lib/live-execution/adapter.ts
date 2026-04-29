// Faz 16 — Real adapter stub.
// Bu fazda Binance private order endpoint çağrısı YAPILMAZ.
// Guard açık olsa bile LIVE_EXECUTION_NOT_IMPLEMENTED döner.
// Gerçek implementation gelecek bir fazda buraya eklenecek.

import { checkLiveExecutionGuard } from "./guard";
import type {
  LiveOrderRequest,
  LiveOrderResult,
  LiveExecutionMode,
} from "./types";
import { LIVE_EXECUTION_NOT_IMPLEMENTED } from "./types";

export async function openLiveOrder(
  req: LiveOrderRequest,
  mode: LiveExecutionMode,
): Promise<LiveOrderResult> {
  const guardResult = checkLiveExecutionGuard(req, mode);

  if (!guardResult.allowed) {
    return {
      status: "blocked",
      guardResult,
      message: `Live order blocked: ${guardResult.reason}`,
    };
  }

  // Guard passed — but real Binance execution is not implemented in Faz 16.
  // No fetch or private exchange API calls are made here.
  return {
    status: "not_implemented",
    guardResult,
    message: LIVE_EXECUTION_NOT_IMPLEMENTED,
  };
}
