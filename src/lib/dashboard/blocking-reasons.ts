// Phase 9 — En çok engelleyen sebepler aggregator.
//
// Botun en sık hangi nedenle işlem açmadığını üst düzeyde gruplar.
// Saf bir reduce — trade kararını veya rejection logic'ini değiştirmez.

export interface BlockingReasonRow {
  signalType?: string;
  rejectReason?: string | null;
  riskRejectReason?: string | null;
  btcTrendRejected?: boolean;
  waitReasonCodes?: string[];
}

export interface BlockingReasonEntry {
  /** UI'da gösterilecek büyük harf etiket. */
  label: string;
  count: number;
}

const WAIT_LABEL: Record<string, string> = {
  EMA_ALIGNMENT_MISSING: "EMA DİZİLİM",
  MA_FAST_SLOW_CONFLICT: "MA UYUMSUZ",
  MACD_CONFLICT: "MACD UYUMSUZ",
  RSI_NEUTRAL: "RSI NÖTR",
  ADX_FLAT: "ADX ZAYIF",
  VWAP_NOT_CONFIRMED: "VWAP TEYİTSİZ",
  VOLUME_WEAK: "HACİM ZAYIF",
  BOLLINGER_NO_CONFIRMATION: "BB TEYİTSİZ",
  ATR_REGIME_UNCLEAR: "ATR BELİRSİZ",
  BTC_DIRECTION_CONFLICT: "BTC ZIT",
};

const REJECT_PATTERNS: { test: RegExp; label: string }[] = [
  { test: /btc\s*trend/i,          label: "BTC FİLTRESİ" },
  { test: /spread/i,               label: "YÜKSEK SPREAD" },
  { test: /hacim/i,                label: "HACİM ZAYIF" },
  { test: /likidite|derinlik/i,    label: "LİKİDİTE YETERSİZ" },
  { test: /sinyal\s*skoru/i,       label: "SİNYAL SKORU DÜŞÜK" },
  { test: /risk\/ödül|r\/r|r:r/i,  label: "R:R GEÇERSİZ" },
  { test: /fonlama|funding/i,      label: "FONLAMA DENGESİZ" },
  { test: /atr/i,                  label: "VOLATİLİTE BELİRSİZ" },
  { test: /pump|dump/i,            label: "PUMP/DUMP" },
  { test: /stable/i,               label: "STABLECOIN" },
  { test: /yetersiz mum|veri/i,    label: "YETERSİZ VERİ" },
  { test: /risk/i,                 label: "RİSK ENGELİ" },
];

function classifyReason(text: string): string {
  for (const p of REJECT_PATTERNS) {
    if (p.test.test(text)) return p.label;
  }
  return "DİĞER";
}

export function computeBlockingReasons(
  rows: BlockingReasonRow[],
  topN = 5,
): BlockingReasonEntry[] {
  const counts = new Map<string, number>();
  const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);

  for (const r of rows) {
    if (r.btcTrendRejected) {
      bump("BTC FİLTRESİ");
      continue;
    }
    const text = r.riskRejectReason ?? r.rejectReason ?? null;
    if (text && text.trim().length > 0) {
      bump(classifyReason(text));
      continue;
    }
    if (r.signalType === "WAIT" && Array.isArray(r.waitReasonCodes)) {
      // İlk wait kodu temsilci olarak; çoklu sayım yapmıyoruz — bir coin
      // bir engele oy verir.
      const first = r.waitReasonCodes[0];
      if (first && WAIT_LABEL[first]) bump(WAIT_LABEL[first]);
    }
  }

  const list: BlockingReasonEntry[] = [];
  counts.forEach((count, label) => list.push({ label, count }));
  list.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return list.slice(0, topN);
}
