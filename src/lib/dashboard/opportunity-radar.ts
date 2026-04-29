// Phase 9 — Fırsat Radarı sayımları.
//
// Saf, observation-only türetimler. Tarama sonucundan dört temel grup
// üretir; signal-engine eşiği (70) ve risk engine kararı bu sayımlardan
// etkilenmez — sadece dashboard kartında grafiklenir.

import { SIGNAL_THRESHOLD } from "./labels";

export interface RadarRow {
  signalType?: string;
  tradeSignalScore?: number;
  signalScore?: number;
  setupScore?: number;
  marketQualityScore?: number;
  rejectReason?: string | null;
  riskAllowed?: boolean | null;
  riskRejectReason?: string | null;
  btcTrendRejected?: boolean;
  opened?: boolean;
  directionCandidate?: "LONG_CANDIDATE" | "SHORT_CANDIDATE" | "MIXED" | "NONE";
}

export interface RadarCounts {
  /** İşlem skoru >= 70 olan veya açılan coinler. */
  strongOpportunity: number;
  /** İşlem skoru 50-69 — eşiğe yakın aday. */
  nearThreshold: number;
  /** Yön belirsiz (WAIT / NONE / MIXED) — yön bekleyen. */
  awaitingDirection: number;
  /** Risk veya BTC filtresi nedeniyle elenen. */
  rejectedByRisk: number;
  /** Toplam değerlendirilen satır sayısı (debug). */
  total: number;
}

export function computeRadarCounts(rows: RadarRow[]): RadarCounts {
  let strongOpportunity = 0;
  let nearThreshold = 0;
  let awaitingDirection = 0;
  let rejectedByRisk = 0;

  for (const r of rows) {
    const score = r.tradeSignalScore ?? r.signalScore ?? 0;
    const opened = r.opened === true;

    // 1) Risk/BTC reddi → herhangi bir başka kategoriye girmeden buraya.
    if (r.btcTrendRejected || r.riskAllowed === false || r.riskRejectReason) {
      rejectedByRisk++;
      continue;
    }

    // 2) Güçlü fırsat: skor >= eşik veya açılmış pozisyon.
    if (opened || score >= SIGNAL_THRESHOLD) {
      strongOpportunity++;
      continue;
    }

    // 3) Eşiğe yakın: 50-69.
    if (score >= 50 && score < SIGNAL_THRESHOLD) {
      nearThreshold++;
      continue;
    }

    // 4) Yön bekleyen: WAIT/NO_TRADE veya direction belirsiz.
    if (
      r.signalType === "WAIT" ||
      r.signalType === "NO_TRADE" ||
      r.directionCandidate === "MIXED" ||
      r.directionCandidate === "NONE" ||
      !r.directionCandidate
    ) {
      awaitingDirection++;
    }
  }

  return {
    strongOpportunity,
    nearThreshold,
    awaitingDirection,
    rejectedByRisk,
    total: rows.length,
  };
}
