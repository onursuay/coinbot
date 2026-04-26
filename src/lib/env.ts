// Centralized environment access with safe defaults.
// Secrets are read on the server only — never re-export to the client.

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const bool = (v: string | undefined, d: boolean) => {
  if (v === undefined) return d;
  return v.toLowerCase() === "true" || v === "1";
};

export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",

  credentialEncryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY ?? "",

  liveTrading: bool(process.env.LIVE_TRADING, false),
  defaultTradingMode: (process.env.DEFAULT_TRADING_MODE ?? "paper") as "paper" | "live",
  defaultMarketType: (process.env.DEFAULT_MARKET_TYPE ?? "futures") as "futures" | "spot",
  defaultMarginMode: (process.env.DEFAULT_MARGIN_MODE ?? "isolated") as "isolated" | "cross",
  defaultActiveExchange: (process.env.DEFAULT_ACTIVE_EXCHANGE ?? "mexc").toLowerCase(),

  maxLeverage: num(process.env.MAX_LEVERAGE, 3),
  maxAllowedLeverage: num(process.env.MAX_ALLOWED_LEVERAGE, 5),
  maxRiskPerTradePercent: num(process.env.MAX_RISK_PER_TRADE_PERCENT, 1),
  maxDailyLossPercent: num(process.env.MAX_DAILY_LOSS_PERCENT, 5),
  maxWeeklyLossPercent: num(process.env.MAX_WEEKLY_LOSS_PERCENT, 10),
  dailyProfitTargetUsd: num(process.env.DAILY_PROFIT_TARGET_USD, 20),
  maxDailyProfitTargetUsd: num(process.env.MAX_DAILY_PROFIT_TARGET_USD, 50),
  maxOpenPositions: num(process.env.MAX_OPEN_POSITIONS, 2),
  minRiskRewardRatio: num(process.env.MIN_RISK_REWARD_RATIO, 2),

  exchanges: {
    mexc: { key: process.env.MEXC_API_KEY ?? "", secret: process.env.MEXC_API_SECRET ?? "" },
    binance: { key: process.env.BINANCE_API_KEY ?? "", secret: process.env.BINANCE_API_SECRET ?? "" },
    okx: {
      key: process.env.OKX_API_KEY ?? "",
      secret: process.env.OKX_API_SECRET ?? "",
      passphrase: process.env.OKX_API_PASSPHRASE ?? "",
    },
    bybit: { key: process.env.BYBIT_API_KEY ?? "", secret: process.env.BYBIT_API_SECRET ?? "" },
  },
};

// HARD INVARIANT: leverage cap may never exceed 5x.
export const SYSTEM_HARD_LEVERAGE_CAP = 5;
