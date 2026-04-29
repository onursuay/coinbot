// Phase 9 — Piyasa Nabzı hesaplaması.
//
// Saf, observation-only türetimler. RİSK İŞTAHI / FOMO DÜZEYİ / PİYASA
// RİSKİ değerleri tamamen mevcut tick verisinden hesaplanır; signal
// engine, risk engine veya trade-açma kapısına HİÇBİR şekilde geri
// beslenmez. Eksik veri durumunda güvenli (null) fallback üretir.

export interface MarketPulseInputRow {
  signalType?: string;
  tradeSignalScore?: number;
  signalScore?: number;
  setupScore?: number;
  marketQualityScore?: number;
  marketQualityPreScore?: number;
  spreadPercent?: number;
  atrPercent?: number;
  fundingRate?: number;
  rejectReason?: string | null;
  btcTrendRejected?: boolean;
  opened?: boolean;
  indicators?: {
    adx?: number | null;
    volumeImpulse?: number | null;
    atrPercentile?: number | null;
    rsi?: number | null;
    bollingerWidth?: number | null;
  };
}

export interface MarketPulseInput {
  rows: MarketPulseInputRow[];
  /** Tick özetinden alınabilecek ek sayaçlar (varsa). */
  scanned?: number;
  signals?: number;
  rejected?: number;
  btcTrendRejected?: number;
}

export interface MarketPulseResult {
  /** 0..100 RİSK İŞTAHI: kalite + setup yoğunluğu (yüksek = piyasa pozisyon almaya elverişli). */
  riskAppetite: number | null;
  /** 0..100 FOMO DÜZEYİ: sıkışmış volatilite + güçlü hacim ivmesi → balon riski. */
  fomoLevel: number | null;
  /** 0..100 PİYASA RİSKİ: BTC veto + spread/ATR yüksekliği + ret oranı. */
  marketRisk: number | null;
  /** Kısa, açıklayıcı tek cümle. Eksik veri varsa "Veri toplanıyor" tonu. */
  comment: string;
  /** Hangi alanların besleyebildiğini takip edebilmek için. */
  sampleSize: number;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

export function computeMarketPulse(input: MarketPulseInput): MarketPulseResult {
  const rows = input.rows ?? [];
  const sampleSize = rows.length;

  if (sampleSize === 0) {
    return {
      riskAppetite: null,
      fomoLevel: null,
      marketRisk: null,
      comment: "Veri toplanıyor — worker tick verisi geldiğinde piyasa nabzı oluşur.",
      sampleSize: 0,
    };
  }

  // ── RİSK İŞTAHI ──────────────────────────────────────────────────────
  // Yüksek kalite + güçlü setup oranı + yön belirleyebilen coin oranı.
  const qualities = rows
    .map((r) => r.marketQualityScore ?? r.marketQualityPreScore)
    .filter((v): v is number => typeof v === "number" && v > 0);
  const setups = rows
    .map((r) => r.setupScore ?? 0)
    .filter((v) => v > 0);
  const directional = rows.filter(
    (r) => r.signalType === "LONG" || r.signalType === "SHORT",
  ).length;

  const avgQuality = avg(qualities);
  const avgSetup = avg(setups);
  const directionalRatio = sampleSize > 0 ? directional / sampleSize : 0;

  const riskAppetite =
    avgQuality === null && avgSetup === null
      ? null
      : clamp(
          0.5 * (avgQuality ?? 0) +
          0.35 * (avgSetup ?? 0) +
          0.15 * (directionalRatio * 100),
        );

  // ── FOMO DÜZEYİ ──────────────────────────────────────────────────────
  // ATR percentile yüksek + volumeImpulse yüksek + bolling width dar.
  const atrPctiles = rows
    .map((r) => r.indicators?.atrPercentile)
    .filter((v): v is number => typeof v === "number" && v >= 0);
  const volImpulses = rows
    .map((r) => r.indicators?.volumeImpulse)
    .filter((v): v is number => typeof v === "number" && v >= 0);

  const avgAtrPct = avg(atrPctiles);
  const avgVolImp = avg(volImpulses);

  let fomoLevel: number | null = null;
  if (avgAtrPct !== null || avgVolImp !== null) {
    // volumeImpulse 1.0 = ortalama; >2 = yüksek balon riski.
    const volScore = avgVolImp === null ? 0 : clamp(((avgVolImp - 1) / 2) * 100);
    const atrScore = avgAtrPct === null ? 0 : avgAtrPct; // 0..100 zaten
    fomoLevel = clamp(0.55 * volScore + 0.45 * atrScore);
  }

  // ── PİYASA RİSKİ ─────────────────────────────────────────────────────
  // BTC veto sayısı + ortalama spread + ATR% yüksekliği + ret/analiz oranı.
  const spreads = rows
    .map((r) => r.spreadPercent ?? 0)
    .filter((v) => v > 0);
  const atrs = rows
    .map((r) => r.atrPercent ?? 0)
    .filter((v) => v > 0);

  const avgSpread = avg(spreads); // % cinsinden
  const avgAtr = avg(atrs);
  const btcVeto = input.btcTrendRejected ?? rows.filter((r) => r.btcTrendRejected).length;
  const btcVetoRatio = sampleSize > 0 ? btcVeto / sampleSize : 0;
  const rejectRatio =
    typeof input.rejected === "number" && typeof input.scanned === "number" && input.scanned > 0
      ? input.rejected / input.scanned
      : null;

  const spreadScore = avgSpread === null ? 0 : clamp((avgSpread / 0.4) * 100); // 0.4% = yüksek spread
  const atrScore = avgAtr === null ? 0 : clamp((avgAtr / 6) * 100);            // 6% = aşırı volatilite
  const btcScore = clamp(btcVetoRatio * 100);
  const rejectScore = rejectRatio === null ? 0 : clamp(rejectRatio * 100);

  const marketRisk =
    avgSpread === null && avgAtr === null && btcVeto === 0 && rejectRatio === null
      ? null
      : clamp(0.30 * btcScore + 0.25 * spreadScore + 0.25 * atrScore + 0.20 * rejectScore);

  // ── Yorum üretimi ────────────────────────────────────────────────────
  const comment = buildPulseComment({ riskAppetite, fomoLevel, marketRisk, sampleSize });

  return { riskAppetite, fomoLevel, marketRisk, comment, sampleSize };
}

function buildPulseComment(args: {
  riskAppetite: number | null;
  fomoLevel: number | null;
  marketRisk: number | null;
  sampleSize: number;
}): string {
  const ra = args.riskAppetite;
  const fl = args.fomoLevel;
  const mr = args.marketRisk;

  if (ra === null && fl === null && mr === null) {
    return "Piyasa metrikleri henüz yetersiz — bir sonraki tickte güncellenecek.";
  }

  const parts: string[] = [];
  if (ra !== null) {
    if (ra >= 70) parts.push("Piyasa pozisyon almaya elverişli görünüyor");
    else if (ra >= 40) parts.push("Piyasa seçici şekilde güçlü");
    else parts.push("Piyasa iştahı zayıf");
  }
  if (fl !== null) {
    if (fl >= 70) parts.push("FOMO riski yüksek");
    else if (fl >= 40) parts.push("momentum var ancak FOMO riski artıyor");
  }
  if (mr !== null) {
    if (mr >= 70) parts.push("piyasa riski belirgin");
    else if (mr >= 40) parts.push("piyasa riski orta seviyede");
  }
  if (parts.length === 0) return "Piyasa nötr.";
  return parts.join("; ") + ".";
}
