// Futures Risk Management Engine.
// HARD INVARIANTS:
//  - Leverage NEVER exceeds 5x system cap.
//  - Default isolated margin.
//  - Stop-loss & take-profit mandatory; min RR 1:2.
//  - Risk per trade ≤ 1% of balance.
//  - Daily loss limit, weekly loss limit, max open positions enforced.
//  - Liquidation price must be safely beyond stop-loss.

import { SYSTEM_HARD_LEVERAGE_CAP, env } from "@/lib/env";
import type { MarginMode, PositionDirection } from "@/lib/exchanges/types";

export interface RiskCheckInput {
  accountBalanceUsd: number;
  symbol: string;
  direction: PositionDirection;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  signalScore: number;       // 0-100
  marketSpread: number;      // fraction
  recentLossStreak: number;
  openPositionCount: number;
  dailyRealizedPnlUsd: number;
  weeklyRealizedPnlUsd: number;
  dailyTargetHit: boolean;
  conservativeMode: boolean;
  killSwitchActive: boolean;
  webSocketHealthy: boolean;
  apiHealthy: boolean;
  dataFresh: boolean;
  fundingRate?: number;
  estimatedLiquidationPrice?: number;
  exchangeMaxLeverage?: number;
  exchangeMinOrderSize?: number;
  exchangeStepSize?: number;
  exchangeTickSize?: number;
  marginMode?: MarginMode;
}

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
  marketType: "FUTURES";
  marginMode: MarginMode;
  riskAmount: number;
  positionSize: number;
  leverage: number;
  marginUsed: number;
  stopLoss: number;
  takeProfit: number;
  estimatedLiquidationPrice: number | null;
  liquidationWarning: boolean;
  riskRewardRatio: number;
  ruleViolations: string[];
}

function leverageCapForScore(score: number): number {
  if (score >= 90) return 5;
  if (score >= 80) return 3;
  if (score >= 70) return 2;
  return 1;
}

function clampLeverage(desired: number, score: number, maxAllowedSetting: number, exchangeMax?: number): number {
  const cap = Math.min(
    SYSTEM_HARD_LEVERAGE_CAP,
    maxAllowedSetting,
    exchangeMax ?? SYSTEM_HARD_LEVERAGE_CAP,
    leverageCapForScore(score),
  );
  return Math.max(1, Math.min(desired, cap));
}

function roundDown(value: number, step: number): number {
  if (!step || step <= 0) return value;
  return Math.floor(value / step) * step;
}

export function evaluateRisk(input: RiskCheckInput): RiskCheckResult {
  const violations: string[] = [];
  const marginMode: MarginMode = input.marginMode ?? (env.defaultMarginMode as MarginMode) ?? "isolated";

  const stopDist = Math.abs(input.entryPrice - input.stopLoss);
  const tpDist = Math.abs(input.takeProfit - input.entryPrice);
  const rr = stopDist > 0 ? tpDist / stopDist : 0;

  // Hard system gates
  if (input.killSwitchActive) violations.push("Kill switch aktif");
  if (!input.dataFresh) violations.push("Veri güncel değil");
  if (!input.apiHealthy) violations.push("API sağlıklı değil");
  if (!input.webSocketHealthy) violations.push("WebSocket sağlıksız");
  if (input.openPositionCount >= env.maxOpenPositions) {
    violations.push(`Maksimum açık pozisyon (${env.maxOpenPositions}) doldu`);
  }
  if (input.recentLossStreak >= 3) violations.push("Art arda 3 zarar — bot otomatik duraklatılmalı");
  const dailyLossLimitUsd = -(input.accountBalanceUsd * env.maxDailyLossPercent) / 100;
  const weeklyLossLimitUsd = -(input.accountBalanceUsd * env.maxWeeklyLossPercent) / 100;
  if (input.dailyRealizedPnlUsd <= dailyLossLimitUsd) violations.push("Günlük zarar limiti doldu");
  if (input.weeklyRealizedPnlUsd <= weeklyLossLimitUsd) violations.push("Haftalık zarar limiti doldu");
  if (input.dailyTargetHit && !input.conservativeMode) violations.push("Günlük kâr hedefi tamamlandı — yeni işlem açılmaz");

  if (input.marketSpread > 0.0015) violations.push("Spread çok yüksek");
  if (stopDist === 0) violations.push("Stop-loss tanımsız");
  if (tpDist === 0) violations.push("Take-profit tanımsız");
  if (rr < env.minRiskRewardRatio) violations.push(`Risk/ödül yetersiz (1:${rr.toFixed(2)} < 1:${env.minRiskRewardRatio})`);

  // Direction sanity
  if (input.direction === "LONG" && input.stopLoss >= input.entryPrice) violations.push("LONG stop-loss giriş fiyatının altında olmalı");
  if (input.direction === "SHORT" && input.stopLoss <= input.entryPrice) violations.push("SHORT stop-loss giriş fiyatının üstünde olmalı");
  if (input.direction === "LONG" && input.takeProfit <= input.entryPrice) violations.push("LONG take-profit giriş fiyatının üstünde olmalı");
  if (input.direction === "SHORT" && input.takeProfit >= input.entryPrice) violations.push("SHORT take-profit giriş fiyatının altında olmalı");

  // Funding guard
  if (typeof input.fundingRate === "number" && Math.abs(input.fundingRate) > 0.003) {
    violations.push("Funding rate aşırı riskli");
  }

  // Leverage selection
  const desiredLev = env.maxLeverage;
  const leverage = clampLeverage(desiredLev, input.signalScore, env.maxAllowedLeverage, input.exchangeMaxLeverage);

  // Risk-based position sizing
  const riskAmount = (input.accountBalanceUsd * env.maxRiskPerTradePercent) / 100;
  let positionSize = stopDist > 0 ? riskAmount / stopDist : 0;
  if (input.exchangeStepSize) positionSize = roundDown(positionSize, input.exchangeStepSize);
  if (input.exchangeMinOrderSize && positionSize < input.exchangeMinOrderSize) {
    violations.push("Pozisyon boyutu borsa minimum emir büyüklüğünün altında");
  }
  const notional = positionSize * input.entryPrice;
  const marginUsed = leverage > 0 ? notional / leverage : notional;

  // Full balance protection
  if (marginUsed > input.accountBalanceUsd * 0.9) violations.push("Margin gereksinimi bakiyenin %90'ını aşıyor");

  // Liquidation safety
  let liquidationWarning = false;
  if (typeof input.estimatedLiquidationPrice === "number") {
    if (input.direction === "LONG") {
      if (input.estimatedLiquidationPrice >= input.stopLoss) {
        violations.push("Likidasyon fiyatı stop-loss'a çok yakın veya üstünde");
        liquidationWarning = true;
      }
    } else {
      if (input.estimatedLiquidationPrice <= input.stopLoss) {
        violations.push("Likidasyon fiyatı stop-loss'a çok yakın veya altında");
        liquidationWarning = true;
      }
    }
  }

  const allowed = violations.length === 0;
  return {
    allowed,
    reason: allowed ? undefined : violations[0],
    marketType: "FUTURES",
    marginMode,
    riskAmount,
    positionSize,
    leverage,
    marginUsed,
    stopLoss: input.stopLoss,
    takeProfit: input.takeProfit,
    estimatedLiquidationPrice: input.estimatedLiquidationPrice ?? null,
    liquidationWarning,
    riskRewardRatio: rr,
    ruleViolations: violations,
  };
}
