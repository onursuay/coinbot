// Centralized environment access with safe defaults.
// Empty strings ("") are treated as MISSING — fallback to default.
// Numeric values that fail to parse are clamped to safe defaults.
// Leverage values are hard-clamped to SYSTEM_HARD_LEVERAGE_CAP.
//
// PHILOSOPHY: ENV is for HARD SAFETY GATES and SYSTEM DEFAULTS only.
// Day-to-day paper/live mode toggling is done via dashboard → bot_settings.
// For live trading to occur, ALL THREE must be true:
//   1. HARD_LIVE_TRADING_ALLOWED=true (this env)
//   2. bot_settings.trading_mode='live'
//   3. bot_settings.enable_live_trading=true

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

const list = (v: string | undefined, d: string[]): string[] => {
  if (v === undefined) return d;
  const t = v.trim();
  if (t.length === 0) return d;
  return t.split(",").map((s) => s.trim()).filter(Boolean);
};

const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));

const rawMaxAllowed = num(process.env.MAX_ALLOWED_LEVERAGE, 5);
const maxAllowedLeverage = clamp(rawMaxAllowed, 1, SYSTEM_HARD_LEVERAGE_CAP);

const rawMaxLev = num(process.env.MAX_LEVERAGE, 3);
const maxLeverage = clamp(rawMaxLev, 1, maxAllowedLeverage);

const DEFAULT_WHITELIST = [
  "BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT",
  "AVAXUSDT","LINKUSDT","DOGEUSDT","ADAUSDT","LTCUSDT",
];

export const env = {
  // ── Supabase ──
  supabaseUrl: str(process.env.NEXT_PUBLIC_SUPABASE_URL, ""),
  supabaseAnonKey: str(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, ""),
  supabaseServiceRoleKey: str(process.env.SUPABASE_SERVICE_ROLE_KEY, ""),

  // ── Credential encryption ──
  credentialEncryptionKey: str(process.env.CREDENTIAL_ENCRYPTION_KEY, ""),

  // ── HARD SAFETY GATES (env is the FINAL line of defense; cannot be overridden by DB) ──
  // Live trading: requires hardLiveTradingAllowed=true + DB.trading_mode='live' + DB.enable_live_trading=true
  hardLiveTradingAllowed: bool(process.env.HARD_LIVE_TRADING_ALLOWED, false),
  liveTrading: bool(process.env.LIVE_TRADING, false),  // legacy alias — same gate
  killSwitchEnabled: bool(process.env.KILL_SWITCH_ENABLED, true),

  // ── System defaults (used on first DB row creation only) ──
  defaultTradingMode: str(process.env.DEFAULT_TRADING_MODE, "paper") as "paper" | "live",
  defaultMarketType: str(process.env.DEFAULT_MARKET_TYPE, "futures") as "futures" | "spot",
  defaultMarginMode: str(process.env.DEFAULT_MARGIN_MODE, "isolated") as "isolated" | "cross",
  defaultActiveExchange: str(process.env.DEFAULT_ACTIVE_EXCHANGE ?? process.env.DEFAULT_EXCHANGE, "binance").toLowerCase(),

  // ── Leverage / risk caps ──
  maxLeverage,
  maxAllowedLeverage,
  maxRiskPerTradePercent: num(process.env.MAX_RISK_PER_TRADE_PERCENT, 1),
  maxDailyLossPercent: num(process.env.MAX_DAILY_LOSS_PERCENT, 3),
  maxWeeklyLossPercent: num(process.env.MAX_WEEKLY_LOSS_PERCENT, 10),
  dailyProfitTargetUsd: num(process.env.DAILY_PROFIT_TARGET_USD, 20),
  maxDailyProfitTargetUsd: num(process.env.MAX_DAILY_PROFIT_TARGET_USD, 50),
  maxOpenPositions: num(process.env.MAX_OPEN_POSITIONS, 2),
  minRiskRewardRatio: num(process.env.MIN_RISK_REWARD_RATIO, 2),
  maxConsecutiveLosses: num(process.env.MAX_CONSECUTIVE_LOSSES, 3),
  minStrategyHealthScoreToTrade: num(process.env.MIN_STRATEGY_HEALTH_SCORE_TO_TRADE, 60),

  // ── Whitelist (used as initial seed for bot_settings.allowed_symbols) ──
  allowedSymbols: list(process.env.ALLOWED_SYMBOLS, DEFAULT_WHITELIST),

  // ── Exchange credentials (server-only) ──
  exchanges: {
    binance: {
      key: str(process.env.BINANCE_API_KEY, ""),
      secret: str(process.env.BINANCE_API_SECRET, ""),
      futuresBaseUrl: str(process.env.BINANCE_FUTURES_BASE_URL, "https://fapi.binance.com"),
      futuresWsUrl: str(process.env.BINANCE_FUTURES_WS_URL, "wss://fstream.binance.com"),
    },
    mexc: { key: str(process.env.MEXC_API_KEY, ""), secret: str(process.env.MEXC_API_SECRET, "") },
    okx: {
      key: str(process.env.OKX_API_KEY, ""),
      secret: str(process.env.OKX_API_SECRET, ""),
      passphrase: str(process.env.OKX_API_PASSPHRASE, ""),
    },
    bybit: { key: str(process.env.BYBIT_API_KEY, ""), secret: str(process.env.BYBIT_API_SECRET, "") },
  },

  // ── LLM analysis (analysis only — never executes orders) ──
  llm: {
    enabled: bool(process.env.LLM_ENABLED, false),
    provider: str(process.env.LLM_PROVIDER, "openai"),
    model: str(process.env.LLM_MODEL, "gpt-4o-mini"),
    apiKey: str(process.env.LLM_API_KEY, ""),
  },

  // ── Dynamic Universe v2 ──
  dynamicAnalysisLimit: num(process.env.DYNAMIC_ANALYSIS_LIMIT, 30),

  // ── Phase 7: Unified Candidate Pool — paper-mode controlled rollout ──
  // Feature flag default flipped to true in Phase 7. The flag alone is NOT
  // sufficient to activate the unified pool: the worker also requires the
  // paper-mode safety gate (HARD_LIVE_TRADING_ALLOWED=false + DB
  // trading_mode='paper' + enable_live_trading=false). When the gate is
  // open (any live indicator present), the worker silently falls back to
  // the legacy core-only/dynamic-universe path — orchestrator is never
  // invoked. See bot-orchestrator → isUnifiedPoolPaperSafe.
  // Set to false to disable the unified path entirely (regression escape).
  useUnifiedCandidatePool: bool(process.env.USE_UNIFIED_CANDIDATE_POOL, true),
  // Hard cap on candidates handed from the orchestrator to deep analysis per
  // tick. Mirrors DEFAULT_MARKET_UNIVERSE_CONFIG.deepAnalysisMax (30).
  unifiedDeepAnalysisMax: num(process.env.UNIFIED_DEEP_ANALYSIS_MAX, 30),
  // Worker-side unified pool refresh interval. Kept independent from the
  // candidate-pool snapshot endpoint cache. Default 120s (2 min).
  unifiedCandidateRefreshIntervalSec: num(process.env.UNIFIED_CANDIDATE_REFRESH_INTERVAL_SEC, 120),

  // ── Aggressive Paper Test Mode ──
  // All flags are paper-only: HARD_LIVE_TRADING_ALLOWED=true OR trading_mode=live disables them.
  aggressivePaperTestMode: bool(process.env.AGGRESSIVE_PAPER_TEST_MODE, false),
  aggressiveMinSignalScore: num(process.env.AGGRESSIVE_MIN_SIGNAL_SCORE, 45),
  aggressiveMinMarketQuality: num(process.env.AGGRESSIVE_MIN_MARKET_QUALITY, 25),
  aggressiveMaxTradesPerDay: num(process.env.AGGRESSIVE_MAX_TRADES_PER_DAY, 20),
  aggressiveMaxOpenPositions: num(process.env.AGGRESSIVE_MAX_OPEN_POSITIONS, 5),
  aggressiveAllowBtcFilterBypass: bool(process.env.AGGRESSIVE_ALLOW_BTC_FILTER_BYPASS, true),
  aggressiveAllowMarketQualityBypass: bool(process.env.AGGRESSIVE_ALLOW_MARKET_QUALITY_BYPASS, true),

  // ── Worker identity (for heartbeat) ──
  workerId: str(process.env.WORKER_ID, "vercel-default"),

  // ── Log retention / cleanup ──
  logRetentionEnabled: bool(process.env.LOG_RETENTION_ENABLED, true),
  logCleanupIntervalHours: num(process.env.LOG_CLEANUP_INTERVAL_HOURS, 24),

  // ── Monitoring reports ──
  reportEmailEnabled: bool(process.env.REPORT_EMAIL_ENABLED, false),
  reportEmailIntervalMinutes: num(process.env.REPORT_EMAIL_INTERVAL_MINUTES, 30),
  reportEmailTo: str(process.env.REPORT_EMAIL_TO, "onursuay@hotmail.com"),
  smtp: {
    host: str(process.env.SMTP_HOST, ""),
    port: num(process.env.SMTP_PORT, 587),
    user: str(process.env.SMTP_USER, ""),
    pass: str(process.env.SMTP_PASS, ""),   // never log this value
    from: str(process.env.SMTP_FROM, ""),
  },
};

// Quick check: are we allowed to even consider live trading at the env layer?
export function isHardLiveAllowed(): boolean {
  return env.hardLiveTradingAllowed === true || env.liveTrading === true;
}
