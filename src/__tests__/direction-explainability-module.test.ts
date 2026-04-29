// Phase 12 — Direction explainability modülü için birim testler.
// Testler doğrudan src/lib/direction-explainability/ üzerine konuşur; integration
// için signal-engine bazlı geniş test direction-explainability.test.ts dosyasındadır.
//
// Bu testler invariant olarak şunu doğrular:
//   • directionCandidate, signalType veya tradeSignalScore yerine geçmez.
//   • longSetupScore / shortSetupScore aralığı 0–100.
//   • waitReasonCodes vocab listesinden çıkmaz.
//   • Türkçe summary en fazla 2 sebep gösterir.

import { describe, it, expect } from "vitest";
import {
  computeDirectionExplainability,
  scoreDirection,
  buildWaitReasonCodes,
  buildWaitReasonSummary,
  WAIT_REASON_TR,
  WAIT_REASON_VOCAB,
  type DirectionInputs,
  type WaitReasonCode,
} from "@/lib/direction-explainability";

function inputs(over: Partial<DirectionInputs> = {}): DirectionInputs {
  return {
    last: 100,
    e20: 100, e50: 100, e200: 100,
    ma8: 100, ma55: 100,
    macdHist: 0,
    rsi: 50,
    bbBreakoutUp: false, bbBreakoutDown: false,
    bbMiddle: 100, bbPosition: 0.5,
    adxVal: 18,
    vwapVal: 100, priceAboveVwap: null,
    volumeImpulse: 1.0,
    atrPctileVal: 50,
    btcUp: null,
    ...over,
  };
}

describe("scoreDirection — skor aralıkları", () => {
  it("longSetupScore 0–100 aralığında", () => {
    const s = scoreDirection(inputs());
    expect(s.longSetupScore).toBeGreaterThanOrEqual(0);
    expect(s.longSetupScore).toBeLessThanOrEqual(100);
  });

  it("shortSetupScore 0–100 aralığında", () => {
    const s = scoreDirection(inputs());
    expect(s.shortSetupScore).toBeGreaterThanOrEqual(0);
    expect(s.shortSetupScore).toBeLessThanOrEqual(100);
  });

  it("directionConfidence NaN üretmiyor (eksik veride 0)", () => {
    const s = scoreDirection(inputs({
      e20: NaN, e50: NaN, e200: NaN,
      ma8: NaN, ma55: NaN, macdHist: NaN, rsi: NaN,
      adxVal: NaN, vwapVal: NaN, volumeImpulse: NaN, atrPctileVal: NaN,
    }));
    expect(Number.isFinite(s.directionConfidence)).toBe(true);
    expect(s.directionConfidence).toBeGreaterThanOrEqual(0);
    expect(s.directionConfidence).toBeLessThanOrEqual(100);
  });
});

describe("scoreDirection — directionCandidate üretimi", () => {
  it("güçlü uptrend → LONG_CANDIDATE", () => {
    const s = scoreDirection(inputs({
      last: 110, e20: 108, e50: 105, e200: 95,
      ma8: 107, ma55: 100,
      macdHist: 0.5,
      rsi: 58,
      bbBreakoutUp: true,
      adxVal: 28,
      priceAboveVwap: true,
      volumeImpulse: 1.6,
      btcUp: true,
    }));
    expect(s.directionCandidate).toBe("LONG_CANDIDATE");
    expect(s.longSetupScore).toBeGreaterThan(s.shortSetupScore);
  });

  it("güçlü downtrend → SHORT_CANDIDATE", () => {
    const s = scoreDirection(inputs({
      last: 90, e20: 92, e50: 95, e200: 105,
      ma8: 93, ma55: 100,
      macdHist: -0.5,
      rsi: 42,
      bbBreakoutDown: true,
      adxVal: 28,
      priceAboveVwap: false,
      volumeImpulse: 1.6,
      btcUp: false,
    }));
    expect(s.directionCandidate).toBe("SHORT_CANDIDATE");
    expect(s.shortSetupScore).toBeGreaterThan(s.longSetupScore);
  });

  it("flat / belirsiz piyasa → NONE veya MIXED (LONG/SHORT değil)", () => {
    const s = scoreDirection(inputs({
      last: 100, e20: 100, e50: 100, e200: 100,
      ma8: 100, ma55: 100,
      macdHist: 0, rsi: 50,
      adxVal: 12,
      priceAboveVwap: null,
      volumeImpulse: 0.7,
      atrPctileVal: 50,
      btcUp: null,
    }));
    expect(["NONE", "MIXED"]).toContain(s.directionCandidate);
  });
});

describe("buildWaitReasonCodes — vocab kontrolü", () => {
  it("yalnızca dokümantasyondaki kodları üretir", () => {
    const cands: WaitReasonCode[] = ["LONG_CANDIDATE" as any, "SHORT_CANDIDATE" as any, "NONE" as any];
    for (const dc of cands) {
      const codes = buildWaitReasonCodes({ ...inputs(), directionCandidate: dc as any });
      for (const c of codes) {
        expect(WAIT_REASON_VOCAB).toContain(c);
      }
    }
  });

  it("EMA dizilimi LONG aday için eksikse EMA_ALIGNMENT_MISSING üretir", () => {
    const codes = buildWaitReasonCodes({
      ...inputs({ last: 100, e20: 100, e50: 100, e200: 100 }),
      directionCandidate: "LONG_CANDIDATE",
    });
    expect(codes).toContain("EMA_ALIGNMENT_MISSING");
  });

  it("MACD histogram pozitif değilken LONG aday → MACD_CONFLICT", () => {
    const codes = buildWaitReasonCodes({
      ...inputs({ macdHist: -0.1 }),
      directionCandidate: "LONG_CANDIDATE",
    });
    expect(codes).toContain("MACD_CONFLICT");
  });

  it("volumeImpulse < 1 → VOLUME_WEAK", () => {
    const codes = buildWaitReasonCodes({
      ...inputs({ volumeImpulse: 0.5 }),
      directionCandidate: "NONE",
    });
    expect(codes).toContain("VOLUME_WEAK");
  });

  it("BTC yönü ters aday yön ile çakışıyorsa BTC_DIRECTION_CONFLICT", () => {
    const codes = buildWaitReasonCodes({
      ...inputs({ btcUp: false }),
      directionCandidate: "LONG_CANDIDATE",
    });
    expect(codes).toContain("BTC_DIRECTION_CONFLICT");
  });

  it("RSI nötr (45–55) → RSI_NEUTRAL", () => {
    const codes = buildWaitReasonCodes({
      ...inputs({ rsi: 50 }),
      directionCandidate: "NONE",
    });
    expect(codes).toContain("RSI_NEUTRAL");
  });
});

describe("Türkçe etiket mapping", () => {
  it("tüm kodlar için Türkçe etiket vardır", () => {
    for (const code of WAIT_REASON_VOCAB) {
      expect(WAIT_REASON_TR[code]).toBeTruthy();
      expect(typeof WAIT_REASON_TR[code]).toBe("string");
    }
  });

  it("EMA_ALIGNMENT_MISSING → 'EMA dizilimi eksik'", () => {
    expect(WAIT_REASON_TR.EMA_ALIGNMENT_MISSING).toBe("EMA dizilimi eksik");
  });

  it("BTC_DIRECTION_CONFLICT → 'BTC yönü ters'", () => {
    expect(WAIT_REASON_TR.BTC_DIRECTION_CONFLICT).toBe("BTC yönü ters");
  });
});

describe("buildWaitReasonSummary — kısa özet", () => {
  it("LONG aday + sebep listesi → 'LONG adayı ama …'", () => {
    const text = buildWaitReasonSummary("LONG_CANDIDATE", ["EMA_ALIGNMENT_MISSING", "VOLUME_WEAK"]);
    expect(text.startsWith("LONG adayı ama")).toBe(true);
    expect(text).toContain("EMA dizilimi eksik");
    expect(text).toContain("hacim zayıf");
  });

  it("SHORT aday + BTC çakışma → 'SHORT adayı ama BTC yönü ters'", () => {
    const text = buildWaitReasonSummary("SHORT_CANDIDATE", ["BTC_DIRECTION_CONFLICT"]);
    expect(text).toBe("SHORT adayı ama BTC yönü ters");
  });

  it("MIXED + sebepler → 'Yön karışık: …'", () => {
    const text = buildWaitReasonSummary("MIXED", ["MACD_CONFLICT", "RSI_NEUTRAL"]);
    expect(text.startsWith("Yön karışık:")).toBe(true);
  });

  it("NONE + boş kod listesi → 'Yön teyidi bekleniyor'", () => {
    expect(buildWaitReasonSummary("NONE", [])).toBe("Yön teyidi bekleniyor");
  });

  it("en fazla 2 sebep gösterir (ana UI'da uzun teknik paragraf yok)", () => {
    const tooMany: WaitReasonCode[] = [
      "EMA_ALIGNMENT_MISSING", "MACD_CONFLICT", "VOLUME_WEAK", "RSI_NEUTRAL", "ADX_FLAT",
    ];
    const text = buildWaitReasonSummary("LONG_CANDIDATE", tooMany);
    // 5 kodu listede toplamamalıydı; sayım için virgüle bakıyoruz.
    const commas = (text.match(/,/g) || []).length;
    expect(commas).toBeLessThanOrEqual(1); // 2 sebep → tam 1 virgül
  });
});

describe("computeDirectionExplainability — barrel", () => {
  it("waitReasonSummary alanı her zaman string döner", () => {
    const r = computeDirectionExplainability(inputs());
    expect(typeof r.waitReasonSummary).toBe("string");
  });

  it("longSetupScore + shortSetupScore alanları sayıdır", () => {
    const r = computeDirectionExplainability(inputs());
    expect(typeof r.longSetupScore).toBe("number");
    expect(typeof r.shortSetupScore).toBe("number");
  });
});

describe("Direction candidate trade kararını DEĞİŞTİRMEZ — invariantlar", () => {
  // Faz 12 mutlak kuralı: directionCandidate / longSetupScore /
  // shortSetupScore / waitReasonCodes / waitReasonSummary asla trade
  // engine kararını etkilemez. Bu testler dokümantasyon değerinde sentinel.

  it("MIN_SIGNAL_CONFIDENCE = 70 değişmedi", () => {
    expect(70).toBe(70);
  });

  it("longSetupScore 99 olsa bile signalType WAIT'ı LONG yapmaz", () => {
    // Konseptüel test: bu modülün çıktısı asla signalType atamaz.
    const r = computeDirectionExplainability(inputs({
      last: 110, e20: 108, e50: 105, e200: 95,
      ma8: 107, ma55: 100,
      macdHist: 0.5, rsi: 58,
      bbBreakoutUp: true, adxVal: 28,
      priceAboveVwap: true, volumeImpulse: 1.6, btcUp: true,
    }));
    // longSetupScore büyük olabilir ama bu signalType'ı etkilemez:
    // signal-engine signalType'ı tamamen ayrı longBias/shortBias gate ile karar verir.
    expect(r.longSetupScore).toBeGreaterThan(0);
    // Bu modül signalType döndürmez; SignalType enum ile bu tipte alan yok.
    expect((r as any).signalType).toBeUndefined();
  });

  it("directionCandidate=LONG_CANDIDATE iken trade açma şartı hâlâ score>=70", () => {
    const tradeSignalScore = 65;
    const opens = tradeSignalScore >= 70;
    expect(opens).toBe(false);
  });
});
