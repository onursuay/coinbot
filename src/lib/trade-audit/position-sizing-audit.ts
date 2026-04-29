// Faz 22 — Position Sizing Audit.
// Pozisyon büyüklüğünün doğruluğunu ve SL mesafesinin notional'a etkisini denetler.
// Pozisyon büyüklüğünü veya risk ayarını otomatik DEĞİŞTİRMEZ.

import type { NormalizedTrade } from "@/lib/trade-performance";
import type { RiskExecutionConfig } from "@/lib/risk-settings/apply";
import type { PositionSizingAuditResult, PositionSizingTag, AuditSeverity } from "./types";

const PAPER_BALANCE_FALLBACK = 1000; // Faz 20 fallback sabiti
const NOTIONAL_INFLATION_THRESHOLD = 5; // SL mesafesi %0.5 altında notional şişiyor

export interface PositionSizingInput {
  closedTrades: NormalizedTrade[];
  riskConfig: RiskExecutionConfig | null;
}

export function auditPositionSizing(input: PositionSizingInput): PositionSizingAuditResult {
  const { closedTrades, riskConfig } = input;

  if (!riskConfig) {
    return insufficientResult("Risk config yok — pozisyon boyutu denetlenemiyor.", "riskConfig=null.");
  }

  if (closedTrades.length === 0) {
    return insufficientResult("Kapanan işlem verisi yok.", "closedTrades boş.");
  }

  const capital = riskConfig.totalBotCapitalUsdt;
  const riskPct = riskConfig.riskPerTradePercent;
  const capitalMissingFallback = capital === 0;

  // CAPITAL_MISSING_FALLBACK_USED
  if (capitalMissingFallback) {
    return {
      tag: "CAPITAL_MISSING_FALLBACK_USED",
      capitalMissingFallbackUsed: true,
      affectedTradeCount: closedTrades.length,
      mainFinding: "Sermaye tanımlı değil — fallback değer kullanılıyor.",
      evidence: `totalBotCapitalUsdt=0. ${PAPER_BALANCE_FALLBACK} USDT fallback sermayesi kullanılıyor.`,
      recommendation: "Risk Yönetimi sayfasında gerçek sermayeyi girin. Fallback değer hatalı boyut üretebilir.",
      severity: "warning",
    };
  }

  const riskAmountUsdt = capital * riskPct / 100;

  // SL mesafesine göre notional kontrolü
  const tradesWithSl = closedTrades.filter((t) => t.stopLoss && t.entryPrice > 0);
  const inflatedTrades = tradesWithSl.filter((t) => {
    const slDist = Math.abs(t.entryPrice - t.stopLoss!) / t.entryPrice * 100;
    if (slDist <= 0) return false;
    const expectedNotional = riskAmountUsdt / (slDist / 100);
    return slDist < 0.5 && expectedNotional > capital * 5;
  });

  if (inflatedTrades.length > 0) {
    const inflatedSymbols = inflatedTrades.map((t) => t.symbol).slice(0, 3).join(", ");
    return {
      tag: "STOP_DISTANCE_INFLATED_NOTIONAL",
      capitalMissingFallbackUsed: false,
      affectedTradeCount: inflatedTrades.length,
      mainFinding: "Dar SL mesafesi aşırı büyük pozisyon notional'i üretiyor.",
      evidence: `${inflatedTrades.length} işlem: ${inflatedSymbols}. SL < %0.5 → notional sermayeyi aşıyor.`,
      recommendation: "SL mesafesini artırın veya pozisyon büyüklüğünü manuel sınırlayın.",
      severity: "critical",
    };
  }

  // Büyük pnl kayıpları: beklenen risk tutarını aşan zararlar
  const largeLosses = closedTrades.filter((t) => {
    if ((t.pnl ?? 0) >= 0) return false;
    return Math.abs(t.pnl ?? 0) > riskAmountUsdt * NOTIONAL_INFLATION_THRESHOLD;
  });

  if (largeLosses.length > 0) {
    return {
      tag: "POSITION_SIZE_TOO_LARGE",
      capitalMissingFallbackUsed: false,
      affectedTradeCount: largeLosses.length,
      mainFinding: "Bazı işlemlerde gerçek zarar beklenen risk tutarının çok üzerinde.",
      evidence: `${largeLosses.length} işlem beklenen zarar sınırı (${riskAmountUsdt.toFixed(2)} USDT) x${NOTIONAL_INFLATION_THRESHOLD}'i aştı.`,
      recommendation: "Pozisyon büyüklüğü hesabını ve SL mesafesini gözden geçirin.",
      severity: "warning",
    };
  }

  // Çok küçük pnl: pozisyon çok küçük
  const allHavePnl = closedTrades.filter((t) => t.pnl !== null);
  const avgAbsPnl = allHavePnl.length > 0
    ? allHavePnl.reduce((s, t) => s + Math.abs(t.pnl!), 0) / allHavePnl.length
    : 0;

  if (avgAbsPnl > 0 && avgAbsPnl < riskAmountUsdt * 0.1) {
    return {
      tag: "POSITION_SIZE_TOO_SMALL",
      capitalMissingFallbackUsed: false,
      affectedTradeCount: allHavePnl.length,
      mainFinding: "Ortalama kazanç/kayıp beklenen risk tutarının çok altında.",
      evidence: `Ort. |PnL|: ${avgAbsPnl.toFixed(2)} USDT. Beklenen risk: ${riskAmountUsdt.toFixed(2)} USDT.`,
      recommendation: "Pozisyon boyutu doğru hesaplanıyor mu kontrol edin.",
      severity: "info",
    };
  }

  return {
    tag: "POSITION_SIZE_OK",
    capitalMissingFallbackUsed: false,
    affectedTradeCount: 0,
    mainFinding: "Pozisyon büyüklüğü makul görünüyor.",
    evidence: `Risk: ${riskAmountUsdt.toFixed(2)} USDT/işlem (%${riskPct}). Kapanan: ${closedTrades.length} işlem.`,
    recommendation: "Mevcut pozisyon boyutu mantıklı. Gözlemeye devam edin.",
    severity: "info",
  };
}

function insufficientResult(mainFinding: string, evidence: string): PositionSizingAuditResult {
  return {
    tag: "DATA_INSUFFICIENT",
    capitalMissingFallbackUsed: false,
    affectedTradeCount: 0,
    mainFinding,
    evidence,
    recommendation: "Daha fazla veri ve config gerekiyor.",
    severity: "info",
  };
}
