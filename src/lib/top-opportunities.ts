export interface ScanDetail {
  symbol: string;
  signalType: string;
  signalScore: number;          // tradeSignalScore: trade confidence (0 = no trade)
  setupScore?: number;          // opportunity quality score (>0 even for WAIT)
  marketQualityScore?: number;  // coin tradability quality
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

    const aboveThreshold = tradeSignalScore >= threshold;
    // Best visible score: trade signal if available, otherwise setup score
    const score = tradeSignalScore > 0 ? tradeSignalScore : setupScore;
    const missingPoints = tradeSignalScore > 0
      ? Math.max(0, threshold - tradeSignalScore)
      : threshold; // no trade signal at all → needs full 70 more

    let decision: string;
    if (opened) {
      decision = "Sanal işlem açıldı";
    } else if (aboveThreshold) {
      decision = "Eşik geçildi — sanal işlem bekleniyor";
    } else if (tradeSignalScore > 0) {
      decision = `İşlem skoru yetersiz (${tradeSignalScore}/70)`;
    } else if (setupScore >= 50) {
      decision = "Fırsat yapısı var, işlem şartı tamamlanmadı";
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
