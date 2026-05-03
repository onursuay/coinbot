// AI Aksiyon Merkezi — Faz 2: ActionPlan tip tanımları.
//
// MUTLAK KURALLAR:
//   • ActionPlan üretimi yorumlayıcıdır, uygulayıcı değildir.
//   • Hiçbir trade engine ayarı, signal threshold, risk parametresi,
//     kaldıraç execution veya canlı trading gate kararı bu modül
//     tarafından otomatik değiştirilmez.
//   • Generator yalnızca ALLOWED_ACTION_TYPES dışında bir tip
//     ÜRETMEZ. Test/audit ile doğrulanır.
//   • Binance API çağrısı yapılmaz.

export type ActionPlanSource =
  | "performance_decision"
  | "ai_interpreter"
  | "system";

export type ActionPlanRiskLevel = "low" | "medium" | "high" | "critical";

export type ActionPlanStatus = "draft" | "ready" | "observed" | "dismissed";

/**
 * İzinli aksiyon tipleri. Generator yalnızca bu listeden ActionPlan üretir.
 *
 * Tüm tipler ya "down/safer" yönde ayar düşürme ya da gözlem/inceleme
 * önerisidir. Hiçbiri tek başına bir ayarı uygulamaz.
 */
export type ActionPlanType =
  /** İşlem başı risk yüzdesini düşürme önerisi */
  | "UPDATE_RISK_PER_TRADE_DOWN"
  /** Günlük maksimum zarar yüzdesini düşürme önerisi */
  | "UPDATE_MAX_DAILY_LOSS_DOWN"
  /** Aynı anda açık pozisyon sayısını düşürme önerisi */
  | "UPDATE_MAX_OPEN_POSITIONS_DOWN"
  /** Günlük maksimum işlem sayısını düşürme önerisi */
  | "UPDATE_MAX_DAILY_TRADES_DOWN"
  /** Gözlem moduna geç — veri yetersizse veya belirsizlik yüksekse */
  | "SET_OBSERVATION_MODE"
  /** Manuel inceleme talebi — otomatik aksiyon güvenli değilse */
  | "REQUEST_MANUAL_REVIEW"
  /** Claude Code / GitHub uygulama promptu üret (manuel uygulanır) */
  | "CREATE_IMPLEMENTATION_PROMPT";

/** Rollback kapsamındaki aksiyon tipleri — yalnızca bu 4 downward tipi geri alınabilir. */
export const ROLLBACK_ELIGIBLE_TYPES: readonly ActionPlanType[] = [
  "UPDATE_RISK_PER_TRADE_DOWN",
  "UPDATE_MAX_DAILY_LOSS_DOWN",
  "UPDATE_MAX_OPEN_POSITIONS_DOWN",
  "UPDATE_MAX_DAILY_TRADES_DOWN",
] as const;

export const ALLOWED_ACTION_TYPES: readonly ActionPlanType[] = [
  "UPDATE_RISK_PER_TRADE_DOWN",
  "UPDATE_MAX_DAILY_LOSS_DOWN",
  "UPDATE_MAX_OPEN_POSITIONS_DOWN",
  "UPDATE_MAX_DAILY_TRADES_DOWN",
  "SET_OBSERVATION_MODE",
  "REQUEST_MANUAL_REVIEW",
  "CREATE_IMPLEMENTATION_PROMPT",
] as const;

/**
 * Yasak aksiyon tipleri — açıkça listelenir, audit edilir. Generator bu
 * listeden HİÇBİR aksiyon üretmez. ALLOWED_ACTION_TYPES dışında bir tip
 * üretmesi durumunda runtime guard ve testler bunu yakalar.
 */
export const FORBIDDEN_ACTION_TYPES = [
  "ENABLE_LIVE_TRADING",
  "DISABLE_HARD_LIVE_GATE",
  "PLACE_BINANCE_ORDER",
  "MODIFY_BINANCE_LEVERAGE",
  "INCREASE_LEVERAGE",
  "INCREASE_RISK_PER_TRADE",
  "INCREASE_MAX_DAILY_LOSS",
  "INCREASE_MAX_OPEN_POSITIONS",
  "INCREASE_MAX_DAILY_TRADES",
  "ENABLE_PAPER_LEARNING_BYPASS",
  "ENABLE_FORCE_PAPER_ENTRY",
  "ENABLE_AGGRESSIVE_PAPER",
  "MODIFY_SL_TP_ALGORITHM",
  "LOWER_MIN_SIGNAL_CONFIDENCE",
  "DISABLE_BTC_TREND_FILTER",
] as const;

export type ForbiddenActionType = (typeof FORBIDDEN_ACTION_TYPES)[number];

export interface ActionPlan {
  id: string;
  source: ActionPlanSource;
  type: ActionPlanType;
  title: string;
  summary: string;
  reason: string;
  /** Mevcut ayar değeri (string olarak normalize). null = ayar değişikliği değil. */
  currentValue: string | null;
  /** Önerilen değer (string). null = ayar değişikliği değil. */
  recommendedValue: string | null;
  /** Bu aksiyon uygulanırsa beklenen etki. */
  impact: string;
  riskLevel: ActionPlanRiskLevel;
  /** 0–100 — generator deterministik bir güven skoru üretir. */
  confidence: number;
  /** Bu fazda her aksiyon onay gerektirir; daima true. */
  requiresApproval: true;
  /** Generator bu aksiyonu üretmeye izinli buldu mu? */
  allowed: boolean;
  /** allowed=false ise sebep. */
  blockedReason?: string | null;
  status: ActionPlanStatus;
  createdAt: string;
}

/**
 * Generator input — okuma kaynaklarından toplanan ham veri.
 *
 * Hiçbir alan generator tarafından mutate edilmez. Generator deterministic;
 * AI çağrısına bağımlı değildir (AI yorum varsa yalnızca summary/reason'u
 * zenginleştirebilir, action safety dokunulmaz).
 */
export interface ActionPlanGeneratorInput {
  closedTradeCount: number;
  openTradeCount: number;
  totalPnl: number;
  dailyPnl: number;
  /** 0–100 */
  winRate: number;
  profitFactor: number;
  /** 0–100 */
  maxDrawdownPercent: number;
  riskSettings: {
    riskPerTradePercent: number;
    dailyMaxLossPercent: number;
    defaultMaxOpenPositions: number;
    dynamicMaxOpenPositions: number;
    maxDailyTrades: number;
  };
  performanceDecision: {
    status: string;
    actionType: string;
    mainFinding: string;
    systemInterpretation: string;
    recommendation: string;
    confidence: number;
  } | null;
  aiInterpretation: {
    status: string;
    actionType: string;
    riskLevel: string;
    mainFinding: string;
    recommendation: string;
    confidence: number;
    blockedBy: string[];
  } | null;
  /** Test injection — varsayılan: new Date().toISOString() */
  generatedAt?: string;
}

export interface SourceSnapshot {
  closedTrades: number;
  openPositions: number;
  totalPnl: number;
  dailyPnl: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownPercent: number;
  riskSettingsSummary: {
    riskPerTradePercent: number;
    dailyMaxLossPercent: number;
    defaultMaxOpenPositions: number;
    dynamicMaxOpenPositions: number;
    maxDailyTrades: number;
  };
  performanceDecisionStatus: string | null;
  aiInterpreterStatus: string | null;
}

export interface ActionPlanResult {
  plans: ActionPlan[];
  generatedAt: string;
  sourceSnapshot: SourceSnapshot;
  /** Faz 2 banner metni — UI'da gösterilir. */
  phaseBanner: string;
}
