// Faz 22 — Limit Calibration.
// Max açık pozisyon, dinamik kapasite ve günlük işlem sınırlarını değerlendirir.
// Limitleri otomatik DEĞİŞTİRMEZ.

import type { NormalizedTrade } from "@/lib/trade-performance";
import type { RiskExecutionConfig } from "@/lib/risk-settings/apply";
import type { LimitCalibrationResult, LimitCalibrationTag, AuditSeverity } from "./types";

export interface LimitCalibrationInput {
  trades: NormalizedTrade[];
  riskConfig: RiskExecutionConfig | null;
}

export function calibrateLimits(input: LimitCalibrationInput): LimitCalibrationResult {
  const { trades, riskConfig } = input;

  if (!riskConfig) {
    return insufficientResult("Risk config yok — limit kalibrasyonu yapılamıyor.", "riskConfig=null.",
      0, 0, 0);
  }

  const maxOpen = riskConfig.defaultMaxOpenPositions;
  const dynCap = riskConfig.dynamicMaxOpenPositions;
  const maxDaily = riskConfig.maxDailyTrades;

  if (trades.length < 3) {
    return insufficientResult(
      "Yeterli işlem verisi yok — limit kalibrasyonu için en az 3 işlem gerekiyor.",
      `İşlem sayısı: ${trades.length}.`,
      maxOpen, dynCap, maxDaily,
    );
  }

  const dailyCounts = countDailyTrades(trades);
  const maxDailyObserved = Math.max(0, ...Object.values(dailyCounts));
  const avgDailyObserved = Object.values(dailyCounts).length > 0
    ? Object.values(dailyCounts).reduce((a, b) => a + b, 0) / Object.values(dailyCounts).length
    : 0;

  // OVERTRADE_RISK: Günlük gözlemlenen işlem günlük maks'a yakın veya geçiyor
  if (maxDailyObserved >= maxDaily) {
    return makeResult("OVERTRADE_RISK", maxOpen, dynCap, maxDaily,
      "Günlük işlem limiti aşılmış veya sınırda — overtrade riski.",
      `Maks gözlemlenen günlük işlem: ${maxDailyObserved}, limit: ${maxDaily}.`,
      "Günlük max işlem sınırını artırmak yerine sinyal kalitesini gözlemleyin.",
      "warning");
  }

  // REVIEW_MAX_DAILY_TRADES: Günlük ortalama yüksek
  if (avgDailyObserved > maxDaily * 0.8) {
    return makeResult("REVIEW_MAX_DAILY_TRADES", maxOpen, dynCap, maxDaily,
      "Günlük işlem sayısı sınıra yakın seyrediyior.",
      `Ort. günlük işlem: ${avgDailyObserved.toFixed(1)}, limit: ${maxDaily}.`,
      "Günlük max işlem sınırını ve sinyal kalitesini gözden geçirin.",
      "info");
  }

  // REVIEW_MAX_OPEN_POSITIONS: maxOpen=3 ile fırsatlar kuyruğa mı düşüyor?
  if (maxOpen <= 3 && dynCap <= maxOpen) {
    return makeResult("REVIEW_MAX_OPEN_POSITIONS", maxOpen, dynCap, maxDaily,
      "Dinamik kapasite varsayılan sınıra eşit — fırsatlar kuyruğa düşüyor olabilir.",
      `defaultMaxOpen: ${maxOpen}, dynamicCap: ${dynCap}. Dinamik cap varsayılanla aynı.`,
      "Dinamik üst sınırı 5'e yükseltin; güçlü piyasada daha fazla pozisyon alınabilir.",
      "info");
  }

  // REVIEW_DYNAMIC_CAPACITY: dynCap < 5 iken yeterli performans var mı?
  if (dynCap < 5 && trades.filter((t) => t.status === "closed" && (t.pnl ?? 0) > 0).length >= 5) {
    return makeResult("REVIEW_DYNAMIC_CAPACITY", maxOpen, dynCap, maxDaily,
      "Dinamik kapasite sınırlı — iyi fırsatlar kapasite yüzünden kuyruğa düşüyor olabilir.",
      `dynamicCap: ${dynCap}. 5'in altında kalmak bazı fırsatları kaçırır.`,
      "Dinamik üst sınırı 5'e yükseltmeyi değerlendirin.",
      "info");
  }

  return makeResult("KEEP_LIMITS", maxOpen, dynCap, maxDaily,
    "Limit ayarları mevcut işlem sıklığına uygun görünüyor.",
    `maxOpen: ${maxOpen}, dynCap: ${dynCap}, maxDaily: ${maxDaily}. Maks gün: ${maxDailyObserved}.`,
    "Mevcut limitler makul. Gözlemeye devam edin.",
    "info");
}

function countDailyTrades(trades: NormalizedTrade[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of trades) {
    const day = t.openedAt.slice(0, 10);
    counts[day] = (counts[day] ?? 0) + 1;
  }
  return counts;
}

function makeResult(
  tag: LimitCalibrationTag,
  maxOpen: number,
  dynCap: number,
  maxDaily: number,
  mainFinding: string,
  evidence: string,
  recommendation: string,
  severity: AuditSeverity,
): LimitCalibrationResult {
  return { tag, defaultMaxOpenPositions: maxOpen, dynamicMaxOpenPositions: dynCap, maxDailyTrades: maxDaily, mainFinding, evidence, recommendation, severity };
}

function insufficientResult(
  mainFinding: string,
  evidence: string,
  maxOpen: number,
  dynCap: number,
  maxDaily: number,
): LimitCalibrationResult {
  return makeResult("DATA_INSUFFICIENT", maxOpen, dynCap, maxDaily, mainFinding, evidence, "Daha fazla veri bekleniyor.", "info");
}
