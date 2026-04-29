// Faz 17 — Binance credential validator (read-only).
//
// GUARDRAILS:
//   - No order endpoint may be called from this file. Ever.
//   - No POST/PUT/DELETE to private trading endpoints.
//   - Secrets never appear in returned values, logs, or error messages.
//   - Only public read endpoints + (optional) signed read of /fapi/v2/account.
//
// If the project later wants the actual private account read, the signed call
// is gated to a single read-only endpoint and built defensively.

import crypto from "node:crypto";
import { env } from "@/lib/env";
import type {
  CredentialPresence,
  FuturesAccessResult,
} from "./types";

const FUTURES_ACCOUNT_PATH = "/fapi/v2/account";  // READ-ONLY
const FUTURES_TIME_PATH = "/fapi/v1/time";        // PUBLIC

export function maskApiKey(raw: string): string | null {
  const t = String(raw ?? "").trim();
  if (t.length === 0) return null;
  if (t.length <= 8) return `${"*".repeat(t.length)}`;
  return `${t.slice(0, 4)}${"*".repeat(Math.max(4, t.length - 8))}${t.slice(-4)}`;
}

export function checkCredentialPresence(): CredentialPresence {
  const apiKey = env.exchanges.binance.key;
  const apiSecret = env.exchanges.binance.secret;
  const baseUrl = env.exchanges.binance.futuresBaseUrl;
  const usingTestnet = baseUrl.includes("testnet");
  const apiKeyPresent = apiKey.trim().length > 0;
  const apiSecretPresent = apiSecret.trim().length > 0;
  return {
    apiKeyPresent,
    apiSecretPresent,
    apiKeyMasked: apiKeyPresent ? maskApiKey(apiKey) : null,
    baseUrl,
    usingTestnet,
    credentialConfigured: apiKeyPresent && apiSecretPresent,
  };
}

function safeErrorMessage(e: unknown): string {
  const msg = String((e as any)?.message ?? e ?? "unknown error");
  // Strip anything that resembles a secret/signature/key from messages.
  return msg
    .replace(/signature=[^&\s]+/gi, "signature=***")
    .replace(/secret[^,\s]*/gi, "secret=***")
    .replace(/[A-Za-z0-9]{40,}/g, "***")
    .slice(0, 240);
}

async function pingFuturesPublicTime(baseUrl: string): Promise<{ ok: boolean; err?: string }> {
  try {
    const res = await fetch(`${baseUrl}${FUTURES_TIME_PATH}`, { method: "GET", cache: "no-store" });
    if (!res.ok) return { ok: false, err: `HTTP ${res.status}` };
    const json = (await res.json()) as { serverTime?: number };
    return { ok: typeof json?.serverTime === "number" };
  } catch (e) {
    return { ok: false, err: safeErrorMessage(e) };
  }
}

async function readFuturesAccount(
  baseUrl: string,
  apiKey: string,
  apiSecret: string,
): Promise<{ ok: boolean; errorCode: string | null; errorMessage: string | null }> {
  // Defensive: only sign GET to /fapi/v2/account. Never any other path.
  const path = FUTURES_ACCOUNT_PATH;
  const recvWindow = 5000;
  const timestamp = Date.now();
  const query = `recvWindow=${recvWindow}&timestamp=${timestamp}`;
  const signature = crypto.createHmac("sha256", apiSecret).update(query).digest("hex");
  const url = `${baseUrl}${path}?${query}&signature=${signature}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "X-MBX-APIKEY": apiKey },
      cache: "no-store",
    });
    if (!res.ok) {
      let code: string | null = null;
      let msg = `HTTP ${res.status}`;
      try {
        const body: any = await res.json();
        if (body?.code) code = String(body.code);
        if (body?.msg) msg = safeErrorMessage(body.msg);
      } catch {
        /* non-JSON error body ignored */
      }
      return { ok: false, errorCode: code, errorMessage: msg };
    }
    return { ok: true, errorCode: null, errorMessage: null };
  } catch (e) {
    return { ok: false, errorCode: "network_error", errorMessage: safeErrorMessage(e) };
  }
}

export async function validateFuturesAccess(): Promise<FuturesAccessResult> {
  const presence = checkCredentialPresence();
  const lastCheckedAt = new Date().toISOString();

  if (!presence.credentialConfigured) {
    return {
      futuresAccessOk: false,
      accountReadOk: false,
      permissionError: "credential_missing",
      errorCode: "credential_missing",
      errorMessageSafe: "Binance API key/secret tanımlı değil.",
      lastCheckedAt,
    };
  }

  const ping = await pingFuturesPublicTime(presence.baseUrl);
  if (!ping.ok) {
    return {
      futuresAccessOk: false,
      accountReadOk: false,
      permissionError: "futures_unreachable",
      errorCode: "futures_unreachable",
      errorMessageSafe: `Futures public endpoint erişilemedi: ${ping.err ?? "?"}`.slice(0, 240),
      lastCheckedAt,
    };
  }

  const account = await readFuturesAccount(
    presence.baseUrl,
    env.exchanges.binance.key,
    env.exchanges.binance.secret,
  );

  if (!account.ok) {
    return {
      futuresAccessOk: true,
      accountReadOk: false,
      permissionError: account.errorCode ?? "account_read_failed",
      errorCode: account.errorCode,
      errorMessageSafe: account.errorMessage,
      lastCheckedAt,
    };
  }

  return {
    futuresAccessOk: true,
    accountReadOk: true,
    permissionError: null,
    errorCode: null,
    errorMessageSafe: null,
    lastCheckedAt,
  };
}
