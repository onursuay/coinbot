// Futures Risk Management Engine.
// HARD INVARIANTS:
//  - Leverage NEVER exceeds 5x system cap.
//  - Default isolated margin.
//  - Stop-loss & take-profit mandatory; min RR 1:2.
//  - Risk per trade ≤ 1% of balance.
//  - Daily loss limit, weekly loss limit, max open positions enforced.
//  - Liquidation price must be safely beyond stop-loss.
//
// Faz 20: risk config fields (maxOpenPositions, dailyMaxLossPercent,
// riskPerTradePercent, totalCapitalUsdt) are now accepted from RiskExecutionConfig
// via optional input fields. Env values remain as fallback.

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
  // Tier overrides (set by orchestrator from risk-tiers module)
  tierMaxLeverage?: number;
  tierMinRiskRewardRatio?: number;
  tierMaxRiskPerTradePercent?: number;

  // Faz 20 — Risk settings execution config overrides.
  // When provided, these supersede the env defaults for lifecycle calculations.
  riskConfigMaxOpenPositions?: number;
  riskConfigDailyMaxLossPercent?: number;
  riskConfigRiskPerTradePercent?: number;
  riskConfigTotalCapitalUsdt?: number;
  // Diagnostic: whether capital came from risk settings or fallback
  riskConfigCapitalSource?: "risk_settings" | "env_fallback" | "capital_missing_fallback";
}

// P0 bugfix: Reject sebebini ayırmak için tip alanı.
// "rr_insufficient" → sadece R:R yetersiz; UI'da "R:R YETERSİZ" etiketi.
// "risk_violation"  → gerçek risk limiti (sermaye, likidasyon, kill switch, vb.).
export type RiskRejectKind = "rr_insufficient" | "risk_violation";

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
  rejectKind?: RiskRejectKind;
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
  // Faz 20 diagnostics
  riskConfigSource: "risk_settings" | "env_fallback" | "capital_missing_fallback";
  maxOpenPositionsFromRiskSettings: number;
  dynamicMaxOpenPositions?: number;
  // May 2026 — paper position-sizing cap diagnostics (sizingVersion=risk_cap_v1).
  // ETH/ZEC audit found tight-SL trades opened with margin >> account balance
  // because risk-based sizing applied no upper bound. Cap enforces:
  //   marginUsed <= accountBalanceUsd * marginCapPercent (default 10%, hard 15% ceiling).
  // When the raw size exceeds the cap, the engine downscales positionSize so
  // margin lands at the cap and recomputes the *actual* risk taken.
  sizingDiagnostics: {
    sizingVersion: "risk_cap_v1";
    configuredRiskAmountUsdt: number;   // capital * riskPerTradePercent / 100
    actualRiskUsdt: number;             // |entry - stopLoss| * finalQuantity (post-cap)
    stopDistancePercent: number;
    rawQuantity: number;
    finalQuantity: number;
    rawNotionalUsdt: number;
    finalNotionalUsdt: number;
    rawMarginUsed: number;
    finalMarginUsed: number;
    marginCapUsdt: number;              // accountBalance * marginCapPercent / 100
    marginCapPercent: number;
    marginCapApplied: boolean;
    tightStopBlocked: boolean;          // stopDistancePercent < TIGHT_STOP_MIN_PERCENT
  };
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

  // Faz 20: use risk config values when provided, else fall back to env defaults.
  const effectiveMaxOpenPositions = input.riskConfigMaxOpenPositions ?? env.maxOpenPositions;
  const effectiveDailyMaxLossPct = input.riskConfigDailyMaxLossPercent ?? env.maxDailyLossPercent;
  const riskConfigSource = input.riskConfigCapitalSource ?? "env_fallback";

  const stopDist = Math.abs(input.entryPrice - input.stopLoss);
  const tpDist = Math.abs(input.takeProfit - input.entryPrice);
  const rr = stopDist > 0 ? tpDist / stopDist : 0;

  // Hard system gates
  if (input.killSwitchActive) violations.push("Kill switch aktif");
  if (!input.dataFresh) violations.push("Veri güncel değil");
  if (!input.apiHealthy) violations.push("API sağlıklı değil");
  if (!input.webSocketHealthy) violations.push("WebSocket sağlıksız");
  if (input.openPositionCount >= effectiveMaxOpenPositions) {
    violations.push(`Maksimum açık pozisyon (${effectiveMaxOpenPositions}) doldu`);
  }
  if (input.recentLossStreak >= 3) violations.push("Art arda 3 zarar — bot otomatik duraklatılmalı");
  const dailyLossLimitUsd = -(input.accountBalanceUsd * effectiveDailyMaxLossPct) / 100;
  const weeklyLossLimitUsd = -(input.accountBalanceUsd * env.maxWeeklyLossPercent) / 100;
  if (input.dailyRealizedPnlUsd <= dailyLossLimitUsd) violations.push("Günlük zarar limiti doldu");
  if (input.weeklyRealizedPnlUsd <= weeklyLossLimitUsd) violations.push("Haftalık zarar limiti doldu");
  if (input.dailyTargetHit && !input.conservativeMode) violations.push("Günlük kâr hedefi tamamlandı — yeni işlem açılmaz");

  if (input.marketSpread > 0.0015) violations.push("Spread çok yüksek");
  if (stopDist === 0) violations.push("Stop-loss tanımsız");
  if (tpDist === 0) violations.push("Take-profit tanımsız");
  // Use tier-specific R:R minimum if provided (stricter than env default)
  const effectiveMinRr = Math.max(env.minRiskRewardRatio, input.tierMinRiskRewardRatio ?? 0);
  // P0 bugfix: R:R violation ayrı flag ile işaretleniyor; orchestrator UI'da
  // "R:R YETERSİZ" etiketi olarak gösterir (gerçek risk reddinden ayrı).
  const rrViolationMsg = `Risk/ödül yetersiz (1:${rr.toFixed(2)} < 1:${effectiveMinRr})`;
  if (rr < effectiveMinRr) violations.push(rrViolationMsg);

  // Direction sanity
  if (input.direction === "LONG" && input.stopLoss >= input.entryPrice) violations.push("LONG stop-loss giriş fiyatının altında olmalı");
  if (input.direction === "SHORT" && input.stopLoss <= input.entryPrice) violations.push("SHORT stop-loss giriş fiyatının üstünde olmalı");
  if (input.direction === "LONG" && input.takeProfit <= input.entryPrice) violations.push("LONG take-profit giriş fiyatının üstünde olmalı");
  if (input.direction === "SHORT" && input.takeProfit >= input.entryPrice) violations.push("SHORT take-profit giriş fiyatının altında olmalı");

  // Funding guard
  if (typeof input.fundingRate === "number" && Math.abs(input.fundingRate) > 0.003) {
    violations.push("Funding rate aşırı riskli");
  }

  // Leverage selection — tier cap is the strictest applicable upper bound
  const desiredLev = env.maxLeverage;
  const tierCap = input.tierMaxLeverage ?? SYSTEM_HARD_LEVERAGE_CAP;
  const effectiveMaxAllowed = Math.min(env.maxAllowedLeverage, tierCap);
  const leverage = clampLeverage(desiredLev, input.signalScore, effectiveMaxAllowed, input.exchangeMaxLeverage);

  // Faz 20: risk-per-trade comes from risk settings config when provided,
  // else falls back to env cap. Tier may impose a stricter upper bound on top.
  const baseRiskPct = input.riskConfigRiskPerTradePercent ?? env.maxRiskPerTradePercent;
  const effectiveRiskPct = Math.min(baseRiskPct, input.tierMaxRiskPerTradePercent ?? 999);
  const riskAmount = (input.accountBalanceUsd * effectiveRiskPct) / 100;

  // ── Raw risk-based sizing (pre-cap) ──
  let positionSize = stopDist > 0 ? riskAmount / stopDist : 0;
  if (input.exchangeStepSize) positionSize = roundDown(positionSize, input.exchangeStepSize);
  const rawQuantity = positionSize;
  const rawNotional = positionSize * input.entryPrice;
  const rawMarginUsed = leverage > 0 ? rawNotional / leverage : rawNotional;

  // ── May 2026 — paper sizing caps (sizingVersion=risk_cap_v1) ──
  // (a) Tight-stop guard: refuse to open a paper trade when stopDistancePercent
  //     is below TIGHT_STOP_MIN_PERCENT. Audit (ETH 0.20% / ZEC 0.81% SL) showed
  //     such trades blow up: tiny stop → huge position → runaway margin and a
  //     fee/slippage bill that exceeds the intended risk_amount.
  // (b) Margin cap: marginUsed must not exceed marginCap = accountBalance *
  //     PAPER_SINGLE_TRADE_MARGIN_CAP_PERCENT (default 10%). Hard absolute
  //     ceiling at PAPER_SINGLE_TRADE_MARGIN_HARD_CEILING_PERCENT (15%).
  // When (b) trips, scale positionSize DOWN until margin lands at the cap;
  // recompute notional/marginUsed/actualRisk. Leverage is applied exactly once
  // (rawMargin = rawNotional / leverage); the cap step does not re-apply it.
  const PAPER_SINGLE_TRADE_MARGIN_CAP_PERCENT = 10;
  const PAPER_SINGLE_TRADE_MARGIN_HARD_CEILING_PERCENT = 15;
  const TIGHT_STOP_MIN_PERCENT = 1.0;

  const stopDistancePercent = input.entryPrice > 0
    ? (stopDist / input.entryPrice) * 100
    : 0;

  const tightStopBlocked = stopDistancePercent > 0 && stopDistancePercent < TIGHT_STOP_MIN_PERCENT;
  if (tightStopBlocked) {
    violations.push(`STOP MESAFESİ ÇOK DAR: ${stopDistancePercent.toFixed(3)}% < ${TIGHT_STOP_MIN_PERCENT}%`);
  }

  // Margin cap percent is fixed in code (10%) with a hard ceiling at 15% — no
  // env override path so a stale VPS env file cannot relax this safety.
  const marginCapPercent = Math.min(
    PAPER_SINGLE_TRADE_MARGIN_CAP_PERCENT,
    PAPER_SINGLE_TRADE_MARGIN_HARD_CEILING_PERCENT,
  );
  const marginCapUsdt = (input.accountBalanceUsd * marginCapPercent) / 100;

  let finalQuantity = rawQuantity;
  let marginCapApplied = false;
  if (rawMarginUsed > marginCapUsdt && marginCapUsdt > 0 && input.entryPrice > 0 && leverage > 0) {
    const cappedNotional = marginCapUsdt * leverage;
    const cappedQuantity = cappedNotional / input.entryPrice;
    finalQuantity = input.exchangeStepSize
      ? roundDown(cappedQuantity, input.exchangeStepSize)
      : cappedQuantity;
    marginCapApplied = true;
  }

  positionSize = finalQuantity;
  if (input.exchangeMinOrderSize && positionSize > 0 && positionSize < input.exchangeMinOrderSize) {
    violations.push("Pozisyon boyutu borsa minimum emir büyüklüğünün altında");
  }
  const notional = positionSize * input.entryPrice;
  const marginUsed = leverage > 0 ? notional / leverage : notional;
  const actualRiskUsdt = stopDist > 0 ? stopDist * positionSize : 0;

  // Full balance protection (existing 90% rule kept as defense in depth even
  // though the new 10% cap above is stricter).
  if (marginUsed > input.accountBalanceUsd * 0.9) violations.push("Margin gereksinimi bakiyenin %90'ını aşıyor");
  // After the cap, marginUsed must never exceed the cap by a non-rounding margin.
  if (marginCapUsdt > 0 && marginUsed > marginCapUsdt * 1.001) {
    violations.push(`MARGIN CAP AŞIMI: ${marginUsed.toFixed(2)} > ${marginCapUsdt.toFixed(2)} (${marginCapPercent}% / capital)`);
  }

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
  // P0 bugfix: Reddedildiyse, ihlal listesi *yalnızca* R:R yetersizliği mi?
  // Öyleyse rejectKind="rr_insufficient" — orchestrator "R:R YETERSİZ" gösterir.
  // Aksi halde "risk_violation" (gerçek risk limiti).
  const rejectKind: RiskRejectKind | undefined = allowed
    ? undefined
    : (violations.length === 1 && violations[0] === rrViolationMsg)
      ? "rr_insufficient"
      : "risk_violation";
  return {
    allowed,
    reason: allowed ? undefined : violations[0],
    rejectKind,
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
    // Faz 20 diagnostics
    riskConfigSource,
    maxOpenPositionsFromRiskSettings: effectiveMaxOpenPositions,
    // May 2026 paper sizing cap diagnostics
    sizingDiagnostics: {
      sizingVersion: "risk_cap_v1",
      configuredRiskAmountUsdt: riskAmount,
      actualRiskUsdt,
      stopDistancePercent,
      rawQuantity,
      finalQuantity,
      rawNotionalUsdt: rawNotional,
      finalNotionalUsdt: notional,
      rawMarginUsed,
      finalMarginUsed: marginUsed,
      marginCapUsdt,
      marginCapPercent,
      marginCapApplied,
      tightStopBlocked,
    },
  };
}
