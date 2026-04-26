// Shared HTTP helper with timeout and exponential backoff w/ jitter for 429/418/5xx.

export class ExchangeHttpError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, msg?: string) {
    super(msg ?? `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

export interface FetchOpts {
  timeoutMs?: number;
  maxRetries?: number;
  init?: RequestInit;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchJson<T = any>(url: string, opts: FetchOpts = {}): Promise<T> {
  const { timeoutMs = 12_000, maxRetries = 3, init = {} } = opts;
  let attempt = 0;
  let lastErr: unknown;
  while (attempt <= maxRetries) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
      clearTimeout(timer);
      const text = await res.text();
      if (res.status === 429 || res.status === 418 || res.status >= 500) {
        throw new ExchangeHttpError(res.status, text);
      }
      if (!res.ok) {
        throw new ExchangeHttpError(res.status, text);
      }
      try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      const status = e instanceof ExchangeHttpError ? e.status : 0;
      const retryable = status === 429 || status === 418 || status >= 500 || status === 0;
      if (!retryable || attempt === maxRetries) break;
      const base = Math.min(8_000, 250 * 2 ** attempt);
      const jitter = Math.random() * base;
      await sleep(base + jitter);
      attempt++;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("fetch failed");
}
