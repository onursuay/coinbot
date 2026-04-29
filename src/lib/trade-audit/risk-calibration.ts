// Faz 22 — Risk % Kalibrasyonu.
// Risk ayarlarını kapatılan işlemler üzerinden değerlendirir ve öneri üretir.
// Risk değerini otomatik DEĞİŞTİRMEZ.

import type { NormalizedTrade } from "@/lib/trade-performance";
import type { RiskExecutionConfig } from "@/lib/risk-settings/apply";
import type { RiskCalibrationResult, RiskCalibrationTag, AuditSeverity } from "./types";

export interface RiskCalibrationInput {
  closedTrades: NormalizedTrade[];
  riskConfig: RiskExecutionConfig | null;
}

export function calibrateRisk(input: RiskCalibrationInput): RiskCalibrationResult {
  const { closedTrades, riskConfig } = input;

  if (!riskConfig) {
    return {
      tag: "DATA_INSUFFICIENT",
      riskPerTradePercent: 0,
      dailyMaxLossPercent: 0,
      totalBotCapitalUsdt: 0,
      mainFinding: "Risk config verisi mevcut değil.",
      evidence: "riskConfig=null. Risk settings henüz yüklenmemiş.",
      recommendation: "Risk Yönetimi sayfasında ayarları kaydedin.",
      severity: "info",
    };
  }

  const riskPct = riskConfig.riskPerTradePercent;
  const dailyMaxLossPct = riskConfig.dailyMaxLossPercent;
  const capital = riskConfig.totalBotCapitalUsdt;

  if (closedTrades.length < 5) {
    return {
      tag: "DATA_INSUFFICIENT",
      riskPerTradePercent: riskPct,
      dailyMaxLossPercent: dailyMaxLossPct,
      totalBotCapitalUsdt: capital,
      mainFinding: "Yeterli işlem verisi yok — risk kalibrasyonu yapılamıyor.",
      evidence: `Kapanan işlem sayısı: ${closedTrades.length}. En az 5 işlem gerekiyor.`,
      recommendation: "Daha fazla işlem birikmesi bekleniyor.",
      severity: "info",
    };
  }

  const losses = closedTrades.filter((t) => (t.pnl ?? 0) < 0);
  const wins = closedTrades.filter((t) => (t.pnl ?? 0) > 0);
  const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;

  const consecutiveLosses = countMaxConsecutiveLosses(closedTrades);

  const totalLoss = losses.reduce((sum, t) => sum + Math.abs(t.pnl ?? 0), 0);
  const avgLossUsd = losses.length > 0 ? totalLoss / losses.length : 0;

  // Risk çok yüksek: %3 üzeri VE win rate < %45 VE ardışık kayıp ≥ 4
  if (riskPct > 3 && winRate < 45 && consecutiveLosses >= 4) {
    return makeResult("REDUCE_RISK", riskPct, dailyMaxLossPct, capital,
      "Risk yüksek ve win rate düşük — kademeli kayıp riski var.",
      `Risk: %${riskPct}, Win rate: %${winRate.toFixed(1)}, Ardışık maks kayıp: ${consecutiveLosses}.`,
      "Risk %'sini gözden geçirin. Win rate %50'nin altındayken %2-3 arasında risk önerilir.",
      "warning");
  }

  // Risk yüksek uyarısı: %5 üzeri
  if (riskPct > 5) {
    return makeResult("REDUCE_RISK", riskPct, dailyMaxLossPct, capital,
      "İşlem başı risk %5'in üzerinde — sermaye erozyonu riski.",
      `Risk: %${riskPct}. Ardışık kayıp ${consecutiveLosses} kez gerçekleşti.`,
      "İşlem başı risk %3-4 arasına çekilmesi önerilir.",
      "critical");
  }

  // Günlük max zarar kontrolü
  if (dailyMaxLossPct > 10) {
    return makeResult("REVIEW_DAILY_LOSS", riskPct, dailyMaxLossPct, capital,
      "Günlük maks zarar sınırı geniş — günlük zararda sermaye hızlı erir.",
      `Günlük maks zarar: %${dailyMaxLossPct}. %10 üzeri risk taşır.`,
      "Günlük maks zarar sınırını %8-10 arasında tutmak daha güvenlidir.",
      "warning");
  }

  // Sermaye düşük ve risk yüksek: < 200 USDT ve risk > %3
  if (capital > 0 && capital < 200 && riskPct > 3) {
    return makeResult("REDUCE_RISK", riskPct, dailyMaxLossPct, capital,
      "Küçük sermaye ile yüksek risk — hızlı hesap erozyonu.",
      `Sermaye: ${capital} USDT, Risk: %${riskPct}. Risk tutarı: ${(capital * riskPct / 100).toFixed(2)} USDT/işlem.`,
      "Küçük sermayede %2 risk önerilir.",
      "warning");
  }

  // Sermaye 0: fallback durumu
  if (capital === 0) {
    return makeResult("REVIEW_POSITION_SIZE", riskPct, dailyMaxLossPct, capital,
      "Sermaye tanımlı değil — pozisyon boyutu varsayılan fallback'e düşüyor.",
      "totalBotCapitalUsdt=0. Position sizing için sermaye tanımlanmamış.",
      "Risk Yönetimi sayfasında toplam sermayeyi girin.",
      "warning");
  }

  // Ardışık kayıp gözlem
  if (consecutiveLosses >= 3) {
    return makeResult("OBSERVE", riskPct, dailyMaxLossPct, capital,
      `${consecutiveLosses} ardışık kayıp gözlemlendi — risk ayarını izleyin.`,
      `Win rate: %${winRate.toFixed(1)}. Ort. kayıp: ${avgLossUsd.toFixed(2)} USD. Risk: %${riskPct}.`,
      "7 gün boyunca sonuçları izleyin; gerekirse risk %2'ye çekin.",
      "info");
  }

  // Risk çok düşük ve yeterli başarı: artırma önerisi
  if (riskPct < 1 && winRate > 60 && wins.length >= 10) {
    return makeResult("INCREASE_RISK", riskPct, dailyMaxLossPct, capital,
      "Risk çok düşük ve win rate yüksek — kaçan kâr fırsatı olabilir.",
      `Risk: %${riskPct}, Win rate: %${winRate.toFixed(1)}, ${wins.length} başarılı işlem.`,
      "Kanıtlanmış yüksek win rate'de riski kademeli artırmak değerlendirilebilir.",
      "info");
  }

  return makeResult("KEEP", riskPct, dailyMaxLossPct, capital,
    "Risk ayarları mevcut performansa uygun görünüyor.",
    `Risk: %${riskPct}, Günlük maks: %${dailyMaxLossPct}, Win rate: %${winRate.toFixed(1)}.`,
    "Mevcut risk ayarını koruyun. Gözleme devam edin.",
    "info");
}

function countMaxConsecutiveLosses(trades: NormalizedTrade[]): number {
  const sorted = [...trades].sort(
    (a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime()
  );
  let max = 0;
  let current = 0;
  for (const t of sorted) {
    if ((t.pnl ?? 0) < 0) {
      current++;
      if (current > max) max = current;
    } else {
      current = 0;
    }
  }
  return max;
}

function makeResult(
  tag: RiskCalibrationTag,
  riskPct: number,
  dailyPct: number,
  capital: number,
  mainFinding: string,
  evidence: string,
  recommendation: string,
  severity: AuditSeverity,
): RiskCalibrationResult {
  return {
    tag,
    riskPerTradePercent: riskPct,
    dailyMaxLossPercent: dailyPct,
    totalBotCapitalUsdt: capital,
    mainFinding,
    evidence,
    recommendation,
    severity,
  };
}
