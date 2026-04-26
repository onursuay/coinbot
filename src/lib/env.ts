// Centralized environment access with safe defaults.
// Empty strings ("") are treated as MISSING — fallback to default.
// Numeric values that fail to parse are clamped to safe defaults.
// Leverage values are hard-clamped to SYSTEM_HARD_LEVERAGE_CAP.

export const SYSTEM_HARD_LEVERAGE_CAP = 5;

const str = (v: string | undefined, d: string): string => {
  if (v === undefined) return d;
  const t = v.trim();
  return t.length === 0 ? d : t;
};

const num = (v: string | undefined, d: number): number => {
  if (v === undefined) return d;
  const t = v.trim();
  if (t.length === 0) return d;
  const n = Number(t);
  return Number.isFinite(n) ? n : d;
};

const bool = (v: string | undefined, d: boolean): boolean => {
  if (v === undefined) return d;
  const t = v.trim().toLowerCase();
  if (t.length === 0) return d;
  return t === "true" || t === "1";
};

const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));

const rawMaxAllowed = num(process.env.MAX_ALLOWED_LEVERAGE, 5);
const maxAllowedLeverage = clamp(rawMaxAllowed, 1, SYSTEM_HARD_LEVERAGE_CAP);

const rawMaxLev = num(process.env.MAX_LEVERAGE, 3);
const maxLeverage = clamp(rawMaxLev, 1, maxAllowedLeverage);

export const env = {
  supabaseUrl: str(process.env.NEXT_PUBLIC_SUPABASE_URL, ""),
  supabaseAnonKey: str(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, ""),
  supabaseServiceRoleKey: str(process.env.SUPABASE_SERVICE_ROLE_KEY, ""),

  credentialEncryptionKey: str(process.env.CREDENTIAL_ENCRYPTION_KEY, ""),

  liveTrading: bool(process.env.LIVE_TRADING, false),
  defaultTradingMode: str(process.env.DEFAULT_TRADING_MODE, "paper") as "paper" | "live",
  defaultMarketType: str(process.env.DEFAULT_MARKET_TYPE, "futures") as "futures" | "spot",
  defaultMarginMode: str(process.env.DEFAULT_MARGIN_MODE, "isolated") as "isolated" | "cross",
  defaultActiveExchange: str(process.env.DEFAULT_ACTIVE_EXCHANGE, "mexc").toLowerCase(),

  maxLeverage,
  maxAllowedLeverage,
  maxRiskPerTradePercent: num(process.env.MAX_RISK_PER_TRADE_PERCENT, 1),
  maxDailyLossPercent: num(process.env.MAX_DAILY_LOSS_PERCENT, 5),
  maxWeeklyLossPercent: num(process.env.MAX_WEEKLY_LOSS_PERCENT, 10),
  dailyProfitTargetUsd: num(process.env.DAILY_PROFIT_TARGET_USD, 20),
  maxDailyProfitTargetUsd: num(process.env.MAX_DAILY_PROFIT_TARGET_USD, 50),
  maxOpenPositions: num(process.env.MAX_OPEN_POSITIONS, 2),
  minRiskRewardRatio: num(process.env.MIN_RISK_REWARD_RATIO, 2),

  exchanges: {
    mexc: { key: str(process.env.MEXC_API_KEY, ""), secret: str(process.env.MEXC_API_SECRET, "") },
    binance: { key: str(process.env.BINANCE_API_KEY, ""), secret: str(process.env.BINANCE_API_SECRET, "") },
    okx: {
      key: str(process.env.OKX_API_KEY, ""),
      secret: str(process.env.OKX_API_SECRET, ""),
      passphrase: str(process.env.OKX_API_PASSPHRASE, ""),
    },
    bybit: { key: str(process.env.BYBIT_API_KEY, ""), secret: str(process.env.BYBIT_API_SECRET, "") },
  },
};
