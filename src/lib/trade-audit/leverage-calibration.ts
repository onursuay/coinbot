// Faz 22 — Leverage Calibration.
// Kaldıraç config aralıklarını değerlendirir ve öneri üretir.
// Kaldıraç execution YAPMAZ. /fapi/v1/leverage çağrısı YOK.

import type { NormalizedTrade } from "@/lib/trade-performance";
import type { RiskExecutionConfig } from "@/lib/risk-settings/apply";
import type { LeverageCalibrationResult, LeverageCalibrationTag, AuditSeverity } from "./types";

export interface LeverageCalibrationInput {
  closedTrades: NormalizedTrade[];
  riskConfig: RiskExecutionConfig | null;
}

export function calibrateLeverage(input: LeverageCalibrationInput): LeverageCalibrationResult {
  const { closedTrades, riskConfig } = input;

  if (!riskConfig) {
    return insufficientResult("Risk config yok — kaldıraç kalibrasyonu yapılamıyor.", "riskConfig=null.",
      false, null, null, null);
  }

  const { CC, GNMR, MNLST } = riskConfig.leverageRanges;
  const ccMax = CC.max;
  const gnmrMax = GNMR.max;
  const mnlstMax = MNLST.max;
  const has30x = ccMax >= 30 || gnmrMax >= 30 || mnlstMax >= 30;

  // BLOCK_30X: 30x config'e alınmış ama hiç kârlı işlem yok
  if (has30x && closedTrades.length === 0) {
    return {
      tag: "BLOCK_30X",
      has30xConfigured: true,
      ccMax, gnmrMax, mnlstMax,
      mainFinding: "30x kaldıraç konfigürasyonda var ama performans verisi yok.",
      evidence: `CC max: ${ccMax}x, GNMR max: ${gnmrMax}x, MNLST max: ${mnlstMax}x. İşlem verisi yok.`,
      recommendation: "30x kullanmadan önce en az 20 başarılı işlem gözlemleyin.",
      severity: "critical",
    };
  }

  const closedWins = closedTrades.filter((t) => (t.pnl ?? 0) > 0);
  const winRate = closedTrades.length > 0 ? (closedWins.length / closedTrades.length) * 100 : 0;

  // BLOCK_30X: 30x var ve win rate yetersiz
  if (has30x && winRate < 50) {
    return {
      tag: "BLOCK_30X",
      has30xConfigured: true,
      ccMax, gnmrMax, mnlstMax,
      mainFinding: "30x kaldıraç konfigürasyonda var ve win rate yüksek kaldıraç için yetersiz.",
      evidence: `Win rate: %${winRate.toFixed(1)}, 30x için min %50 önerilir. CC: ${ccMax}x, GNMR: ${gnmrMax}x.`,
      recommendation: "30x kullanmadan önce win rate'in %55+ olmasını bekleyin. Mevcut performansla yüksek kaldıraç riskli.",
      severity: "critical",
    };
  }

  // OBSERVE_BEFORE_30X: 30x var ama henüz erken
  if (has30x && closedTrades.length < 20) {
    return {
      tag: "OBSERVE_BEFORE_30X",
      has30xConfigured: true,
      ccMax, gnmrMax, mnlstMax,
      mainFinding: "30x konfigürasyonda var ama performans kanıtı yetersiz.",
      evidence: `Kapanan işlem: ${closedTrades.length}. Win rate: %${winRate.toFixed(1)}. En az 20 işlem gerekiyor.`,
      recommendation: "30x'i aktive etmeden önce en az 20 işlem verisiyle performansı doğrulayın.",
      severity: "warning",
    };
  }

  // REDUCE_MAX_LEVERAGE: Maksimum kaldıraç > 20x ve win rate < 55
  if ((ccMax > 20 || gnmrMax > 20 || mnlstMax > 20) && winRate < 55 && closedTrades.length >= 5) {
    return {
      tag: "REDUCE_MAX_LEVERAGE",
      has30xConfigured: has30x,
      ccMax, gnmrMax, mnlstMax,
      mainFinding: "Yüksek kaldıraç sınırı mevcut performans seviyesi için uygun değil.",
      evidence: `Maks kaldıraç (CC:${ccMax}x, GNMR:${gnmrMax}x). Win rate: %${winRate.toFixed(1)}.`,
      recommendation: "Kaldıraç maksimumunu 20x'de tutun. Win rate %55'i geçince artırın.",
      severity: "warning",
    };
  }

  // DATA_INSUFFICIENT: Az veri
  if (closedTrades.length < 5) {
    return {
      tag: "DATA_INSUFFICIENT",
      has30xConfigured: has30x,
      ccMax, gnmrMax, mnlstMax,
      mainFinding: "Kaldıraç kalibrasyonu için yeterli işlem verisi yok.",
      evidence: `Kapanan işlem: ${closedTrades.length}. En az 5 işlem gerekiyor.`,
      recommendation: "Daha fazla veri birikmesini bekleyin.",
      severity: "info",
    };
  }

  return {
    tag: "KEEP_LEVERAGE_RANGE",
    has30xConfigured: has30x,
    ccMax, gnmrMax, mnlstMax,
    mainFinding: "Kaldıraç aralığı mevcut performansla uyumlu görünüyor.",
    evidence: `CC: ${ccMax}x, GNMR: ${gnmrMax}x, MNLST: ${mnlstMax}x. Win rate: %${winRate.toFixed(1)}.`,
    recommendation: "Mevcut kaldıraç aralığını koruyun. Performansı izlemeye devam edin.",
    severity: "info",
  };
}

function insufficientResult(
  mainFinding: string,
  evidence: string,
  has30x: boolean,
  ccMax: number | null,
  gnmrMax: number | null,
  mnlstMax: number | null,
): LeverageCalibrationResult {
  return {
    tag: "DATA_INSUFFICIENT",
    has30xConfigured: has30x,
    ccMax, gnmrMax, mnlstMax,
    mainFinding,
    evidence,
    recommendation: "Daha fazla veri ve config gerekiyor.",
    severity: "info",
  };
}
