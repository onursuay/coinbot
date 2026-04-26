// LIVE_TRADING gate. Default disabled. Even when enabled, every order must
// pass the full risk engine, credential validation, and operational guards.

import { env } from "@/lib/env";
import type { RiskCheckResult } from "./risk-engine";

export interface LiveOrderPreflight {
  hasApiKey: boolean;
  hasApiSecret: boolean;
  credentialsValidated: boolean;
  exchangeSupported: boolean;
  futuresSupported: boolean;
  withdrawPermissionAbsent: boolean;
  riskAllowed: boolean;
  killSwitchActive: boolean;
  botPaused: boolean;
  dataFresh: boolean;
  webSocketHealthy: boolean;
  liquidationSafe: boolean;
  marginModeIsolated: boolean;
  dailyLossLimitOk: boolean;
  dailyTargetNotHit: boolean;
  maxOpenPositionsOk: boolean;
  leverageWithinCap: boolean;
}

export function liveTradingEnabled(): boolean {
  return env.liveTrading === true;
}

export function preflightLiveOrder(p: LiveOrderPreflight & { risk: RiskCheckResult }): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!liveTradingEnabled()) reasons.push("LIVE_TRADING=false (default)");
  if (!p.hasApiKey) reasons.push("API key yok");
  if (!p.hasApiSecret) reasons.push("API secret yok");
  if (!p.credentialsValidated) reasons.push("API credential doğrulanmamış");
  if (!p.exchangeSupported) reasons.push("Borsa desteklenmiyor");
  if (!p.futuresSupported) reasons.push("Futures desteklenmiyor");
  if (!p.withdrawPermissionAbsent) reasons.push("API key withdrawal izni içeriyor");
  if (!p.riskAllowed) reasons.push("Risk engine reddetti");
  if (p.killSwitchActive) reasons.push("Kill switch aktif");
  if (p.botPaused) reasons.push("Bot duraklatılmış");
  if (!p.dataFresh) reasons.push("Veri güncel değil");
  if (!p.webSocketHealthy) reasons.push("WebSocket sağlıksız");
  if (!p.liquidationSafe) reasons.push("Likidasyon güvenli değil");
  if (!p.marginModeIsolated) reasons.push("Margin mode ISOLATED olmalı");
  if (!p.dailyLossLimitOk) reasons.push("Günlük zarar limiti");
  if (!p.dailyTargetNotHit) reasons.push("Günlük kâr hedefi tamamlandı");
  if (!p.maxOpenPositionsOk) reasons.push("Max açık pozisyon limiti");
  if (!p.leverageWithinCap) reasons.push("Leverage 5x üstünde — yasak");
  return { ok: reasons.length === 0, reasons };
}
