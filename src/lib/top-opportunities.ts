export interface ScanDetail {
  symbol: string;
  signalType: string;
  signalScore: number;
  tier?: string;
  rejectReason?: string | null;
  opened?: boolean;
}

export interface OpportunityEntry {
  symbol: string;
  signalType: string;
  score: number;
  missingPoints: number;
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
  const withScore = scanDetails.filter((d) => d.signalScore > 0);
  withScore.sort((a, b) => b.signalScore - a.signalScore);
  const top = withScore.slice(0, maxCount);

  const items: OpportunityEntry[] = top.map((d) => {
    const opened = d.opened ?? false;
    const aboveThreshold = d.signalScore >= threshold;
    const missingPoints = Math.max(0, threshold - d.signalScore);

    let decision: string;
    if (opened) {
      decision = "Sanal işlem açıldı";
    } else if (aboveThreshold) {
      decision = "Eşik geçildi — sanal işlem bekleniyor";
    } else {
      decision = "Beklemede";
    }

    const mainReason = d.rejectReason ?? (opened ? "İşlem açıldı" : "—");

    return {
      symbol: d.symbol,
      signalType: d.signalType,
      score: d.signalScore,
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
