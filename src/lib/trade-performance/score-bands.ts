// Phase 13 — Skor bandı analizi.
//
// Sinyal/işlem dağılımını skor aralıklarına göre raporlar. Bu rapor trade
// kararını veya eşiği değiştirmez; sadece kullanıcıya hangi bandda kaç sinyal
// olduğunu, kaçının açıldığını ve nasıl sonuçlandığını gösterir. Paper ve
// live trade'leri NormalizedTrade üzerinden aynı pipeline'da işler.

import type {
  NormalizedTrade,
  ScanRowInput,
  ScoreBandKey,
  ScoreBandReport,
  TradeMode,
} from "./types";

interface BandDef {
  key: ScoreBandKey;
  label: string;
  min: number;
  max: number; // inclusive
}

const BANDS: BandDef[] = [
  { key: "B50_59",   label: "50–59",  min: 50, max: 59 },
  { key: "B60_64",   label: "60–64",  min: 60, max: 64 },
  { key: "B65_69",   label: "65–69",  min: 65, max: 69 },
  { key: "B70_74",   label: "70–74",  min: 70, max: 74 },
  { key: "B75_84",   label: "75–84",  min: 75, max: 84 },
  { key: "B85_PLUS", label: "85+",    min: 85, max: 999 },
];

function bandOf(score: number): ScoreBandKey | null {
  if (!Number.isFinite(score) || score < 50) return null;
  for (const b of BANDS) {
    if (score >= b.min && score <= b.max) return b.key;
  }
  return null;
}

function pickReason(rows: ScanRowInput[]): string | null {
  const counts = new Map<string, number>();
  const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);
  for (const r of rows) {
    if (r.btcTrendRejected) bump("BTC FİLTRESİ");
    else if (r.riskRejectReason) bump("RİSK REDDİ");
    else if (r.rejectReason) bump("DÜŞÜK SKOR");
    else if (r.signalType === "WAIT" && r.waitReasonCodes && r.waitReasonCodes.length > 0) {
      bump(r.waitReasonCodes[0]);
    }
  }
  if (counts.size === 0) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function commentForBand(b: BandDef, signals: number, opened: number, tp: number, sl: number): string {
  if (signals === 0) return "Bu bandda sinyal yok.";
  if (b.key === "B50_59") return "Eşiğin çok altında — beklenen davranış: işlem açılmaz.";
  if (b.key === "B60_64") return "Eşiğe yaklaşan ama açılmayan adaylar; kalite gözlem altında.";
  if (b.key === "B65_69") return "Eşiğe çok yakın — kaçan fırsat olup olmadığı izlenmeli.";
  if (b.key === "B70_74") {
    if (opened === 0) return "Eşiği geçen ama açılmamış işlem var; risk/BTC filtresi devrede olabilir.";
    if (sl > tp) return "70–74 bandında SL oranı TP'den yüksek; kalite gözlem altında.";
    return "Eşiği yeni geçen işlemler — başarı oranı izlenmeli.";
  }
  if (b.key === "B75_84") {
    if (opened === 0) return "Bu bandda fırsat var ama açılmadı; gate sebebi incelenmeli.";
    return "Sağlıklı sinyal bandı — başarı oranı yüksek bekleniyor.";
  }
  // 85+
  if (opened === 0) return "Çok yüksek skorlu fırsat var ama açılmadı; risk/BTC sebebi olabilir.";
  return "Elit skor bandı — beklenen başarı yüksek.";
}

export interface ScoreBandInputs {
  trades: NormalizedTrade[];
  scanRows: ScanRowInput[];
  /** İsteğe bağlı filtre — sadece "paper" veya "live" işlemleri analiz et. */
  modeFilter?: TradeMode;
}

export function analyzeScoreBands(p: ScoreBandInputs): ScoreBandReport[] {
  const trades = p.modeFilter
    ? p.trades.filter((t) => t.tradeMode === p.modeFilter)
    : p.trades;

  const reports: Record<ScoreBandKey, ScoreBandReport> = Object.fromEntries(
    BANDS.map((b) => [b.key, {
      band: b.key, label: b.label,
      signalCount: 0, openedCount: 0, notOpenedCount: 0,
      reachedTp: 0, hitSl: 0,
      avgPnlPercent: 0, avgRr: 0,
      topBlockingReason: null, comment: "",
    }]),
  ) as Record<ScoreBandKey, ScoreBandReport>;

  // Scan rows → signal/notOpened sayımı + topBlockingReason hesabı için
  const rowsByBand = new Map<ScoreBandKey, ScanRowInput[]>();
  for (const r of p.scanRows) {
    const score = r.tradeSignalScore ?? r.signalScore ?? 0;
    const key = bandOf(score);
    if (!key) continue;
    reports[key].signalCount++;
    if (r.opened) reports[key].openedCount++;
    else reports[key].notOpenedCount++;
    if (!rowsByBand.has(key)) rowsByBand.set(key, []);
    rowsByBand.get(key)!.push(r);
  }
  for (const b of BANDS) {
    const rows = rowsByBand.get(b.key) ?? [];
    reports[b.key].topBlockingReason = pickReason(rows);
  }

  // Trades → TP/SL sayımı + ortalamalar
  const tradesByBand = new Map<ScoreBandKey, NormalizedTrade[]>();
  for (const t of trades) {
    if (t.status !== "closed") continue;
    const score = Number(t.signalScore ?? 0);
    const key = bandOf(score);
    if (!key) continue;
    if (t.exitReason === "take_profit") reports[key].reachedTp++;
    else if (t.exitReason === "stop_loss") reports[key].hitSl++;
    if (!tradesByBand.has(key)) tradesByBand.set(key, []);
    tradesByBand.get(key)!.push(t);
  }
  for (const b of BANDS) {
    const ts = tradesByBand.get(b.key) ?? [];
    if (ts.length === 0) continue;
    const pnls = ts.map((t) => Number(t.pnlPercent ?? 0)).filter(Number.isFinite);
    const rrs = ts.map((t) => Number(t.riskRewardRatio ?? 0)).filter((n) => Number.isFinite(n) && n > 0);
    reports[b.key].avgPnlPercent = pnls.length > 0
      ? +(pnls.reduce((s, x) => s + x, 0) / pnls.length).toFixed(2)
      : 0;
    reports[b.key].avgRr = rrs.length > 0
      ? +(rrs.reduce((s, x) => s + x, 0) / rrs.length).toFixed(2)
      : 0;
  }

  for (const b of BANDS) {
    const r = reports[b.key];
    r.comment = commentForBand(b, r.signalCount, r.openedCount, r.reachedTp, r.hitSl);
  }

  return BANDS.map((b) => reports[b.key]);
}
