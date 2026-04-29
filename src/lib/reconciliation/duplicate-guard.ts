// Faz 18 — Duplicate position / clientOrderId guards (saf fonksiyonlar).
// Live execution açıldığında ileride emir göndermeden önce çağrılacak.
// Bu fazda sadece test edilebilir saf fonksiyonlar.

import crypto from "node:crypto";
import type { DbTradeSnapshot, TradeSide } from "./types";

export interface DuplicateCheckResult {
  duplicate: boolean;
  reason: string | null;
  conflictingDbId: string | null;
}

export function detectDuplicateOpenPosition(
  symbol: string,
  side: TradeSide,
  openTrades: DbTradeSnapshot[],
): DuplicateCheckResult {
  const sym = symbol.toUpperCase();
  for (const t of openTrades) {
    if (t.status !== "open") continue;
    if (t.symbol.toUpperCase() === sym && t.side === side) {
      return {
        duplicate: true,
        reason: `Aynı ${sym} ${side} için açık pozisyon zaten var`,
        conflictingDbId: t.id,
      };
    }
  }
  return { duplicate: false, reason: null, conflictingDbId: null };
}

const COID_PREFIX = "cb"; // CoinBot

export function buildClientOrderId(
  symbol: string,
  side: TradeSide,
  timestamp: number = Date.now(),
): string {
  // Binance Futures clientOrderId limit ≈ 36 chars; safe alphanumeric only.
  const sym = symbol.replace(/[^A-Za-z0-9]/g, "").slice(0, 10).toUpperCase();
  const sideTag = side === "LONG" ? "L" : "S";
  const tail = crypto.randomBytes(4).toString("hex");
  const ts = String(timestamp).slice(-10);
  return `${COID_PREFIX}-${sym}-${sideTag}-${ts}-${tail}`;
}

export function validateClientOrderIdUniqueness(
  clientOrderId: string,
  openTrades: DbTradeSnapshot[],
): { unique: boolean; conflictingDbId: string | null } {
  if (!clientOrderId || clientOrderId.trim().length === 0) {
    return { unique: false, conflictingDbId: null };
  }
  for (const t of openTrades) {
    if (t.clientOrderId && t.clientOrderId === clientOrderId) {
      return { unique: false, conflictingDbId: t.id };
    }
  }
  return { unique: true, conflictingDbId: null };
}
