// Runtime environment validation. Reports missing/empty required variables
// without ever leaking secret values back to callers.

import { env, SYSTEM_HARD_LEVERAGE_CAP } from "@/lib/env";

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CREDENTIAL_ENCRYPTION_KEY",
] as const;

const RECOMMENDED_NUMERIC = [
  "MAX_LEVERAGE",
  "MAX_ALLOWED_LEVERAGE",
] as const;

const RECOMMENDED_BOOL = ["LIVE_TRADING"] as const;

export interface EnvCheckResult {
  ok: boolean;
  missing: string[];
  empty: string[];
  warnings: string[];
  effectiveConfig: {
    liveTrading: boolean;
    defaultTradingMode: string;
    defaultMarketType: string;
    defaultMarginMode: string;
    defaultActiveExchange: string;
    maxLeverage: number;
    maxAllowedLeverage: number;
    hardCap: number;
  };
}

function presence(name: string): "missing" | "empty" | "ok" {
  const v = process.env[name];
  if (v === undefined) return "missing";
  if (v.trim().length === 0) return "empty";
  return "ok";
}

export function checkEnv(): EnvCheckResult {
  const missing: string[] = [];
  const empty: string[] = [];
  const warnings: string[] = [];

  for (const k of REQUIRED) {
    const p = presence(k);
    if (p === "missing") missing.push(k);
    else if (p === "empty") empty.push(k);
  }

  for (const k of RECOMMENDED_NUMERIC) {
    const p = presence(k);
    if (p !== "ok") warnings.push(`${k} not set — using default`);
  }
  for (const k of RECOMMENDED_BOOL) {
    const p = presence(k);
    if (p !== "ok") warnings.push(`${k} not set — defaulting to false`);
  }

  if (env.maxAllowedLeverage > SYSTEM_HARD_LEVERAGE_CAP) {
    warnings.push(`MAX_ALLOWED_LEVERAGE clamped to ${SYSTEM_HARD_LEVERAGE_CAP}x`);
  }
  if (env.maxLeverage > env.maxAllowedLeverage) {
    warnings.push(`MAX_LEVERAGE clamped to MAX_ALLOWED_LEVERAGE (${env.maxAllowedLeverage}x)`);
  }

  return {
    ok: missing.length === 0 && empty.length === 0,
    missing,
    empty,
    warnings,
    effectiveConfig: {
      liveTrading: env.liveTrading,
      defaultTradingMode: env.defaultTradingMode,
      defaultMarketType: env.defaultMarketType,
      defaultMarginMode: env.defaultMarginMode,
      defaultActiveExchange: env.defaultActiveExchange,
      maxLeverage: env.maxLeverage,
      maxAllowedLeverage: env.maxAllowedLeverage,
      hardCap: SYSTEM_HARD_LEVERAGE_CAP,
    },
  };
}
