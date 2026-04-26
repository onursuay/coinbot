import type { ExchangeAdapter, ExchangeName } from "./types";
import { MexcAdapter } from "./adapters/mexc.adapter";
import { BinanceAdapter } from "./adapters/binance.adapter";
import { OkxAdapter } from "./adapters/okx.adapter";
import { BybitAdapter } from "./adapters/bybit.adapter";

const cache = new Map<ExchangeName, ExchangeAdapter>();

export function getAdapter(name: ExchangeName | string): ExchangeAdapter {
  const key = (name as string).toLowerCase() as ExchangeName;
  const cached = cache.get(key);
  if (cached) return cached;
  let adapter: ExchangeAdapter;
  switch (key) {
    case "mexc": adapter = new MexcAdapter(); break;
    case "binance": adapter = new BinanceAdapter(); break;
    case "okx": adapter = new OkxAdapter(); break;
    case "bybit": adapter = new BybitAdapter(); break;
    default: throw new Error(`Unsupported exchange: ${name}`);
  }
  cache.set(key, adapter);
  return adapter;
}

export const SUPPORTED_EXCHANGES: ExchangeName[] = ["mexc", "binance", "okx", "bybit"];
