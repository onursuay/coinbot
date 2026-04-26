// Internal canonical format: "BTC/USDT".
// Each adapter converts to/from its native format inside the adapter only —
// the rest of the system never sees raw exchange symbols.

import type { ExchangeName } from "./types";

export function toCanonical(raw: string): string {
  if (!raw) return raw;
  if (raw.includes("/")) return raw.toUpperCase();
  if (raw.includes("-")) {
    const [base, quote] = raw.split("-");
    return `${base.toUpperCase()}/${(quote ?? "USDT").toUpperCase()}`;
  }
  // BTCUSDT-style
  const upper = raw.toUpperCase();
  for (const q of ["USDT", "USDC", "USD", "BUSD"]) {
    if (upper.endsWith(q)) {
      return `${upper.slice(0, -q.length)}/${q}`;
    }
  }
  return upper;
}

export function fromCanonical(symbol: string, exchange: ExchangeName): string {
  const [base, quote] = symbol.split("/");
  const b = (base ?? symbol).toUpperCase();
  const q = (quote ?? "USDT").toUpperCase();
  switch (exchange) {
    case "binance":
    case "mexc":
    case "bybit":
      return `${b}${q}`;
    case "okx":
      return `${b}-${q}-SWAP`;
  }
}

export function quoteOf(symbol: string): string {
  const [, quote] = symbol.split("/");
  return (quote ?? "USDT").toUpperCase();
}
export function baseOf(symbol: string): string {
  const [base] = symbol.split("/");
  return (base ?? symbol).toUpperCase();
}
