// LIVE TRADING TRIPLE GATE — defense in depth.
//
// To submit a real order, ALL THREE conditions must be true:
//   1. env.HARD_LIVE_TRADING_ALLOWED=true (env-level master switch — cannot be overridden by DB)
//   2. bot_settings.trading_mode='live'  (DB-level mode)
//   3. bot_settings.enable_live_trading=true (DB-level explicit opt-in)
//
// Even when all three pass, the existing preflight (credentials, risk engine,
// kill switch, isolated margin, leverage cap, liquidation safety) must ALSO pass.

import { isHardLiveAllowed } from "@/lib/env";
import type { RiskCheckResult } from "./risk-engine";

export interface BotSettingsGate {
  trading_mode?: string;             // 'paper' | 'live'
  enable_live_trading?: boolean;
  bot_status?: string;
  kill_switch_active?: boolean;
}

export interface TripleGateResult {
  allowed: boolean;
  reasons: string[];
  envHardGate: boolean;
  dbModeGate: boolean;
  dbEnableGate: boolean;
}

export function tripleGate(settings: BotSettingsGate | null): TripleGateResult {
  const envHardGate = isHardLiveAllowed();
  const dbModeGate = settings?.trading_mode === "live";
  const dbEnableGate = settings?.enable_live_trading === true;

  const reasons: string[] = [];
  if (!envHardGate) reasons.push("HARD_LIVE_TRADING_ALLOWED=false (env hard gate)");
  if (!dbModeGate) reasons.push(`bot_settings.trading_mode='${settings?.trading_mode ?? "?"}' (DB mode gate — must be 'live')`);
  if (!dbEnableGate) reasons.push("bot_settings.enable_live_trading=false (DB enable gate)");
  if (settings?.kill_switch_active) reasons.push("Kill switch aktif");

  return {
    allowed: envHardGate && dbModeGate && dbEnableGate && !settings?.kill_switch_active,
    reasons,
    envHardGate,
    dbModeGate,
    dbEnableGate,
  };
}

// Backward compat — env-only check.
export function liveTradingEnabled(): boolean {
  return isHardLiveAllowed();
}

export interface LiveOrderPreflight {
  settings: BotSettingsGate | null;
  hasApiKey: boolean;
  hasApiSecret: boolean;
  credentialsValidated: boolean;
  exchangeSupported: boolean;
  futuresSupported: boolean;
  withdrawPermissionAbsent: boolean;
  riskAllowed: boolean;
  botPaused: boolean;
  dataFresh: boolean;
  webSocketHealthy: boolean;
  liquidationSafe: boolean;
  marginModeIsolated: boolean;
  dailyLossLimitOk: boolean;
  dailyTargetNotHit: boolean;
  maxOpenPositionsOk: boolean;
  leverageWithinCap: boolean;
  symbolWhitelisted: boolean;
  stopLossPresent: boolean;
  takeProfitPresent: boolean;
  riskRewardOk: boolean;
}

export function preflightLiveOrder(p: LiveOrderPreflight & { risk: RiskCheckResult }): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];

  // TRIPLE GATE first
  const gate = tripleGate(p.settings);
  if (!gate.allowed) reasons.push(...gate.reasons);

  // Whitelist + protective orders (CRITICAL — never bypassable)
  if (!p.symbolWhitelisted) reasons.push("Sembol whitelist dışı");
  if (!p.stopLossPresent) reasons.push("Stop-loss zorunlu");
  if (!p.takeProfitPresent) reasons.push("Take-profit zorunlu");
  if (!p.riskRewardOk) reasons.push("Risk/ödül oranı yetersiz");

  // Credentials
  if (!p.hasApiKey) reasons.push("API key yok");
  if (!p.hasApiSecret) reasons.push("API secret yok");
  if (!p.credentialsValidated) reasons.push("API credential doğrulanmamış");
  if (!p.withdrawPermissionAbsent) reasons.push("API key withdrawal izni içeriyor — kabul edilmez");

  // Exchange capability
  if (!p.exchangeSupported) reasons.push("Borsa desteklenmiyor");
  if (!p.futuresSupported) reasons.push("Futures desteklenmiyor");

  // Risk engine
  if (!p.riskAllowed) reasons.push("Risk engine reddetti");

  // Operational
  if (p.botPaused) reasons.push("Bot duraklatılmış");
  if (!p.dataFresh) reasons.push("Veri güncel değil");
  if (!p.webSocketHealthy) reasons.push("WebSocket sağlıksız");
  if (!p.liquidationSafe) reasons.push("Likidasyon güvenli değil");
  if (!p.marginModeIsolated) reasons.push("Margin mode ISOLATED olmalı");
  if (!p.dailyLossLimitOk) reasons.push("Günlük zarar limiti aşıldı");
  if (!p.dailyTargetNotHit) reasons.push("Günlük kâr hedefi tamamlandı");
  if (!p.maxOpenPositionsOk) reasons.push("Max açık pozisyon limiti");
  if (!p.leverageWithinCap) reasons.push("Leverage 5x üstünde — yasak");

  return { ok: reasons.length === 0, reasons };
}
