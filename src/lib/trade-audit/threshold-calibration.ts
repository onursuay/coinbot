// Faz 22 — Threshold Calibration.
// MIN_SIGNAL_CONFIDENCE=70 eşiğini geçmiş işlem verisiyle değerlendirir.
// Eşiği otomatik DEĞİŞTİRMEZ. liveThreshold daima 70; liveThresholdUnchanged daima true.

import type { NormalizedTrade, ScanRowInput } from "@/lib/trade-performance";
import type { ThresholdCalibrationResult, ThresholdCalibrationTag, AuditSeverity } from "./types";

export interface ThresholdCalibrationInput {
  trades: NormalizedTrade[];
  scanRows: ScanRowInput[];
}

export function calibrateThreshold(input: ThresholdCalibrationInput): ThresholdCalibrationResult {
  const { trades, scanRows } = input;

  const closed = trades.filter((t) => t.status === "closed");

  // 70-74 bandındaki işlemler
  const band70to74 = closed.filter((t) => {
    const s = t.signalScore ?? 0;
    return s >= 70 && s <= 74;
  });

  // 65-69 bandındaki scan rows (açılmamış adaylar)
  const band65to69inScan = scanRows.filter((r) => {
    const s = r.tradeSignalScore ?? r.signalScore ?? 0;
    return s >= 65 && s < 70;
  }).length;

  // 75+ bandındaki işlemler
  const band75plus = closed.filter((t) => (t.signalScore ?? 0) >= 75);

  if (closed.length < 5) {
    return {
      tag: "DATA_INSUFFICIENT",
      liveThreshold: 70,
      liveThresholdUnchanged: true,
      band70to74WinRate: null,
      band65to69Count: band65to69inScan,
      mainFinding: "Eşik kalibrasyonu için yeterli veri yok.",
      evidence: `Kapanan işlem: ${closed.length}. En az 5 gerekiyor.`,
      recommendation: "70 eşiği korunuyor. Daha fazla veri bekleniyor.",
      severity: "info",
    };
  }

  const wins70to74 = band70to74.filter((t) => (t.pnl ?? 0) > 0).length;
  const band70to74WinRate = band70to74.length > 0
    ? (wins70to74 / band70to74.length) * 100
    : null;

  const wins75plus = band75plus.filter((t) => (t.pnl ?? 0) > 0).length;
  const band75WinRate = band75plus.length > 0
    ? (wins75plus / band75plus.length) * 100
    : null;

  let tag: ThresholdCalibrationTag;
  let mainFinding: string;
  let evidence: string;
  let recommendation: string;
  let severity: AuditSeverity;

  // 70-74 bandı çok kötü performans: Eşiği daha yükseğe çekme düşünülebilir
  if (band70to74WinRate !== null && band70to74WinRate < 35 && band70to74.length >= 5) {
    tag = "REVIEW_THRESHOLD_LATER";
    mainFinding = "70-74 bant win rate'i düşük — eşik kalibrasyonu ileride değerlendirilebilir.";
    evidence = `70-74 win rate: %${band70to74WinRate.toFixed(1)} (${band70to74.length} işlem). Eşik değiştirilmez.`;
    recommendation = "70 eşiği korunuyor. 14 gün daha gözlem sonrası tekrar değerlendirin.";
    severity = "info";
  }
  // 70-74 ve 75+ arasında büyük fark yoksa eşik iyi
  else if (band70to74WinRate !== null && band75WinRate !== null && Math.abs(band70to74WinRate - band75WinRate) < 15) {
    tag = "KEEP_70";
    mainFinding = "70 eşiği iyi kalibre görünüyor — 70-74 ve 75+ bantları benzer kalite.";
    evidence = `70-74 win rate: %${band70to74WinRate.toFixed(1)}, 75+ win rate: %${band75WinRate.toFixed(1)}.`;
    recommendation = "70 eşiği korunmalı. Mevcut performans eşiği destekliyor.";
    severity = "info";
  }
  // 65-69 bandında çok fazla aday varsa gözlem
  else if (band65to69inScan >= 5) {
    tag = "OBSERVE_65_69";
    mainFinding = "65-69 bandında kayda değer sayıda aday var — gözlem önerilir.";
    evidence = `65-69 scan adayı: ${band65to69inScan}. Eşik değiştirilmez.`;
    recommendation = "70 eşiği korunuyor. 65-69 bandının geçmiş sonuçlarını izleyin.";
    severity = "info";
  }
  // Standart: eşik korunacak
  else {
    tag = "KEEP_70";
    mainFinding = "70 sinyal eşiği korunuyor — mevcut performans eşiği destekliyor.";
    evidence = `70-74 band: ${band70to74.length} işlem, win rate: ${band70to74WinRate !== null ? `%${band70to74WinRate.toFixed(1)}` : "—"}.`;
    recommendation = "MIN_SIGNAL_CONFIDENCE=70 değiştirilmez. Gözleme devam.";
    severity = "info";
  }

  return {
    tag,
    liveThreshold: 70,
    liveThresholdUnchanged: true,
    band70to74WinRate: band70to74WinRate !== null ? Math.round(band70to74WinRate * 10) / 10 : null,
    band65to69Count: band65to69inScan,
    mainFinding,
    evidence,
    recommendation,
    severity,
  };
}
