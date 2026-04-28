export type DirectionCandidate = "LONG_CANDIDATE" | "SHORT_CANDIDATE" | "MIXED" | "NONE";

export interface ScanDetail {
  symbol: string;
  signalType: string;
  signalScore: number;          // tradeSignalScore: trade confidence (0 = no trade)
  setupScore?: number;          // opportunity quality score (>0 even for WAIT)
  marketQualityScore?: number;  // coin tradability quality
  // Direction explainability — display-only, never affects ranking weights for trade-opening.
  longSetupScore?: number;
  shortSetupScore?: number;
  directionCandidate?: DirectionCandidate;
  directionConfidence?: number;
  tier?: string;
  rejectReason?: string | null;
  opened?: boolean;
}

export interface OpportunityEntry {
  symbol: string;
  signalType: string;
  score: number;          // best available score (tradeSignalScore if > 0, else setupScore)
  tradeSignalScore: number;
  setupScore: number;
  marketQualityScore: number;
  // Mirrored direction explainability — diagnostic display only, never used to open trades.
  longSetupScore: number;
  shortSetupScore: number;
  directionCandidate: DirectionCandidate;
  directionConfidence: number;
  missingPoints: number;  // points to reach tradeSignalScore threshold (70)
  mainReason: string;
  decision: string;
  opened: boolean;
  aboveThreshold: boolean;
}

export interface TopOpportunitiesResult {
  items: OpportunityEntry[];
  hasStrongOpportunity: boolean;
  insufficientData: boolean;
}

export function getTopOpportunities(
  scanDetails: ScanDetail[],
  threshold = 70,
  maxCount = 5,
): TopOpportunitiesResult {
  // Include coins with any meaningful score (trade signal OR setup quality)
  const withScore = scanDetails.filter(
    (d) => d.signalScore > 0 || (d.setupScore ?? 0) > 0,
  );

  // Sort: highest tradeSignalScore first, then setupScore as tiebreaker
  withScore.sort((a, b) => {
    if (b.signalScore !== a.signalScore) return b.signalScore - a.signalScore;
    return (b.setupScore ?? 0) - (a.setupScore ?? 0);
  });

  const top = withScore.slice(0, maxCount);

  const items: OpportunityEntry[] = top.map((d) => {
    const opened = d.opened ?? false;
    const tradeSignalScore = d.signalScore;
    const setupScore = d.setupScore ?? 0;
    const marketQualityScore = d.marketQualityScore ?? 0;
    const longSetupScore = d.longSetupScore ?? 0;
    const shortSetupScore = d.shortSetupScore ?? 0;
    const directionCandidate = d.directionCandidate ?? "NONE";
    const directionConfidence = d.directionConfidence ?? 0;

    const aboveThreshold = tradeSignalScore >= threshold;
    // Best visible score: trade signal if available, otherwise setup score
    const score = tradeSignalScore > 0 ? tradeSignalScore : setupScore;
    const missingPoints = tradeSignalScore > 0
      ? Math.max(0, threshold - tradeSignalScore)
      : threshold; // no trade signal at all → needs full 70 more

    // Decision text — directionCandidate enriches the "needs confirmation" path
    // but is NEVER used to open a trade. The threshold gate stays canonical.
    const directionHint =
      directionCandidate === "LONG_CANDIDATE" ? "LONG yönü teyidi bekleniyor" :
      directionCandidate === "SHORT_CANDIDATE" ? "SHORT yönü teyidi bekleniyor" :
      directionCandidate === "MIXED" ? "Yön karışık, teyit bekleniyor" :
      null;

    let decision: string;
    if (opened) {
      decision = "Sanal işlem açıldı";
    } else if (aboveThreshold) {
      decision = "Eşik geçildi — sanal işlem bekleniyor";
    } else if (tradeSignalScore > 0) {
      decision = `İşlem skoru yetersiz (${tradeSignalScore}/70)`;
    } else if (setupScore >= 50) {
      decision = directionHint
        ? `Fırsat yapısı var — ${directionHint}`
        : "Fırsat yapısı var, işlem şartı tamamlanmadı";
    } else if (directionHint) {
      decision = directionHint;
    } else {
      decision = "Beklemede";
    }

    const mainReason = d.rejectReason ?? (opened ? "İşlem açıldı" : "—");

    return {
      symbol: d.symbol,
      signalType: d.signalType,
      score,
      tradeSignalScore,
      setupScore,
      marketQualityScore,
      longSetupScore,
      shortSetupScore,
      directionCandidate,
      directionConfidence,
      missingPoints,
      mainReason,
      decision,
      opened,
      aboveThreshold,
    };
  });

  return {
    items,
    hasStrongOpportunity: items.some((i) => i.aboveThreshold || i.opened),
    insufficientData: withScore.length < maxCount,
  };
}
