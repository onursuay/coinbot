// Faz 19 — Risk Settings Execution Binding.
//
// Risk Yönetimi sayfasında tanımlanan ayarları paper/live ortak risk
// lifecycle config'i olarak okur. Bu fazda live execution AÇILMAZ:
//   • liveExecutionBound = false (sabit, env-gate kapalı olduğu sürece).
//   • Kaldıraç execution YOK; sadece config olarak taşınır.
//   • averageDownEnabled DAİMA false; runtime guard ile zorlanır.
//   • openLiveOrder hâlâ LIVE_EXECUTION_NOT_IMPLEMENTED döner.

import { env, isHardLiveAllowed } from "@/lib/env";
import { getRiskSettings } from "./store";
import type {
  LeverageRanges,
  RiskProfileKey,
  RiskSettings,
  StopLossMode,
} from "./types";

export interface RiskExecutionConfig {
  // Sermaye / risk yüzdeleri
  totalBotCapitalUsdt: number;
  riskPerTradePercent: number;
  dailyMaxLossPercent: number;

  // Pozisyon limitleri
  defaultMaxOpenPositions: number;
  dynamicMaxOpenPositions: number;
  maxDailyTrades: number;

  // Yön
  longLeverageEnabled: boolean;
  shortLeverageEnabled: boolean;

  // Kaldıraç (config-only — execution yok)
  leverageRanges: LeverageRanges;

  // Stop-loss / yönetim
  stopLossMode: StopLossMode;
  progressiveManagementEnabled: boolean;

  // Güvenlik kilitleri
  averageDownEnabled: false;

  // Bağlama durumu
  riskConfigBound: true;
  liveExecutionBound: false;
  leverageExecutionBound: false;

  // Kaynak
  profile: RiskProfileKey;
  updatedAt: number;
}

/** Read-through accessor. Returns a snapshot of the in-memory risk store
 *  (which is rehydrated from Supabase on first access via store loader). */
export function getEffectiveRiskSettings(): RiskSettings {
  return getRiskSettings();
}

export function buildRiskExecutionConfig(
  s: RiskSettings = getEffectiveRiskSettings(),
): RiskExecutionConfig {
  // Hard runtime guard: averageDown is *never* allowed.
  const averageDownEnabled: false = false;

  // liveExecutionBound is the AND of three gates. In this phase env hard
  // gate is closed, so this remains false. Kept as derived for clarity.
  const liveBound = false; // Faz 19'da sabit false (env hard gate kapalı).
  // Sanity check: even if hardLive flips on later, this binding must remain
  // false until a future phase wires real execution through openLiveOrder.
  void isHardLiveAllowed;

  return {
    totalBotCapitalUsdt: s.capital.totalCapitalUsdt,
    riskPerTradePercent: s.capital.riskPerTradePercent,
    dailyMaxLossPercent: s.capital.maxDailyLossPercent,

    defaultMaxOpenPositions: s.positions.defaultMaxOpenPositions,
    dynamicMaxOpenPositions: s.positions.dynamicMaxOpenPositionsCap,
    maxDailyTrades: s.positions.maxDailyTrades,

    longLeverageEnabled: s.direction.longEnabled,
    shortLeverageEnabled: s.direction.shortEnabled,

    leverageRanges: {
      CC:    { ...s.leverage.CC },
      GNMR:  { ...s.leverage.GNMR },
      MNLST: { ...s.leverage.MNLST },
    },

    stopLossMode: s.stopLoss.mode,
    progressiveManagementEnabled: s.tiered.scaleInProfitEnabled === true,

    averageDownEnabled,

    riskConfigBound: true,
    liveExecutionBound: liveBound as false,
    leverageExecutionBound: false,

    profile: s.profile,
    updatedAt: s.updatedAt,
  };
}

export interface RiskExecutionConfigValidation {
  ok: boolean;
  errors: string[];
}

export function validateRiskExecutionConfig(
  cfg: RiskExecutionConfig,
): RiskExecutionConfigValidation {
  const errors: string[] = [];
  if (cfg.averageDownEnabled !== false) errors.push("averageDownEnabled must be false");
  if (cfg.liveExecutionBound !== false) errors.push("liveExecutionBound must be false in this phase");
  if (cfg.leverageExecutionBound !== false) errors.push("leverageExecutionBound must be false in this phase");
  if (cfg.riskPerTradePercent <= 0) errors.push("riskPerTradePercent must be > 0");
  if (cfg.dailyMaxLossPercent <= 0) errors.push("dailyMaxLossPercent must be > 0");
  if (cfg.defaultMaxOpenPositions < 1) errors.push("defaultMaxOpenPositions must be >= 1");
  if (cfg.dynamicMaxOpenPositions < cfg.defaultMaxOpenPositions) {
    errors.push("dynamicMaxOpenPositions must be >= defaultMaxOpenPositions");
  }
  if (cfg.maxDailyTrades < 1) errors.push("maxDailyTrades must be >= 1");
  return { ok: errors.length === 0, errors };
}

/** Read-only snapshot for diagnostics / status panel. */
export interface RiskExecutionStatus {
  riskConfigBound: true;
  liveExecutionBound: false;
  leverageExecutionBound: false;
  averageDownLocked: true;
  envHardLiveAllowed: boolean;
  envDefaultTradingMode: "paper" | "live";
}

export function getRiskExecutionStatus(): RiskExecutionStatus {
  return {
    riskConfigBound: true,
    liveExecutionBound: false,
    leverageExecutionBound: false,
    averageDownLocked: true,
    envHardLiveAllowed: env.hardLiveTradingAllowed === true,
    envDefaultTradingMode: env.defaultTradingMode,
  };
}
