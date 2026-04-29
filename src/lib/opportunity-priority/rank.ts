// Phase 11 — Sıralama + bucket sınıflandırma.
//
// Saf fonksiyonlar. Trade engine, signal-engine, risk engine veya canlı
// trading gate üzerinde HİÇBİR etkisi YOKTUR. Yalnızca metadata üretir.

import {
  DEFAULT_PRIORITY_BUCKET_CONFIG,
  type OpportunityInput,
  type OpportunityPriorityResult,
  type PriorityBucketConfig,
} from "./types";
import { computeOpportunityPriorityScore, type ComputeOptions } from "./score";

function num(v: number | null | undefined, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Adayları opportunityPriorityScore'a göre azalan sırada sıralar.
 *
 * Tiebreaker (sırasıyla):
 *   1. opportunityPriorityScore desc
 *   2. tradeSignalScore (ya da signalScore) desc
 *   3. setupScore desc
 *   4. marketQualityScore desc
 *   5. quoteVolume24h desc
 *   6. symbol asc (deterministic kararlılık)
 */
export function rankOpportunities(
  candidates: OpportunityInput[],
  opts: ComputeOptions & { config?: Partial<PriorityBucketConfig> } = {},
): OpportunityPriorityResult[] {
  const cfg: PriorityBucketConfig = {
    ...DEFAULT_PRIORITY_BUCKET_CONFIG,
    ...(opts.config ?? {}),
  };

  // 1) Skorla
  const scored = candidates.map((c) => {
    const out = computeOpportunityPriorityScore(c, opts);
    return { input: c, out };
  });

  // 2) Sırala (deterministic)
  scored.sort((a, b) => {
    if (b.out.score !== a.out.score) return b.out.score - a.out.score;
    const at = num(a.input.tradeSignalScore ?? a.input.signalScore);
    const bt = num(b.input.tradeSignalScore ?? b.input.signalScore);
    if (bt !== at) return bt - at;
    const as = num(a.input.setupScore);
    const bs = num(b.input.setupScore);
    if (bs !== as) return bs - as;
    const aq = num(a.input.marketQualityScore);
    const bq = num(b.input.marketQualityScore);
    if (bq !== aq) return bq - aq;
    const av = num(a.input.quoteVolume24h);
    const bv = num(b.input.quoteVolume24h);
    if (bv !== av) return bv - av;
    return a.input.symbol.localeCompare(b.input.symbol);
  });

  // 3) Bucket sınıflandır + 1-tabanlı rank ata
  return scored.map((row, i) => {
    const rank = i + 1;
    const bucket = classifyOpportunityBucket({
      input: row.input,
      score: row.out.score,
      rank,
      config: cfg,
    });
    return {
      symbol: row.input.symbol,
      opportunityPriorityScore: row.out.score,
      opportunityPriorityRank: rank,
      opportunityBucket: bucket,
      priorityReasons: row.out.reasons,
      priorityPenalties: row.out.penalties,
      components: row.out.components,
    };
  });
}

/**
 * Bucket sınıflandırma:
 *  - Üst N (primaryCapacity) ve `score >= minPrimaryScore` → PRIMARY
 *  - Üst M (dynamicUpperCapacity) ve `score >= minWatchScore` → WATCH_QUEUE
 *  - Diğerleri → REJECTED_OR_WEAK
 *
 * BTC veto, risk reddi veya `tradeSignalScore <= 0` ile setup yokluğu
 * doğrudan REJECTED_OR_WEAK'e düşürür — sıralama yine de yapılır.
 */
export function classifyOpportunityBucket(args: {
  input: OpportunityInput;
  score: number;
  rank: number;
  config?: PriorityBucketConfig;
}): "PRIMARY" | "WATCH_QUEUE" | "REJECTED_OR_WEAK" {
  const cfg = args.config ?? DEFAULT_PRIORITY_BUCKET_CONFIG;
  const i = args.input;
  const ts = num(i.tradeSignalScore ?? i.signalScore);
  const su = num(i.setupScore);

  // 1) Hard penalties → zayıf
  if (i.btcVeto === true || i.btcTrendRejected === true) return "REJECTED_OR_WEAK";
  if (i.riskAllowed === false || i.riskRejectReason) return "REJECTED_OR_WEAK";
  if (ts <= 0 && su <= 0) return "REJECTED_OR_WEAK";

  // 2) Skor eşikleri
  if (
    args.rank <= cfg.primaryCapacity &&
    args.score >= cfg.minPrimaryScore
  ) {
    return "PRIMARY";
  }
  if (
    args.rank <= cfg.dynamicUpperCapacity &&
    args.score >= cfg.minWatchScore
  ) {
    return "WATCH_QUEUE";
  }
  return "REJECTED_OR_WEAK";
}
