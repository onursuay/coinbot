// Phase 12 — Direction explainability: tip tanımları.
//
// Bu modül "WAIT / İŞLEM YOK" durumunda kullanıcıya botun hangi yöne
// yakın olduğunu ve hangi koşulların eksik kaldığını anlatır.
//
// ÖNEMLİ — DEĞİŞMEZLER:
//   • directionCandidate, gerçek signalType (LONG/SHORT) yerine geçmez.
//   • longSetupScore / shortSetupScore, tradeSignalScore yerine geçmez.
//   • Trade açma kapısı hâlâ signalType=LONG/SHORT + score>=70 + BTC filter +
//     risk gate + SL/TP + R:R + paper mode kombinasyonudur.
//   • Bu modüldeki hiçbir alan trade engine kararını etkilemez.

/** Yön adayı durumu — sadece açıklayıcıdır, sinyal yerine geçmez. */
export type DirectionCandidate =
  | "LONG_CANDIDATE"
  | "SHORT_CANDIDATE"
  | "MIXED"
  | "NONE";

/** Sabit kelime dağarcığı — yeni kod eklenecekse listeyi koru, üzerine yaz. */
export type WaitReasonCode =
  | "EMA_ALIGNMENT_MISSING"
  | "MA_FAST_SLOW_CONFLICT"
  | "MACD_CONFLICT"
  | "RSI_NEUTRAL"
  | "ADX_FLAT"
  | "VWAP_NOT_CONFIRMED"
  | "VOLUME_WEAK"
  | "BOLLINGER_NO_CONFIRMATION"
  | "ATR_REGIME_UNCLEAR"
  | "BTC_DIRECTION_CONFLICT";

/** Skor üretimi için indikatör girdileri. NaN/null tolere edilir. */
export interface DirectionInputs {
  last: number;
  e20: number;
  e50: number;
  e200: number;
  ma8: number;
  ma55: number;
  macdHist: number;
  rsi: number;
  bbBreakoutUp: boolean;
  bbBreakoutDown: boolean;
  bbMiddle: number;
  bbPosition: number;
  adxVal: number;
  vwapVal: number;
  priceAboveVwap: boolean | null;
  volumeImpulse: number;
  atrPctileVal: number;
  btcUp: boolean | null;
}

/** Yön açıklayıcılık çıktısı — display/debug amaçlıdır. */
export interface DirectionExplainability {
  longSetupScore: number;
  shortSetupScore: number;
  directionCandidate: DirectionCandidate;
  directionConfidence: number;
  waitReasonCodes: WaitReasonCode[];
  /** En fazla 2–3 sebebi içeren kısa Türkçe özet. */
  waitReasonSummary: string;
}
