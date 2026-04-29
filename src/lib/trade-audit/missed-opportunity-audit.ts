// Faz 22 — Missed Opportunity Audit.
// Reddedilen / kaçan fırsatları mevcut scan_details verisiyle analiz eder.
// Future-price backtest YAPILMAZ; veri yoksa DATA_INSUFFICIENT döner.
// Sahte sonuç üretmez.

import type { ScanRowInput } from "@/lib/trade-performance";
import type { MissedOpportunityAuditResult, MissedOpportunityAuditTag, AuditSeverity } from "./types";

export function auditMissedOpportunities(scanRows: ScanRowInput[]): MissedOpportunityAuditResult {
  if (!scanRows || scanRows.length === 0) {
    return {
      tag: "DATA_INSUFFICIENT",
      btcFilteredCount: 0,
      riskGateRejectedCount: 0,
      band60to69Count: 0,
      mainFinding: "Scan verisi yok — kaçan fırsat analizi yapılamıyor.",
      evidence: "scanRows boş. Son tick verisi mevcut değil.",
      recommendation: "Bot en az bir kez çalıştırılınca scan verisi oluşur.",
      severity: "info",
    };
  }

  const btcFiltered = scanRows.filter((r) => r.btcTrendRejected === true).length;
  const riskGateRejected = scanRows.filter((r) =>
    (r.riskRejectReason && r.riskRejectReason.length > 0) ||
    (r.waitReasonCodes ?? []).some((c) => c.includes("RISK"))
  ).length;

  const band60to69 = scanRows.filter((r) => {
    const score = r.tradeSignalScore ?? r.signalScore ?? 0;
    return score >= 60 && score < 70;
  }).length;

  const totalFiltered = btcFiltered + riskGateRejected;
  const totalCandidates = scanRows.length;
  const filterRatio = totalCandidates > 0 ? totalFiltered / totalCandidates : 0;

  // THRESHOLD_TOO_STRICT_SUSPECT: 60-69 bandında çok fazla aday var
  if (band60to69 >= 5 && band60to69 > totalCandidates * 0.4) {
    return makeResult("THRESHOLD_TOO_STRICT_SUSPECT", btcFiltered, riskGateRejected, band60to69,
      "60-69 bandında çok sayıda aday var — eşik gereğinden sıkı olabilir.",
      `60-69 band: ${band60to69} aday (toplam: ${totalCandidates}, %${Math.round(band60to69 / totalCandidates * 100)}).`,
      "Bu bandın geçmiş başarısını gözlemleyin. 70 eşiği değiştirilmez — sadece gözlem.",
      "info");
  }

  // FILTER_TOO_STRICT_SUSPECT: BTC veya risk filtresi çok fazla reddediyor
  if (filterRatio > 0.5 && totalFiltered >= 5) {
    const dominant = btcFiltered > riskGateRejected ? "BTC filtresi" : "risk gate";
    return makeResult("FILTER_TOO_STRICT_SUSPECT", btcFiltered, riskGateRejected, band60to69,
      `${dominant} çok fazla adayı reddediyor — fırsat kaçıyor olabilir.`,
      `BTC filtresi: ${btcFiltered}, Risk gate: ${riskGateRejected}, Toplam: ${totalCandidates}. Filtre oranı: %${Math.round(filterRatio * 100)}.`,
      `${dominant} davranışını izleyin. Filtre ayarları bu fazda değiştirilmez.`,
      "info");
  }

  // Fırsat kaçırma düzeyi belirleme
  let tag: MissedOpportunityAuditTag;
  let severity: AuditSeverity;

  if (totalFiltered === 0 && band60to69 === 0) {
    tag = "MISSED_OPPORTUNITY_LOW";
    severity = "info";
  } else if (totalFiltered < 3 && band60to69 < 3) {
    tag = "MISSED_OPPORTUNITY_LOW";
    severity = "info";
  } else if (totalFiltered < 8 || band60to69 < 5) {
    tag = "MISSED_OPPORTUNITY_MODERATE";
    severity = "info";
  } else {
    tag = "MISSED_OPPORTUNITY_HIGH";
    severity = "warning";
  }

  const mainFindingMap: Partial<Record<MissedOpportunityAuditTag, string>> = {
    MISSED_OPPORTUNITY_LOW: "Düşük kaçan fırsat seviyesi.",
    MISSED_OPPORTUNITY_MODERATE: "Orta düzey kaçan fırsat — izleme önerilir.",
    MISSED_OPPORTUNITY_HIGH: "Yüksek kaçan fırsat — filtre ve eşik değerlerini gözlemleyin.",
  };

  return makeResult(tag, btcFiltered, riskGateRejected, band60to69,
    mainFindingMap[tag] ?? tag,
    `BTC filtresi: ${btcFiltered}, Risk gate: ${riskGateRejected}, 60-69 band: ${band60to69}, Toplam: ${totalCandidates}.`,
    "Gelecek fiyat verisi olmadan kesin sonuç üretilemez. Gözlem modunda izleyin.",
    severity);
}

function makeResult(
  tag: MissedOpportunityAuditTag,
  btcFiltered: number,
  riskGateRejected: number,
  band60to69: number,
  mainFinding: string,
  evidence: string,
  recommendation: string,
  severity: AuditSeverity,
): MissedOpportunityAuditResult {
  return { tag, btcFilteredCount: btcFiltered, riskGateRejectedCount: riskGateRejected, band60to69Count: band60to69, mainFinding, evidence, recommendation, severity };
}
