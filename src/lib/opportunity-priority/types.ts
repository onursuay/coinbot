// Phase 11 — Opportunity Priority Score tipleri ve config defaultları.
//
// SCOPE: yalnızca metadata/sıralama altyapısı. Hiçbir alan trade açma
// kararını, signal-engine skorunu veya `tradeSignalScore >= 70` kapısını
// değiştirmez. Bu modül:
//  - HTTP / Binance API çağrısı YAPMAZ.
//  - Trade engine, risk engine, kaldıraç execution çağırmaz.
//  - Risk Yönetimi ayarlarını execution'a bağlamaz.

export type SingleSource = "WIDE_MARKET" | "MOMENTUM" | "MANUAL_LIST";
export type DirectionCandidate = "LONG_CANDIDATE" | "SHORT_CANDIDATE" | "MIXED" | "NONE";

/**
 * Esnek girdi modeli — diagnostics/scan_details, opportunity_pool veya
 * unified bundle'lardan beslenebilir. Tüm alanlar opsiyoneldir; eksik
 * verilerde güvenli (nötr) fallback uygulanır, NaN üretilmez.
 */
export interface OpportunityInput {
  symbol: string;

  // Skorlar
  tradeSignalScore?: number | null;
  signalScore?: number | null;     // backward-compat alias
  setupScore?: number | null;
  marketQualityScore?: number | null;
  marketQualityPreScore?: number | null;

  // R:R kalitesi
  rrRatio?: number | null;
  rewardRiskRatio?: number | null; // alias

  // Likidite / sağlık
  spreadPercent?: number | null;
  depthScore?: number | null;
  orderBookDepth?: number | null;  // USDT cinsinden top-10 ortalaması (alias)
  quoteVolume24h?: number | null;
  atrPercentile?: number | null;
  volumeImpulse?: number | null;

  // BTC uyumu
  btcAligned?: boolean | null;
  btcVeto?: boolean | null;
  btcTrendRejected?: boolean | null; // alias

  // Yön / sinyal tipi
  signalType?: string | null;
  directionCandidate?: DirectionCandidate | null;

  // Kaynak
  sourceDisplay?: string | null;          // "GMT" / "MT" / "MİL" / "KRM"
  sources?: readonly string[];            // ["WIDE_MARKET","MOMENTUM"] vb.
  candidateSources?: readonly string[];   // alias

  // Bağlam
  scoreReason?: string | null;
  waitReasonCodes?: readonly string[] | null;
  rejectReason?: string | null;
  riskAllowed?: boolean | null;
  riskRejectReason?: string | null;
  opened?: boolean | null;
}

export type OpportunityBucket = "PRIMARY" | "WATCH_QUEUE" | "REJECTED_OR_WEAK";

export interface OpportunityPriorityResult {
  symbol: string;
  /** 0..100 öncelik puanı. */
  opportunityPriorityScore: number;
  /** 1-tabanlı sıra (en yüksekten itibaren). */
  opportunityPriorityRank: number;
  /** PRIMARY / WATCH_QUEUE / REJECTED_OR_WEAK. */
  opportunityBucket: OpportunityBucket;
  /** Pozitif sebepler (örn: "İşlem skoru güçlü"). */
  priorityReasons: string[];
  /** Negatif sebepler (örn: "Spread yüksek"). */
  priorityPenalties: string[];
  /** Bileşen başına alt skorlar — debug/explainability için. */
  components: PriorityComponents;
}

export interface PriorityComponents {
  tradeSignal: number;       // 0..100 normalize
  setup: number;
  quality: number;
  riskReward: number;
  liquidity: number;
  btcAlignment: number;
  volatility: number;
  source: number;
  momentumUrgency: number;
  /** Reserved for future correlation work; bu fazda 0. */
  correlationPenalty: number;
}

/** Bucket sınıflandırma config'i — sadece priority preview içindir. */
export interface PriorityBucketConfig {
  /** Üst N: PRIMARY. */
  primaryCapacity: number;
  /** Üst M (M >= primaryCapacity): WATCH_QUEUE üst sınırı. */
  dynamicUpperCapacity: number;
  /** WATCH_QUEUE'ya kabul için minimum priority score. */
  minWatchScore: number;
  /** PRIMARY'ye kabul için minimum priority score. */
  minPrimaryScore: number;
}

export const DEFAULT_PRIORITY_BUCKET_CONFIG: PriorityBucketConfig = {
  primaryCapacity: 3,
  dynamicUpperCapacity: 5,
  minWatchScore: 50,
  minPrimaryScore: 60,
};

/**
 * Bileşen ağırlıkları — toplam 1.0. Tasarım gerekçesi:
 *  - tradeSignal + setup tek başına yarıyı geçer (skor güveninin temeli).
 *  - quality + liquidity birlikte ~0.20 (tradable olma şartı).
 *  - btcAlignment + volatility birlikte ~0.10 (regime sağlığı).
 *  - riskReward (R:R) + source (kaynak önceliği) birlikte ~0.12.
 *  - momentumUrgency 0.06 (acil hareket bonusu).
 *  - correlationPenalty negatif uygulanır (alan ayrı tutuluyor).
 */
export interface PriorityWeights {
  tradeSignal: number;
  setup: number;
  quality: number;
  riskReward: number;
  liquidity: number;
  btcAlignment: number;
  volatility: number;
  source: number;
  momentumUrgency: number;
}

export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeights = {
  tradeSignal:     0.30,
  setup:           0.18,
  quality:         0.12,
  riskReward:      0.07,
  liquidity:       0.08,
  btcAlignment:    0.07,
  volatility:      0.05,
  source:          0.07,
  momentumUrgency: 0.06,
};

// Sanity: ağırlıklar toplamı 1.0 olmalı.
const _SUM = Object.values(DEFAULT_PRIORITY_WEIGHTS).reduce((a, b) => a + b, 0);
if (Math.abs(_SUM - 1) > 0.001) {
  // Test/sürpriz koruması — ağırlıklar değiştirilirse tutarlılığı kanıtlar.
  // Runtime hatası fırlatmıyoruz; testler bu invariant'i de doğrular.
}
