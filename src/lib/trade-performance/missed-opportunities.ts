// Phase 13 — Kaçan fırsat analizi.
//
// "Bot bu fırsatı görmedi mi yoksa kaybetti mi?" sorusunun cevabı için
// mevcut tick'in scan_details'i ve son N kapanmış işlem üzerinden
// güvenli bir gözlem yapar. Future-price backtest YAPILMAZ.
// Yeni Binance API çağrısı içermez.

import type {
  ScanRowInput,
  MissedOpportunityReport,
  MissedReason,
  MissedReasonBreakdown,
} from "./types";

const REASON_LABELS: Record<MissedReason, string> = {
  BAND_60_69_NEAR_TP: "60–69 bandında kalmış (eşiğe yakın)",
  BTC_FILTER_REJECTED: "BTC filtresinden reddedilmiş",
  RISK_GATE_REJECTED: "Risk gate'inden reddedilmiş",
  DIRECTION_UNCONFIRMED: "Yön teyidi eksik kalmış",
};

export function analyzeMissedOpportunities(
  scanRows: ScanRowInput[],
): MissedOpportunityReport {
  if (!scanRows || scanRows.length === 0) {
    return {
      missedOpportunityCount: 0,
      topMissedSymbols: [],
      missedReasonBreakdown: [],
      possibleAdjustmentArea: "Yeterli scan verisi oluşmadı.",
      insufficientData: true,
    };
  }

  const counts: Record<MissedReason, number> = {
    BAND_60_69_NEAR_TP: 0,
    BTC_FILTER_REJECTED: 0,
    RISK_GATE_REJECTED: 0,
    DIRECTION_UNCONFIRMED: 0,
  };
  const symbolReasons = new Map<string, { score: number; reasons: MissedReason[] }>();

  for (const r of scanRows) {
    if (r.opened) continue; // açılmış olan kaçan değil
    const score = r.tradeSignalScore ?? r.signalScore ?? 0;
    const reasons: MissedReason[] = [];

    if (score >= 60 && score < 70) {
      counts.BAND_60_69_NEAR_TP++;
      reasons.push("BAND_60_69_NEAR_TP");
    }
    if (r.btcTrendRejected === true) {
      counts.BTC_FILTER_REJECTED++;
      reasons.push("BTC_FILTER_REJECTED");
    }
    if (r.riskRejectReason && r.riskRejectReason.trim().length > 0) {
      counts.RISK_GATE_REJECTED++;
      reasons.push("RISK_GATE_REJECTED");
    }
    const dc = r.directionCandidate ?? "";
    if (
      r.signalType === "WAIT" &&
      (dc === "LONG_CANDIDATE" || dc === "SHORT_CANDIDATE") &&
      score < 70
    ) {
      counts.DIRECTION_UNCONFIRMED++;
      reasons.push("DIRECTION_UNCONFIRMED");
    }

    if (reasons.length > 0) {
      symbolReasons.set(r.symbol, { score, reasons });
    }
  }

  const breakdown: MissedReasonBreakdown[] = (Object.keys(counts) as MissedReason[])
    .map((reason) => ({ reason, count: counts[reason] }))
    .filter((b) => b.count > 0)
    .sort((a, b) => b.count - a.count);

  const total = breakdown.reduce((s, b) => s + b.count, 0);

  // Top sembolleri yüksek skorlulardan başlayarak sırala
  const topMissedSymbols = [...symbolReasons.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 5)
    .map(([sym]) => sym);

  let area = "Yeterli kaçan fırsat yok.";
  if (breakdown.length > 0) {
    const top = breakdown[0];
    if (top.reason === "BAND_60_69_NEAR_TP")
      area = "60–69 bandı ağır basıyor — sinyal kalitesi gözlem altına alınmalı.";
    else if (top.reason === "BTC_FILTER_REJECTED")
      area = "BTC filtresi sık devreye giriyor — pazarın yön teyidi izlenmeli.";
    else if (top.reason === "RISK_GATE_REJECTED")
      area = "Risk gate sık reddediyor — risk ayarları gözlem altına alınmalı.";
    else if (top.reason === "DIRECTION_UNCONFIRMED")
      area = "Yön teyidi sık eksik kalıyor — sinyal eşiği değil, yön açıklayıcılık alanı izlenmeli.";
  }

  return {
    missedOpportunityCount: total,
    topMissedSymbols,
    missedReasonBreakdown: breakdown,
    possibleAdjustmentArea: area,
    insufficientData: false,
  };
}

export { REASON_LABELS as MISSED_REASON_LABELS };
