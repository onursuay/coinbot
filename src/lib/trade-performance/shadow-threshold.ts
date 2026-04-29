// Phase 13 — Shadow threshold analizi.
//
// "Eşik 65 olsaydı kaç işlem açılırdı?" sorusunu cevaplar. Bu fonksiyon
// MIN_SIGNAL_CONFIDENCE değerini ASLA değiştirmez; sadece hipotetik gözlem
// sağlar. Sonuçtaki `liveThreshold` her zaman 70'tir ve `liveThresholdUnchanged`
// her zaman `true`.

import type {
  ScanRowInput,
  ShadowThresholdReport,
  ShadowThresholdRow,
  ShadowThresholdValue,
} from "./types";

const SHADOW_THRESHOLDS: ShadowThresholdValue[] = [60, 65, 70, 75];

const RECOMMENDATION: Record<ShadowThresholdValue, string> = {
  60: "Çok düşük — kalitesiz sinyallerin açılmasına yol açar; canlı eşik için ÖNERİLMEZ.",
  65: "Daha gevşek — fırsat sayısı artar ama kalite düşebilir.",
  70: "Mevcut canlı eşik. Bu bot için varsayılan kabul edilir.",
  75: "Daha katı — daha az ama daha temiz sinyaller.",
};

function qualityForThreshold(t: ShadowThresholdValue): number {
  // Yüksek eşik → yüksek tahmini kalite. Lineer basit bir model yeterli.
  return t === 60 ? 55 : t === 65 ? 65 : t === 70 ? 80 : 90;
}

function riskForThreshold(t: ShadowThresholdValue): number {
  // Düşük eşik → yüksek tahmini risk.
  return t === 60 ? 75 : t === 65 ? 60 : t === 70 ? 35 : 20;
}

export function analyzeShadowThresholds(scanRows: ScanRowInput[]): ShadowThresholdReport {
  const validRows = scanRows.filter((r) => {
    // Sadece sinyal üreten satırlar — WAIT/UNKNOWN değil.
    if (r.signalType !== "LONG" && r.signalType !== "SHORT" && r.signalType !== "NO_TRADE") return false;
    // BTC veto / risk gate altındakiler hipotetik açma sayımına da dahil edilmez —
    // amaç eşik etkisini izole etmek.
    if (r.btcTrendRejected) return false;
    if (r.riskRejectReason) return false;
    return true;
  });

  const rows: ShadowThresholdRow[] = SHADOW_THRESHOLDS.map((t) => {
    const count = validRows.filter((r) => {
      const score = r.tradeSignalScore ?? r.signalScore ?? 0;
      return score >= t;
    }).length;
    return {
      threshold: t,
      hypotheticalTradeCount: count,
      estimatedQuality: qualityForThreshold(t),
      estimatedRisk: riskForThreshold(t),
      recommendation: RECOMMENDATION[t],
    };
  });

  return {
    liveThreshold: 70,
    rows,
    liveThresholdUnchanged: true,
  };
}
