// Phase 9 — Dashboard ortak etiket/mapping yardımcıları.
//
// Bu modül yalnızca presentation katmanı için saf fonksiyonlar içerir.
// Trade kararı, signal-engine veya risk engine üzerinde HİÇBİR etkisi
// yoktur. Mapping kuralları Faz 8 Piyasa Tarayıcı ile birebir aynıdır;
// dashboard ve scanner sayfalarının tutarlı görünmesi için merkezîdir.

export type DirectionCandidate = "LONG_CANDIDATE" | "SHORT_CANDIDATE" | "MIXED" | "NONE";

// YÖN kolonu için eğilim etiketleri.
export type DirectionLabel =
  | "LONG ADAY" | "SHORT ADAY"
  | "LONG AÇILDI" | "SHORT AÇILDI"
  | "YÖN BEKLİYOR" | "YÖN KARIŞIK";

// KARAR kolonu için aksiyon etiketleri (LONG ADAY/SHORT ADAY artık burada YOK).
export type DecisionActionLabel =
  | "İŞLEM AÇILDI" | "İŞLEM YOK"
  | "EŞİK ALTINDA"
  | "RİSK REDDİ" | "BTC FİLTRESİ"
  | "VERİ YETERSİZ"
  | "FİLTRELENDİ"
  | "BEKLEMEDE";

// Geri uyumluluk: tüm etiketlerin birleşimi (eski kullanım yerlerinde tip
// kaymaması için tutuluyor; yeni kod yön/karar tiplerini ayrı kullansın).
export type DecisionLabel = DirectionLabel | DecisionActionLabel;

export interface DecisionInput {
  signalType?: string;
  opened?: boolean;
  riskAllowed?: boolean | null;
  riskRejectReason?: string | null;
  btcTrendRejected?: boolean;
  directionCandidate?: DirectionCandidate;
  rejectReason?: string | null;
  tradeSignalScore?: number | null;
  signalScore?: number | null;
  displayFilterPassed?: boolean;
}

/** Yön kolonu: doğrultu eğilimi. Aksiyon kararı GÖSTERMEZ. */
export function mapDirectionLabel(row: DecisionInput): DirectionLabel {
  if (row.opened && row.signalType === "LONG") return "LONG AÇILDI";
  if (row.opened && row.signalType === "SHORT") return "SHORT AÇILDI";
  if (row.opened) {
    if (row.directionCandidate === "LONG_CANDIDATE") return "LONG AÇILDI";
    if (row.directionCandidate === "SHORT_CANDIDATE") return "SHORT AÇILDI";
  }
  if (row.signalType === "LONG") return "LONG ADAY";
  if (row.signalType === "SHORT") return "SHORT ADAY";
  if (row.directionCandidate === "LONG_CANDIDATE") return "LONG ADAY";
  if (row.directionCandidate === "SHORT_CANDIDATE") return "SHORT ADAY";
  if (row.directionCandidate === "MIXED") return "YÖN KARIŞIK";
  return "YÖN BEKLİYOR";
}

/**
 * Karar kolonu: botun aksiyon sonucu. LONG ADAY / SHORT ADAY üretmez —
 * adaylık YÖN kolonunda gösterilir; KARAR sadece aksiyon etiketi döner.
 */
export function mapDecisionLabel(row: DecisionInput): DecisionActionLabel {
  if (row.opened) return "İŞLEM AÇILDI";
  if (row.btcTrendRejected) return "BTC FİLTRESİ";
  if (row.riskAllowed === false || row.riskRejectReason) return "RİSK REDDİ";
  if (row.displayFilterPassed === false) return "FİLTRELENDİ";

  const score = row.tradeSignalScore ?? row.signalScore ?? null;
  const sig = row.signalType;

  if (typeof score === "number" && score > 0 && score < SIGNAL_THRESHOLD) {
    return "EŞİK ALTINDA";
  }
  if (sig === "WAIT" || sig === "NO_TRADE" || sig === "NONE" || !sig) {
    if (score === null || score === 0) {
      // Skor hiç üretilmemişse veri yetersizliği vardır.
      if (!sig || sig === "NONE") return "VERİ YETERSİZ";
    }
    return "İŞLEM YOK";
  }
  return "İŞLEM YOK";
}

/** Aday/açıldı/red etiketleri için tek tip class. */
export function decisionClass(label: DecisionLabel, opened: boolean): string {
  if (opened) return "text-success";
  // Yön etiketleri.
  if (label === "LONG AÇILDI") return "text-success";
  if (label === "SHORT AÇILDI") return "text-blue-300";
  if (label === "LONG ADAY") return "text-success";
  if (label === "SHORT ADAY") return "text-blue-300";
  if (label === "YÖN BEKLİYOR" || label === "YÖN KARIŞIK") return "text-muted";
  // Karar etiketleri.
  if (label === "İŞLEM AÇILDI") return "text-success";
  if (label === "RİSK REDDİ" || label === "BTC FİLTRESİ") return "text-danger";
  if (label === "EŞİK ALTINDA") return "text-warning";
  if (label === "FİLTRELENDİ" || label === "VERİ YETERSİZ") return "text-muted";
  if (label === "İŞLEM YOK" || label === "BEKLEMEDE") return "text-muted";
  return "text-muted";
}

// ── Kaynak (KAYNAK) mapping — GMT / MT / MİL / KRM ────────────────────
export interface SourceInput {
  sourceDisplay?: string | null;
  candidateSources?: string[];
  coinClass?: "CORE" | "DYNAMIC";
}

export function mapSourceLabel(row: SourceInput): string {
  if (row.sourceDisplay) return row.sourceDisplay;
  const sources = row.candidateSources ?? [];
  if (sources.length >= 2) return "KRM";
  if (sources.length === 1) {
    const s = sources[0];
    if (s === "WIDE_MARKET") return "GMT";
    if (s === "MOMENTUM") return "MT";
    if (s === "MANUAL_LIST") return "MİL";
  }
  if (row.coinClass === "CORE") return "CORE";
  return "—";
}

// ── WAIT reason kodları → kısa Türkçe etiket ──────────────────────────
export const WAIT_CODE_TR: Record<string, string> = {
  EMA_ALIGNMENT_MISSING: "EMA dizilim",
  MA_FAST_SLOW_CONFLICT: "MA çatışma",
  MACD_CONFLICT: "MACD uyumsuz",
  RSI_NEUTRAL: "RSI nötr",
  ADX_FLAT: "ADX zayıf",
  VWAP_NOT_CONFIRMED: "VWAP teyitsiz",
  VOLUME_WEAK: "Hacim zayıf",
  BOLLINGER_NO_CONFIRMATION: "BB teyitsiz",
  ATR_REGIME_UNCLEAR: "ATR belirsiz",
  BTC_DIRECTION_CONFLICT: "BTC zıt",
};

/**
 * Kısa "ana eksik / sebep" metni — POZİSYONA EN YAKIN COINLER ve
 * KARAR MERKEZİ kartları için ortak.
 */
export function buildReasonText(row: {
  signalType?: string;
  waitReasonCodes?: string[];
  /** Faz 12 — backend tarafından üretilen kısa Türkçe özet (varsa öncelikli). */
  waitReasonSummary?: string;
  scoreReason?: string;
  rejectReason?: string | null;
  riskRejectReason?: string | null;
  btcTrendRejected?: boolean;
  tradeSignalScore?: number | null;
  signalScore?: number | null;
  displayFilterPassed?: boolean;
  displayFilterReasonText?: string;
  displayFilterReasons?: string[];
  opened?: boolean;
}): string {
  if (row.btcTrendRejected) return "BTC trend filtresi";
  if (row.riskRejectReason) return row.riskRejectReason;
  if (row.displayFilterPassed === false) {
    if (row.displayFilterReasonText && row.displayFilterReasonText.length > 0) return row.displayFilterReasonText;
    const reasons = row.displayFilterReasons ?? [];
    if (reasons.length > 0) return reasons.slice(0, 2).join(" · ");
    return "Filtrelendi";
  }
  if (row.signalType === "WAIT" && row.waitReasonSummary && row.waitReasonSummary.length > 0) {
    return row.waitReasonSummary;
  }
  const codes = row.waitReasonCodes ?? [];
  if (codes.length > 0) {
    return codes.slice(0, 3).map((c) => WAIT_CODE_TR[c] ?? c).join(" · ");
  }
  // Skor üretildi ama eşiğin altında — KARAR=EŞİK ALTINDA kararını destekleyen sebep.
  const score = row.tradeSignalScore ?? row.signalScore ?? null;
  if (!row.opened && typeof score === "number" && score > 0 && score < SIGNAL_THRESHOLD) {
    return `İşlem skoru ${score}/${SIGNAL_THRESHOLD}`;
  }
  if (row.scoreReason) return row.scoreReason;
  if (row.rejectReason) return row.rejectReason;
  return "—";
}

/** Signal threshold (signal-engine'deki MIN_SIGNAL_CONFIDENCE = 70). */
export const SIGNAL_THRESHOLD = 70;

/** İşlem skorunun 70 eşiğine kalan farkı. */
export function distanceToThreshold(opts: {
  tradeSignalScore?: number;
  signalScore?: number;
  opened?: boolean;
}): number | null {
  const score = opts.tradeSignalScore ?? opts.signalScore ?? 0;
  if (opts.opened) return 0;
  if (score <= 0) return null;
  return Math.max(0, SIGNAL_THRESHOLD - score);
}

export type TickSkipReasonCode =
  | "bot_paused"
  | "daily_target_hit"
  | "daily_loss_limit"
  | "strategy_health_blocked"
  | "max_positions_reached"
  | "worker_lock_not_owner"
  | "unknown";

export function normalizeTickSkipReason(skipReason?: string | null): TickSkipReasonCode {
  if (!skipReason) return "unknown";
  if (skipReason.startsWith("bot_not_running:")) return "bot_paused";
  if (skipReason === "daily_target_hit") return "daily_target_hit";
  if (skipReason === "daily_loss_limit" || skipReason === "daily_loss_limit_hit") return "daily_loss_limit";
  if (skipReason.startsWith("strategy_health_blocked")) return "strategy_health_blocked";
  if (skipReason === "max_positions_reached" || skipReason === "max_open_positions") return "max_positions_reached";
  if (skipReason === "worker_lock_not_owner") return "worker_lock_not_owner";
  return "unknown";
}

export function mapTickSkipReasonTr(skipReason?: string | null): string {
  switch (normalizeTickSkipReason(skipReason)) {
    case "bot_paused":
      return "Bot duraklatıldı";
    case "daily_target_hit":
      return "Günlük hedef doldu";
    case "daily_loss_limit":
      return "Günlük zarar limiti doldu";
    case "strategy_health_blocked":
      // Legacy path — strategy health no longer skips the tick (it now soft-passes
      // and only blocks position opening). The mapping is kept for any historical
      // tick summary still in the DB; the copy reflects the new behavior so users
      // never see the old "engelledi" wording again.
      return "Strateji sağlık skoru düşük. Tarama izleme modunda devam ediyor; yeni işlem açılmıyor.";
    case "max_positions_reached":
      return "Maksimum açık pozisyon dolu";
    case "worker_lock_not_owner":
      return "Worker lock sahibi değil";
    case "unknown":
    default:
      return "Bilinmeyen sebep";
  }
}

function shortTickError(tickError?: string | null): string | null {
  if (!tickError) return null;
  const compact = tickError.split("\n")[0]?.trim() ?? "";
  if (!compact) return null;
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}

export interface TickRuntimeNotice {
  tone: "warning" | "danger";
  message: string;
}

export function buildTickRuntimeNotice(args: {
  tickSkipped?: boolean | null;
  skipReason?: string | null;
  tickError?: string | null;
}): TickRuntimeNotice | null {
  const errorText = shortTickError(args.tickError);
  if (errorText) {
    return {
      tone: "danger",
      message: `Son tick hatası: ${errorText}`,
    };
  }
  if (args.tickSkipped === true) {
    return {
      tone: "warning",
      message: `Son tick atlandı: ${mapTickSkipReasonTr(args.skipReason)}`,
    };
  }
  return null;
}
