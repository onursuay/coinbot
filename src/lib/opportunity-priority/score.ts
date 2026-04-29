// Phase 11 — Opportunity Priority Score (saf hesaplayıcı).
//
// Bu modül yalnızca metadata üretir. Trade açma kararı, signal-engine,
// risk engine ve canlı trading gate üzerinde HİÇBİR etkisi YOKTUR.
// Eksik veriler için güvenli (nötr) fallback uygulanır; NaN üretmez.

import {
  DEFAULT_PRIORITY_WEIGHTS,
  type OpportunityInput,
  type PriorityComponents,
  type PriorityWeights,
} from "./types";

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

/** İçeride kullanılan saf yardımcı: sayı değilse fallback. */
function num(v: number | null | undefined, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Skor oluşumunu açıklayıcı tek atış sonuç. */
export interface PriorityScoreOutput {
  score: number;                        // 0..100
  components: PriorityComponents;       // alt skorlar 0..100
  reasons: string[];                    // pozitif sebepler
  penalties: string[];                  // negatif sebepler
}

// ── Bileşen hesapları ───────────────────────────────────────────────────

/** tradeSignalScore — trade güveni; alias `signalScore`. */
function scoreTradeSignal(c: OpportunityInput): { v: number; reason?: string; penalty?: string } {
  const t = num(c.tradeSignalScore ?? c.signalScore, 0);
  if (t >= 70) return { v: 100, reason: "İşlem skoru güçlü (≥70)" };
  if (t >= 50) return { v: 60 + (t - 50) * 2, reason: "İşlem skoru eşiğe yakın" };
  if (t > 0)   return { v: t * 1.0, penalty: "Sinyal eşiğe uzak" };
  return { v: 0 };
}

/** setupScore — fırsat yapısı; WAIT durumlarında bile hesaplanır. */
function scoreSetup(c: OpportunityInput): { v: number; reason?: string; penalty?: string } {
  const s = num(c.setupScore, 0);
  if (s >= 80) return { v: 100, reason: "Fırsat yapısı çok güçlü" };
  if (s >= 70) return { v: 90,  reason: "Fırsat yapısı güçlü" };
  if (s >= 50) return { v: 60 + (s - 50) * 1.5 };
  if (s > 0)   return { v: s, penalty: "Fırsat yapısı zayıf" };
  return { v: 0 };
}

/** marketQualityScore tercihen, yoksa preScore. */
function scoreQuality(c: OpportunityInput): { v: number; reason?: string; penalty?: string } {
  const q = num(c.marketQualityScore, NaN);
  const used = Number.isFinite(q) ? q : num(c.marketQualityPreScore, 0);
  if (used >= 80) return { v: 100, reason: "Likidite/sağlık çok iyi" };
  if (used >= 70) return { v: 85,  reason: "Likidite sağlıklı" };
  if (used >= 50) return { v: 50 + (used - 50) * 1.5 };
  if (used > 0)   return { v: used, penalty: "Piyasa kalitesi düşük" };
  return { v: 50 }; // veri yok → nötr
}

/** R:R kalitesi — 1:1.5 zayıf, 1:2 standart, 1:3+ mükemmel. */
function scoreRiskReward(c: OpportunityInput): { v: number; reason?: string; penalty?: string } {
  const rr = num(c.rrRatio ?? c.rewardRiskRatio, NaN);
  if (!Number.isFinite(rr) || rr <= 0) return { v: 50 }; // veri yok → nötr
  if (rr >= 3)   return { v: 100, reason: "R:R yüksek (≥1:3)" };
  if (rr >= 2)   return { v: 80,  reason: "R:R sağlıklı" };
  if (rr >= 1.5) return { v: 55 };
  return { v: Math.max(0, rr * 30), penalty: "R:R zayıf" };
}

/** Spread + depth + 24h hacim. */
function scoreLiquidity(c: OpportunityInput): { v: number; reason?: string; penalty?: string } {
  const spread = num(c.spreadPercent, NaN);
  const depth = num(c.depthScore ?? c.orderBookDepth, NaN);
  const qvol = num(c.quoteVolume24h, NaN);

  let parts: number[] = [];
  if (Number.isFinite(spread)) {
    // 0.05% mükemmel, 0.30% zayıf
    if (spread <= 0.05) parts.push(100);
    else if (spread <= 0.15) parts.push(80);
    else if (spread <= 0.30) parts.push(50);
    else parts.push(Math.max(0, 50 - (spread - 0.30) * 100));
  }
  if (Number.isFinite(depth)) {
    // 1M+ USDT mükemmel, 100K zayıf (orderBookDepth ölçeğinde)
    if (depth >= 1_000_000) parts.push(100);
    else if (depth >= 500_000) parts.push(85);
    else if (depth >= 100_000) parts.push(60);
    else if (depth > 0) parts.push(Math.max(0, (depth / 100_000) * 60));
  }
  if (Number.isFinite(qvol)) {
    if (qvol >= 100_000_000) parts.push(100);
    else if (qvol >= 10_000_000) parts.push(80);
    else if (qvol >= 1_000_000) parts.push(55);
    else parts.push(Math.max(0, (qvol / 1_000_000) * 55));
  }

  if (parts.length === 0) return { v: 50 }; // veri yok → nötr

  const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
  let reason: string | undefined;
  let penalty: string | undefined;
  if (avg >= 80) reason = "Likidite sağlıklı";
  if (avg < 40) penalty = "Likidite zayıf";
  // Spread özel uyarısı
  if (Number.isFinite(spread) && spread > 0.30) penalty = "Spread yüksek";
  return { v: avg, reason, penalty };
}

/** BTC uyumu — explicit alanlar varsa onları kullan; yoksa nötr. */
function scoreBtcAlignment(c: OpportunityInput): { v: number; reason?: string; penalty?: string } {
  if (c.btcVeto === true || c.btcTrendRejected === true) {
    return { v: 0, penalty: "BTC yön uyumsuzluğu" };
  }
  if (c.btcAligned === true) {
    return { v: 100, reason: "BTC yönü uyumlu" };
  }
  return { v: 50 }; // bilinmiyor → nötr
}

/** ATR percentile + volume impulse — sağlıklı volatilite ödüllendirilir. */
function scoreVolatility(c: OpportunityInput): { v: number; reason?: string; penalty?: string } {
  const atrP = num(c.atrPercentile, NaN);
  const vi = num(c.volumeImpulse, NaN);
  let parts: number[] = [];
  if (Number.isFinite(atrP)) {
    // 30-70 sağlıklı bant; uçlar penalty.
    if (atrP >= 30 && atrP <= 70) parts.push(100);
    else if (atrP < 30) parts.push(40 + atrP);          // çok düşük → zayıf
    else parts.push(Math.max(0, 100 - (atrP - 70) * 2));// çok yüksek → balon
  }
  if (Number.isFinite(vi)) {
    // 1.0 ortalama, 1.5-2.5 ideal, >3 abartılı
    if (vi >= 1.2 && vi <= 2.5) parts.push(100);
    else if (vi > 2.5) parts.push(Math.max(0, 100 - (vi - 2.5) * 30));
    else parts.push(Math.max(0, vi * 60));
  }
  if (parts.length === 0) return { v: 50 };
  const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
  let reason: string | undefined;
  let penalty: string | undefined;
  if (avg >= 75) reason = "Volatilite sağlıklı";
  if (avg < 30) penalty = "Volatilite sağlıksız";
  return { v: avg, reason, penalty };
}

/** Kaynak önceliği. MİL > MT > GMT, KRM = bonus. */
function scoreSource(c: OpportunityInput): { v: number; reason?: string } {
  const display = (c.sourceDisplay ?? "").toUpperCase();
  const sources = (c.sources ?? c.candidateSources ?? []) as readonly string[];
  const has = (s: string) => sources.includes(s);

  // KRM = ≥2 kaynak → 95 + bonus reason
  if (display === "KRM" || sources.length >= 2) {
    return { v: 95, reason: "KRM çoklu kaynak teyidi var" };
  }
  if (display === "MİL" || has("MANUAL_LIST")) {
    return { v: 90, reason: "MİL kaynak önceliği (manuel izleme)" };
  }
  if (display === "MT" || has("MOMENTUM")) {
    return { v: 75, reason: "MT momentum desteği var" };
  }
  if (display === "GMT" || has("WIDE_MARKET")) {
    return { v: 60 };
  }
  return { v: 50 };
}

/** Momentum urgency — anlık ivmeyi öne çıkar. */
function scoreMomentumUrgency(c: OpportunityInput): { v: number; reason?: string } {
  const vi = num(c.volumeImpulse, NaN);
  const display = (c.sourceDisplay ?? "").toUpperCase();
  const isMomentum = display === "MT" || display === "KRM" ||
    (c.sources ?? c.candidateSources ?? []).includes("MOMENTUM");
  let v = 50;
  if (Number.isFinite(vi)) {
    if (vi >= 2) v = 90;
    else if (vi >= 1.5) v = 75;
    else if (vi >= 1.2) v = 60;
    else v = Math.max(0, vi * 50);
  }
  if (isMomentum) v = Math.min(100, v + 5);
  const reason = v >= 75 ? "Momentum ivmesi yüksek" : undefined;
  return { v, reason };
}

// ── Toplama ────────────────────────────────────────────────────────────

export interface ComputeOptions {
  weights?: Partial<PriorityWeights>;
}

export function computeOpportunityPriorityScore(
  c: OpportunityInput,
  opts: ComputeOptions = {},
): PriorityScoreOutput {
  const w: PriorityWeights = { ...DEFAULT_PRIORITY_WEIGHTS, ...(opts.weights ?? {}) };

  const ts = scoreTradeSignal(c);
  const su = scoreSetup(c);
  const ql = scoreQuality(c);
  const rr = scoreRiskReward(c);
  const lq = scoreLiquidity(c);
  const bt = scoreBtcAlignment(c);
  const vo = scoreVolatility(c);
  const sr = scoreSource(c);
  const mo = scoreMomentumUrgency(c);

  const components: PriorityComponents = {
    tradeSignal: clamp(ts.v),
    setup: clamp(su.v),
    quality: clamp(ql.v),
    riskReward: clamp(rr.v),
    liquidity: clamp(lq.v),
    btcAlignment: clamp(bt.v),
    volatility: clamp(vo.v),
    source: clamp(sr.v),
    momentumUrgency: clamp(mo.v),
    correlationPenalty: 0, // Faz 11 — alanı hazırla, henüz hesap yok.
  };

  const weighted =
    components.tradeSignal     * w.tradeSignal +
    components.setup           * w.setup +
    components.quality         * w.quality +
    components.riskReward      * w.riskReward +
    components.liquidity       * w.liquidity +
    components.btcAlignment    * w.btcAlignment +
    components.volatility      * w.volatility +
    components.source          * w.source +
    components.momentumUrgency * w.momentumUrgency;

  // Korelasyon penalty alanı hazır (gelecek fazda hesaplanacak).
  const score = clamp(weighted - components.correlationPenalty);

  // Reasons / penalties — her bileşen kendisinden bilgi sağladı.
  const reasons: string[] = [];
  const penalties: string[] = [];
  type Carrier = { reason?: string; penalty?: string };
  for (const r of [ts, su, ql, rr, lq, bt, vo, sr, mo] as Carrier[]) {
    if (typeof r.reason === "string" && r.reason.length > 0) reasons.push(r.reason);
    if (typeof r.penalty === "string" && r.penalty.length > 0) penalties.push(r.penalty);
  }

  // Açık pozisyon ek bilgisi — UI'da yararlı.
  if (c.opened === true) reasons.push("Pozisyon açıldı");
  if (c.riskAllowed === false || c.riskRejectReason) {
    penalties.push("Risk reddi");
  }

  return { score, components, reasons, penalties };
}

/** Toplu kullanımda küçük yardımcı. */
export function computeBatch(
  candidates: OpportunityInput[],
  opts?: ComputeOptions,
): { input: OpportunityInput; out: PriorityScoreOutput }[] {
  return candidates.map((c) => ({ input: c, out: computeOpportunityPriorityScore(c, opts) }));
}
