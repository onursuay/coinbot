// Bot orchestrator — kill switch, pause/resume, single decision tick.

import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { botLog, riskEvent } from "@/lib/logger";
import { evaluateOpenTrades, openPaperTrade } from "./paper-trading-engine";
import { evaluateRisk } from "./risk-engine";
import { generateSignal } from "./signal-engine";
import { getAdapter } from "@/lib/exchanges/exchange-factory";
import { getDailyStatus } from "./daily-target";
import { getUniverseSlice, type ScanUniverse } from "./symbol-universe";
import { selectDynamicCandidates, type DynamicCandidateResult } from "@/lib/engines/dynamic-universe";
import {
  getUnifiedCandidates,
  getUnifiedProviderLastError,
  type UnifiedCandidateBundle,
  type UnifiedCandidateMetadata,
} from "@/lib/engines/unified-candidate-provider";
import { isAutoTradeAllowed, applyDynamicDowngrade, classifyTier, getPrioritySymbols, tierWhitelist, getTierPolicy } from "@/lib/risk-tiers";
import { checkAggressivePaperMode } from "@/lib/aggressive-paper-mode";
import { calculateStrategyHealth } from "./strategy-health";
import { buildRiskExecutionConfig, ensureHydrated } from "@/lib/risk-settings";
import { ensureScanModesHydrated } from "@/lib/scan-modes";
import type { ExchangeName, Timeframe } from "@/lib/exchanges/types";

export type BotStatus = "running" | "paused" | "stopped" | "kill_switch";

/**
 * Phase 14 — mode-safe gate for the unified candidate pool.
 *
 * Candidate selection is mode-independent. The unified pool feeds analysis
 * for both paper and live modes. Execution safety is handled separately by
 * the triple gate in live-trading-guard.ts.
 *
 * Allowed when:
 *  - trading_mode is "paper" (or unset) — always allowed.
 *  - trading_mode is "live" — allowed only when the full triple live gate
 *    passes: env.hardLiveTradingAllowed=true + enable_live_trading=true.
 *    When gate is not open, live EXECUTION is what stays blocked, not the
 *    candidate pool analysis layer.
 *
 * This never opens live trading. It only decides whether the unified pool
 * is allowed to widen the analysis universe.
 */
export interface UnifiedPoolModeCheck {
  allowed: boolean;
  /** null when allowed; gate reason when blocked. */
  blockedReason: string | null;
  /** "paper" | "live" */
  tradeMode: string;
  /** "simulated" | "real" | "live_gate_closed" */
  executionMode: string;
}

export function canUseUnifiedCandidatePoolForMode(settings: {
  trading_mode?: string | null;
  enable_live_trading?: boolean | null;
}): UnifiedPoolModeCheck {
  const isLiveMode = settings.trading_mode === "live";

  if (!isLiveMode) {
    return {
      allowed: true,
      blockedReason: null,
      tradeMode: settings.trading_mode ?? "paper",
      executionMode: "simulated",
    };
  }

  // Live mode: unified pool allowed only when triple live gate fully passes.
  const hardAllowed = env.hardLiveTradingAllowed;
  const enableLive = settings.enable_live_trading === true;
  if (hardAllowed && enableLive) {
    return { allowed: true, blockedReason: null, tradeMode: "live", executionMode: "real" };
  }

  const missing: string[] = [];
  if (!hardAllowed) missing.push("HARD_LIVE_TRADING_ALLOWED=false");
  if (!enableLive) missing.push("enable_live_trading=false");
  return {
    allowed: false,
    blockedReason: `live_execution_gate_blocked: ${missing.join(", ")}`,
    tradeMode: "live",
    executionMode: "live_gate_closed",
  };
}

/**
 * @deprecated Use canUseUnifiedCandidatePoolForMode instead.
 * Kept for backwards compatibility with existing callers.
 */
export function isUnifiedPoolPaperSafe(settings: {
  trading_mode?: string | null;
  enable_live_trading?: boolean | null;
}): { safe: boolean; reason: string | null } {
  const check = canUseUnifiedCandidatePoolForMode(settings);
  return { safe: check.allowed, reason: check.blockedReason };
}

// Subset of signal-engine raw indicator features promoted to scan_details so the
// dashboard can verify them without digging into per-tick logs. Mirrors signal-engine
// feature keys 1:1 — see signal-engine.ts for definitions.
export interface ScanIndicators {
  ma8: number | null;
  ma55: number | null;
  ma8Slope: number | null;
  ma55Slope: number | null;
  ma8AboveMa55: boolean | null;
  priceAboveMa8: boolean | null;
  priceAboveMa55: boolean | null;
  bollingerUpper: number | null;
  bollingerMiddle: number | null;
  bollingerLower: number | null;
  bollingerWidth: number | null;
  bollingerPosition: number | null;
  bollingerSqueeze: boolean;
  bollingerExpansion: boolean;
  bollingerBreakoutUp: boolean;
  bollingerBreakoutDown: boolean;
  adx: number | null;
  adxTrendStrength: string;
  vwap: number | null;
  priceAboveVwap: boolean | null;
  volumeMa20: number | null;
  volumeImpulse: number | null;
  atrPercentile: number | null;
  // Observation-only — surfaced for the Phase 8 scanner picker.
  // Already computed by signal-engine; never gates trades.
  rsi: number | null;
  macdHist: number | null;
}

const INDICATOR_KEYS: readonly (keyof ScanIndicators)[] = [
  "ma8", "ma55", "ma8Slope", "ma55Slope", "ma8AboveMa55", "priceAboveMa8", "priceAboveMa55",
  "bollingerUpper", "bollingerMiddle", "bollingerLower", "bollingerWidth", "bollingerPosition",
  "bollingerSqueeze", "bollingerExpansion", "bollingerBreakoutUp", "bollingerBreakoutDown",
  "adx", "adxTrendStrength", "vwap", "priceAboveVwap",
  "volumeMa20", "volumeImpulse", "atrPercentile",
  "rsi", "macdHist",
] as const;

function pickIndicators(features: Record<string, unknown>): ScanIndicators {
  const out: Record<string, unknown> = {};
  for (const k of INDICATOR_KEYS) {
    out[k] = features[k] ?? null;
  }
  return out as unknown as ScanIndicators;
}

export interface ScanDetail {
  symbol: string;
  coinClass?: "CORE" | "DYNAMIC";
  tier: string;
  spreadPercent: number;
  atrPercent: number;
  fundingRate: number;
  orderBookDepth: number;       // USDT — top-10 bid+ask average
  signalType: string;
  // Trade confidence — 0 for WAIT / early-exit NO_TRADE. The ONLY score that gates trade opening.
  // tradeSignalScore is the canonical name; signalScore is kept as alias for backwards compat.
  tradeSignalScore: number;
  signalScore: number;
  setupScore: number;           // opportunity quality (10-component), >0 whenever indicators computed
  marketQualityScore: number;   // coin tradability quality (volume/spread/depth/ATR/funding)
  // ── Diagnostic fields — display/logging only, never used in trade/signal/risk logic ──
  /** Signal-engine MQS before order-book depth adjustment (0-85). Display diagnostic only. */
  mqsBaseScore?: number;
  /** Order-book depth adjustment applied by orchestrator (-15 to +15). Display diagnostic only. */
  mqsDepthAdjustment?: number;
  // Direction explainability — observation-only, never gates trades.
  longSetupScore?: number;
  shortSetupScore?: number;
  directionCandidate?: "LONG_CANDIDATE" | "SHORT_CANDIDATE" | "MIXED" | "NONE";
  directionConfidence?: number;
  waitReasonCodes?: string[];
  /** Faz 12 — kısa Türkçe sebep özeti (display only). */
  waitReasonSummary?: string;
  scoreType: "signal" | "setup" | "none";  // which score is meaningful to display
  scoreReason: string;          // brief label for the scanner UI
  rejectReason: string | null;
  riskAllowed: boolean | null;
  riskRejectReason: string | null;
  opened: boolean;
  // Raw indicator snapshot — independent of score breakdown, useful for verification.
  indicators?: ScanIndicators;
  // Legacy umbrella flag — kept for backwards compat with persisted data and tests.
  opportunityCandidate: boolean;
  // Set when signal-engine produced nearMissDirection (score 50-69, all gates passed except threshold).
  nearMissSignal?: boolean;
  // Set when setupScore >= STRONG_SETUP_THRESHOLD — strong structure even without a fired signal.
  strongSetupCandidate?: boolean;
  // Set when signal-engine returned NO_TRADE specifically because of the BTC trend veto.
  btcTrendRejected?: boolean;
  // ── Phase 6: unified candidate metadata (display / debug only) ──
  // These fields are observation-only and never alter signal-engine, risk
  // engine, the trade-open gate or the live-trading gate. They are
  // populated only when the unified-candidate-pool feature flag is on AND
  // the symbol entered analysis via the orchestrator's deep-analysis subset.
  /** Resolved source label: "GMT" / "MT" / "MİL" / "KRM". */
  sourceDisplay?: string | null;
  /** Full source list (e.g., ["WIDE_MARKET","MOMENTUM"]). */
  candidateSources?: string[];
  /** 1-based rank in the unified deep-analysis subset. */
  candidateRank?: number;
  /** 0-100 lightweight pre-score (orchestrator). Distinct from marketQualityScore. */
  marketQualityPreScore?: number;
  /** 0-100 momentum quality score, when the candidate originated from MT. */
  momentumScore?: number;
  /** Snapshot timestamp of the unified pool the metadata was taken from. */
  candidatePoolGeneratedAt?: number;
  // ── Display filter annotations (post-analysis, display-only) ──
  // Set by filterScanDetailsForDisplay — never used by trade/signal/risk logic.
  /** True when this row passed filterScanDetailsForDisplay; false when eliminated. */
  displayFilterPassed?: boolean;
  /** Primary reason a DYNAMIC row was eliminated from the strict scanner gate. */
  displayFilterReason?: "quality_below_threshold" | "setup_below_threshold" | "signal_below_threshold" | null;
  /** All elimination reasons (may contain multiple codes, e.g. signal_below_threshold + btc_conflict). */
  displayFilterReasons?: string[];
  /** Short Turkish reason summary for the scanner SEBEP column when the row was display-filtered. */
  displayFilterReasonText?: string;
  /** True when this trade was opened via Aggressive Paper Test Mode relaxed gates. */
  aggressivePaperOpened?: boolean;
}

// ── Display filter reason text mapping (Turkish, scanner SEBEP column) ──
// Display-only — never used by trade/signal/risk logic.
const DISPLAY_FILTER_REASON_TR: Record<string, string> = {
  quality_below_threshold: "Filtrelendi: piyasa kalitesi düşük",
  setup_below_threshold: "Filtrelendi: setup eşiği düşük",
  signal_below_threshold: "Filtrelendi: işlem skoru düşük",
  low_volume: "Hacim zayıf",
  weak_momentum: "Yön teyidi bekleniyor: hacim zayıf",
  btc_conflict: "BTC yönü ters",
  no_confirmed_direction: "Yön teyidi yok",
};

export function buildDisplayFilterReasonText(reasons: string[]): string {
  if (!reasons || reasons.length === 0) return "";
  const parts = reasons.map((r) => DISPLAY_FILTER_REASON_TR[r] ?? r);
  return parts.slice(0, 2).join(" · ");
}

// A dynamic row is shown in the scanner table only if it carries real opportunity signal.
// CORE rows are always retained — the user wants to see WAIT/NO_TRADE for the pinned set.
export function isOpportunityCandidate(detail: Pick<ScanDetail, "signalScore" | "signalType" | "opportunityCandidate">): boolean {
  return detail.opportunityCandidate === true ||
    detail.signalScore >= 50 ||
    detail.signalType === "LONG" ||
    detail.signalType === "SHORT";
}

// Strict thresholds — scanner main table is a decision screen, not a scan dump.
// CORE coins bypass all gates. DYNAMIC coins must clear all three to appear.
const DYNAMIC_MIN_QUALITY = 75;   // marketQualityScore: tradable coin
const DYNAMIC_MIN_SETUP = 70;     // setupScore: meaningful structure
const DYNAMIC_MIN_SIGNAL = 50;    // tradeSignalScore: at least near-miss
const STRONG_SETUP_THRESHOLD = 80;

export interface FilterScanResult {
  kept: ScanDetail[];
  eliminated: number;             // total dropped (sum of below)
  eliminatedQuality: number;      // marketQualityScore < 75
  eliminatedSetup: number;        // setupScore < 70 (after quality passed)
  eliminatedSignal: number;       // quality+setup ok but no signal/near-miss/direction/strong-setup
  btcTrendRejected: number;       // dropped rows whose rejectReason came from BTC trend veto
}

// Pool used by the "Fırsata En Yakın 5 Coin" card — broader than the strict scanner table.
// Includes the strict survivors plus dynamic rows that have a meaningful score (signal or setup)
// even if they didn't fully clear the strict gates. Capped to keep payload size bounded.
export function buildOpportunityPool(details: ScanDetail[], cap = 30): ScanDetail[] {
  const withScore = details.filter((d) => {
    if (d.coinClass === "CORE") return true;
    return (d.signalScore ?? 0) > 0 || (d.setupScore ?? 0) >= 50;
  });
  withScore.sort((a, b) => {
    const sa = (a.signalScore ?? 0), sb = (b.signalScore ?? 0);
    if (sb !== sa) return sb - sa;
    return (b.setupScore ?? 0) - (a.setupScore ?? 0);
  });
  return withScore.slice(0, cap);
}

export function filterScanDetailsForDisplay(details: ScanDetail[]): FilterScanResult {
  let eliminatedQuality = 0;
  let eliminatedSetup = 0;
  let eliminatedSignal = 0;
  let btcTrendRejected = 0;

  const kept: ScanDetail[] = [];

  for (const d of details) {
    if (d.coinClass !== "DYNAMIC") {
      d.displayFilterPassed = true;
      d.displayFilterReason = null;
      d.displayFilterReasons = [];
      kept.push(d);
      continue;
    }

    // Quality gate
    const mqs = (d as any).marketQualityScore ?? 100;
    if (mqs < DYNAMIC_MIN_QUALITY) {
      eliminatedQuality++;
      if (d.btcTrendRejected) btcTrendRejected++;
      const reasons = ["quality_below_threshold"];
      if (mqs < 50) reasons.push("low_volume");
      if (d.btcTrendRejected) reasons.push("btc_conflict");
      d.displayFilterPassed = false;
      d.displayFilterReason = "quality_below_threshold";
      d.displayFilterReasons = reasons;
      // Build detailed rejection text — diagnostic only, never affects trade logic.
      {
        const depthAdj = d.mqsDepthAdjustment;
        const parts: string[] = [`MQS ${mqs}/${DYNAMIC_MIN_QUALITY}`];
        if (typeof depthAdj === "number" && depthAdj !== 0) {
          parts.push(`depth ${depthAdj > 0 ? "+" : ""}${depthAdj}`);
        }
        if (d.btcTrendRejected) parts.push("BTC zıt");
        d.displayFilterReasonText = `Kalite düşük: ${parts.join(", ")}`;
      }
      continue;
    }

    // Setup gate
    const setup = d.setupScore ?? 0;
    if (setup < DYNAMIC_MIN_SETUP) {
      eliminatedSetup++;
      if (d.btcTrendRejected) btcTrendRejected++;
      const reasons = ["setup_below_threshold"];
      if ((d.signalScore ?? 0) < 30) reasons.push("weak_momentum");
      if (d.btcTrendRejected) reasons.push("btc_conflict");
      d.displayFilterPassed = false;
      d.displayFilterReason = "setup_below_threshold";
      d.displayFilterReasons = reasons;
      d.displayFilterReasonText = buildDisplayFilterReasonText(reasons);
      continue;
    }

    // Signal/opportunity gate — at least one must hold
    const hasSignal = (d.signalScore ?? 0) >= DYNAMIC_MIN_SIGNAL;
    const hasDirection = d.signalType === "LONG" || d.signalType === "SHORT";
    const hasNearMiss = d.nearMissSignal === true;
    const hasStrongSetup = d.strongSetupCandidate === true || setup >= STRONG_SETUP_THRESHOLD;
    if (!hasSignal && !hasDirection && !hasNearMiss && !hasStrongSetup) {
      eliminatedSignal++;
      if (d.btcTrendRejected) btcTrendRejected++;
      const reasons = ["signal_below_threshold"];
      if (!hasDirection) reasons.push("no_confirmed_direction");
      if (d.btcTrendRejected) reasons.push("btc_conflict");
      d.displayFilterPassed = false;
      d.displayFilterReason = "signal_below_threshold";
      d.displayFilterReasons = reasons;
      d.displayFilterReasonText = buildDisplayFilterReasonText(reasons);
      continue;
    }

    d.displayFilterPassed = true;
    d.displayFilterReason = null;
    d.displayFilterReasons = [];
    d.displayFilterReasonText = "";
    kept.push(d);
  }

  return {
    kept,
    eliminated: eliminatedQuality + eliminatedSetup + eliminatedSignal,
    eliminatedQuality,
    eliminatedSetup,
    eliminatedSignal,
    btcTrendRejected,
  };
}

export interface TickResult {
  ok: boolean;
  reason?: string;
  scannedSymbols: string[];
  generatedSignals: { symbol: string; type: string; score: number }[];
  openedPaperTrades: { symbol: string; direction: string; entryPrice: number }[];
  rejectedSignals: { symbol: string; reason: string }[];
  // Signals that passed all filters except score (50-69). Never opens a trade.
  nearMissSignals: { symbol: string; direction: string; score: number; reason: string }[];
  errors: { symbol: string; error: string }[];
  scanDetails: ScanDetail[];
  durationMs: number;
  totalUniverseSymbols?: number;
  prefilteredSymbols?: number;
  deeplyAnalyzedSymbols?: number;
  // Phase 14 — mode-safe diagnostics (display/debug only, never gate trades).
  /** True when unified candidate pool was allowed for this mode. */
  unifiedCandidatePoolModeAllowed?: boolean;
  /** Gate reason when pool was blocked; null when allowed. */
  unifiedCandidatePoolBlockedReason?: string | null;
  /** "paper" | "live" — resolved trade mode for this tick. */
  tradeMode?: string;
  /** "simulated" | "real" | "live_gate_closed" — resolved execution mode. */
  executionMode?: string;
  // Coins removed before deep analysis because 24h volume < 5M USDT (signal-engine hard floor).
  // Counted but never added to scanDetails — keeps the table clean.
  lowVolumePrefilterRejected?: number;
  nextCursor?: string;
  dynamicCandidatesCount?: number;
  dynamicRejectedLowVolume?: number;
  dynamicRejectedStablecoin?: number;
  dynamicRejectedHighSpread?: number;
  dynamicRejectedPumpDump?: number;
  dynamicRejectedWeakMomentum?: number;
  dynamicRejectedNoData?: number;
  dynamicRejectedInsufficientDepth?: number;  // order book depth check in per-symbol loop
  // Dynamic candidates that ran full analysis but produced no opportunity. Total of the
  // three granular fields below.
  dynamicEliminatedLowSignal?: number;
  // Granular elimination breakdown — strict scanner gate.
  dynamicEliminatedQuality?: number;     // marketQualityScore < 75
  dynamicEliminatedSetup?: number;       // setupScore < 70
  dynamicEliminatedSignal?: number;      // no signal/near-miss/direction/strong-setup
  // BTC trend veto — counted among the eliminated above. Diagnostic visibility only.
  dynamicBtcTrendRejected?: number;
  // Dynamic rows that survived the post-analysis opportunity filter and made it to the
  // scanner table. This — not the pre-filter pool size — is what "Dinamik Gösterilen"
  // displays. Strictly bounded by the new gates; in flat markets typically 0-5.
  dynamicOpportunityCandidates?: number;
  // Broader pool used by the "Fırsata En Yakın 5 Coin" card — includes high-setup dynamics
  // that didn't clear the strict scanner gate.
  opportunityPool?: ScanDetail[];
  // ── Phase 6 / 7 — unified candidate pool diagnostics (display only) ──
  /** All analyzed scan details with display-filter annotations. Capped at 80. Display-only. */
  allAnalyzedScanDetails?: ScanDetail[];
  /** True when the unified pool fed this tick's additional candidates. */
  unifiedCandidatePoolActive?: boolean;
  /** Pool size from the orchestrator (≤ 50). */
  unifiedPoolSize?: number;
  /** Deep-analysis subset size (≤ 30). */
  unifiedDeepCandidatesCount?: number;
  /** Snapshot timestamp of the unified pool used. */
  unifiedPoolGeneratedAt?: number;
  /** True when this tick's bundle came from the provider's TTL cache. */
  unifiedPoolFromCache?: boolean;
  /** Most recent provider error message, or null. Diagnostic-only. */
  unifiedProviderError?: string | null;
  /** Total symbols actually deeply analyzed this tick (core + unified, deduped). */
  analyzedSymbolsCount?: number;
  /** Core whitelist symbols analyzed this tick. */
  coreSymbolsCount?: number;
  /** Unified-pool symbols added on top of core (after dedupe). */
  unifiedSymbolsCount?: number;
  // Faz 20 — risk config binding diagnostics (display-only)
  riskConfigBound?: boolean;
  maxOpenPositionsFromRiskSettings?: number;
  dynamicMaxOpenPositions?: number;
  maxDailyTradesFromRiskSettings?: number;
  effectiveCapitalUsdt?: number;
  riskCapitalSource?: string;
}

const PAPER_BALANCE = 1000;

// Diagnostics-only: write a minimal tick summary so the freshness timestamp stays current
// even when tickBot exits early (daily target, strategy gate, max positions, etc.).
// Never called when isLockOwner is explicitly false — non-owners must not overwrite.
// Failures are silently swallowed because this is diagnostics-only, not trade-critical.
async function writeSkipSummary(
  userId: string,
  wCtx: WorkerContext | undefined,
  skipReason: string,
  tickStartedAt: string,
): Promise<void> {
  if (wCtx?.isLockOwner === false) return;
  if (!supabaseConfigured()) return;
  const tickCompletedAt = new Date().toISOString();
  try {
    await supabaseAdmin().from("bot_settings").update({
      last_tick_at: tickCompletedAt,
      last_tick_summary: {
        at: tickCompletedAt,
        generatedAt: tickCompletedAt,
        tickSkipped: true,
        skipReason,
        tickError: null,
        workerLockOwner: wCtx?.isLockOwner ?? true,
        worker_id: wCtx?.workerId ?? null,
        tickStartedAt,
        tickCompletedAt,
      },
    }).eq("user_id", userId);
  } catch { /* diagnostics-only, non-fatal */ }
}

async function loadSettings(userId: string) {
  if (!supabaseConfigured()) return null;
  const sb = supabaseAdmin();

  // Use upsert with ignoreDuplicates so a conflicting row never causes a hard error.
  // We always re-select afterwards to return the canonical row regardless of insert/conflict.
  const insert = {
    user_id: userId,
    active_exchange: env.defaultActiveExchange,
    trading_mode: env.defaultTradingMode,
    market_type: env.defaultMarketType,
    margin_mode: env.defaultMarginMode,
    bot_status: "stopped",
    max_leverage: env.maxLeverage,
    max_allowed_leverage: env.maxAllowedLeverage,
    risk_per_trade_percent: env.maxRiskPerTradePercent,
    max_daily_loss_percent: env.maxDailyLossPercent,
    max_weekly_loss_percent: env.maxWeeklyLossPercent,
    daily_profit_target_usd: env.dailyProfitTargetUsd,
    max_open_positions: env.maxOpenPositions,
    min_risk_reward_ratio: env.minRiskRewardRatio,
    scan_universe: "all_futures",
    min_24h_volume_usd: 500_000,
    max_spread_percent: 0.1,
    max_funding_rate_abs: 0.003,
    max_symbols_per_tick: 50,
    max_concurrent_requests: 5,
    kline_limit: 250,
    scanner_timeframe: "5m",
    scanner_cursor: "0",
  };

  // Fetch all rows (single-tenant: at most 1 row) — avoids UUID .eq() PostgREST cast issues.
  const { data: rows, error: readErr } = await sb
    .from("bot_settings")
    .select("*")
    .limit(1);
  if (readErr) throw new Error(`bot_settings okunamadı: ${readErr.message}`);
  const existing = rows?.[0] ?? null;
  if (existing) {
    // Override active_exchange with exchange_credentials.is_active=true (primary source of truth)
    const { data: credRows } = await sb
      .from("exchange_credentials")
      .select("exchange_name")
      .eq("is_active", true)
      .limit(1);
    const activeCred = credRows?.[0]?.exchange_name;
    if (activeCred) {
      existing.active_exchange = (activeCred as string).toLowerCase();
    } else {
      // No active credential — self-heal bot_settings.active_exchange to env default.
      // This clears stale values (e.g. "mexc" left over after credential changes).
      const envExchange = env.defaultActiveExchange || "binance";
      if (existing.active_exchange !== envExchange) {
        existing.active_exchange = envExchange;
        await sb.from("bot_settings").update({ active_exchange: envExchange }).neq("id", "00000000-0000-0000-0000-000000000000");
      }
    }
    return existing;
  }

  // No row exists — insert with defaults (bot_status: stopped).
  // On duplicate key (race condition), re-fetch.
  const { data: created, error: insertErr } = await sb
    .from("bot_settings")
    .insert(insert)
    .select()
    .single();

  if (!insertErr) return created;

  const isDuplicate = (insertErr as any)?.code === "23505" || /duplicate key/i.test(insertErr.message ?? "");
  if (!isDuplicate) {
    throw new Error(`bot_settings yazılamadı: ${insertErr.message}`);
  }

  // Row appeared between our read and insert — fetch it now.
  const { data: retryRows, error: retryErr } = await sb
    .from("bot_settings")
    .select("*")
    .limit(1);
  if (retryErr) throw new Error(`bot_settings re-read hatası: ${retryErr.message}`);
  return retryRows?.[0] ?? null;
}

export async function getBotState(userId: string) {
  return loadSettings(userId);
}

export async function setBotStatus(userId: string, status: BotStatus, reason?: string) {
  if (!supabaseConfigured()) {
    throw new Error("Supabase yapılandırılmamış — bot status güncellenemiyor");
  }
  // Ensure a settings row exists with all required defaults before mutating status.
  await loadSettings(userId);

  const sb = supabaseAdmin();
  const isKillSwitch = status === "kill_switch";
  const dbStatus = isKillSwitch ? "kill_switch_triggered" : status;

  const patch: Record<string, unknown> = {
    bot_status: dbStatus,
    kill_switch_active: isKillSwitch,
  };
  if (isKillSwitch) {
    // Write reason + force live trading off on kill switch
    patch.kill_switch_reason = reason ?? "Kill switch tetiklendi";
    patch.enable_live_trading = false;
  }

  const { error } = await sb.from("bot_settings").update(patch).eq("user_id", userId);

  if (error) {
    await botLog({
      userId, level: "error", eventType: "bot_status_error",
      message: `setBotStatus(${dbStatus}) hata: ${error.message}`,
    });
    throw new Error(`bot_settings güncellenemedi: ${error.message}`);
  }

  await botLog({
    userId, level: isKillSwitch ? "warn" : "info",
    eventType: `bot_${dbStatus}`,
    message: `Bot status -> ${dbStatus}${reason ? `: ${reason}` : ""}`,
  });
  if (isKillSwitch) {
    await riskEvent({ userId, eventType: "kill_switch", severity: "critical", message: reason ?? "Kill switch tetiklendi" });
  }
  return { bot_status: dbStatus, kill_switch_active: isKillSwitch };
}

export interface WorkerContext {
  workerId?: string;
  containerId?: string;
  gitCommit?: string;
  processPid?: number;
  isLockOwner?: boolean;
}

export async function tickBot(userId: string, opts?: { timeframe?: Timeframe; symbols?: string[]; workerContext?: WorkerContext }): Promise<TickResult> {
  const start = Date.now();
  const tickStartedAt = new Date(start).toISOString();
  const result: TickResult = {
    ok: false,
    scannedSymbols: [],
    generatedSignals: [],
    openedPaperTrades: [],
    rejectedSignals: [],
    nearMissSignals: [],
    errors: [],
    scanDetails: [],
    durationMs: 0,
  };

  await botLog({ userId, eventType: "tick_started", message: "Tick başladı" });

  const settings = await loadSettings(userId);
  if (!settings) {
    result.reason = "Supabase yapılandırılmamış";
    result.durationMs = Date.now() - start;
    await botLog({ userId, level: "error", eventType: "tick_failed", message: result.reason });
    return result;
  }

  // Faz 20 — load risk execution config (hydrates from DB on first call).
  await ensureHydrated();
  // Scan Modes Persistence — UI'dan yapılan toggle/manuel-liste değişiklikleri
  // worker tick'inde de geçerli olsun diye DB'den hydrate ediyoruz.
  await ensureScanModesHydrated();
  const riskCfg = buildRiskExecutionConfig();

  // Effective capital: risk settings value if > 0, else PAPER_BALANCE fallback.
  const riskCapitalSource: "risk_settings" | "capital_missing_fallback" =
    riskCfg.totalBotCapitalUsdt > 0 ? "risk_settings" : "capital_missing_fallback";
  const effectiveCapitalUsdt =
    riskCfg.totalBotCapitalUsdt > 0 ? riskCfg.totalBotCapitalUsdt : PAPER_BALANCE;
  const isRunning = ["running", "running_paper", "running_live"].includes(settings.bot_status ?? "");
  if (!isRunning) {
    result.reason = `Bot durumu: ${settings.bot_status}`;
    result.durationMs = Date.now() - start;
    await botLog({ userId, eventType: "tick_skipped", message: result.reason });
    await writeSkipSummary(userId, opts?.workerContext, `bot_not_running:${settings.bot_status}`, tickStartedAt);
    return result;
  }

  const exchange = settings.active_exchange as ExchangeName;
  const adapter = getAdapter(exchange);
  const tf: Timeframe = opts?.timeframe ?? (settings.scanner_timeframe as Timeframe) ?? "5m";
  const DYNAMIC_ANALYSIS_LIMIT = env.dynamicAnalysisLimit;
  const coreSet = new Set(tierWhitelist());

  if (!supabaseConfigured()) {
    result.reason = "Supabase yapılandırılmamış";
    result.durationMs = Date.now() - start;
    return result;
  }

  const sb = supabaseAdmin();

  // Sweep SL/TP on open paper trades first
  await evaluateOpenTrades(userId);

  // Get symbol universe (cursor-based batch rotation across all futures)
  let symbols: string[];
  let universeTotal = 0;
  let universePrefiltered = 0;
  let tickerMap: Record<string, any> = {};
  let nextCursor = "0";
  let dynamicResult: DynamicCandidateResult | null = null;
  // Phase 6: unified candidate bundle (null when feature flag off or any
  // failure inside the provider — falls back to legacy core+dynamic flow).
  let unifiedBundle: UnifiedCandidateBundle | null = null;
  let unifiedMetaBySymbol: Record<string, UnifiedCandidateMetadata> = {};
  // Symbols routed in via the unified pool (treated as DYNAMIC for tier/risk
  // gates — never auto-traded in live mode, just like legacy dynamics).
  const unifiedSymbolSet = new Set<string>();
  // Phase 14 — mode-safe check: candidate selection is mode-independent.
  // Hoisted here so the diagnostic-population block below has it in scope
  // even when symbols come from opts.symbols (the test/manual path).
  const poolModeCheck = canUseUnifiedCandidatePoolForMode(settings);

  if (opts?.symbols && opts.symbols.length > 0) {
    symbols = opts.symbols;
  } else {
    try {
      const scanMode = (settings.scan_universe as ScanUniverse) ?? "all_futures";
      const cursor = settings.scanner_cursor ?? "0";
      const universe = await getUniverseSlice({
        exchange,
        scanMode,
        min24hVolumeUsd: Number(settings.min_24h_volume_usd ?? 500_000),
        maxSpreadPct: Number(settings.max_spread_percent ?? 0.1),
        maxFundingRateAbs: Number(settings.max_funding_rate_abs ?? 0.003),
        maxSymbolsPerTick: Number(settings.max_symbols_per_tick ?? 50),
        cursor,
        // All whitelist coins (TIER_1+2+3) pinned to every tick — never missed by cursor rotation
        prioritySymbols: tierWhitelist(),
      });
      universeTotal = universe.totalSymbols;
      universePrefiltered = universe.preFilteredCount;
      tickerMap = universe.tickerMap;
      nextCursor = universe.nextCursor;

      // Dynamic Universe v2: quality-select candidates from full symbol list.
      // maxCandidates is a ceiling only — fewer quality candidates = shorter list, never quota-filled.
      dynamicResult = selectDynamicCandidates({
        allSymbols: universe.allSymbols,
        tickerMap,
        coreSet,
        maxCandidates: DYNAMIC_ANALYSIS_LIMIT,
        minVolume24hUsd: 50_000_000,
        maxSpreadPct: 0.2,
        maxPriceChangePct: 25,
        minMomentumPct: 1.0,   // |24h change| must be >= 1% — dead/flat markets excluded
      });

      // ── Phase 6 / 7 / 14: optional unified candidate pool ──
      // Activates when the feature flag is on AND the mode-safe check passes.
      // Candidate selection is mode-independent (Phase 14): pool runs for
      // paper mode and, when triple live gate is fully open, for live mode.
      // On mode gate blocked, execution is what stays off — not the pool.
      // On provider failure the bundle is null and we transparently fall
      // through to the legacy dynamic candidates.
      let unifiedSymbols: string[] = [];
      if (env.useUnifiedCandidatePool && poolModeCheck.allowed) {
        try {
          unifiedBundle = await getUnifiedCandidates({ exchange });
        } catch {
          unifiedBundle = null; // belt-and-braces — provider already swallows.
        }
        if (unifiedBundle && unifiedBundle.deepCandidates.length > 0) {
          unifiedMetaBySymbol = unifiedBundle.metadataBySymbol;
          // Strip core coins (already in batch) and dedupe across legacy
          // dynamic candidates so we never analyse the same symbol twice.
          const seen = new Set<string>(tierWhitelist());
          for (const c of unifiedBundle.deepCandidates) {
            if (seen.has(c.symbol)) continue;
            seen.add(c.symbol);
            unifiedSymbols.push(c.symbol);
            unifiedSymbolSet.add(c.symbol);
          }
        }
      } else if (env.useUnifiedCandidatePool && !poolModeCheck.allowed) {
        // Flag on but mode/execution gate blocked — surface the reason so
        // dashboards can see why core-only mode is active.
        result.unifiedProviderError = poolModeCheck.blockedReason;
      }

      // Batch = core coins + (unified deep candidates IF flag on AND non-empty,
      // else legacy dynamic candidates). Hard caps preserved by the orchestrator
      // (deepMax ≤ 30) and the legacy selector (DYNAMIC_ANALYSIS_LIMIT).
      const additional = (unifiedBundle && unifiedSymbols.length > 0)
        ? unifiedSymbols
        : dynamicResult.candidates;
      symbols = [...tierWhitelist(), ...additional];

      await sb.from("bot_settings").update({ scanner_cursor: nextCursor }).eq("user_id", userId);
    } catch {
      symbols = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT"];
    }
  }

  result.scannedSymbols = symbols;
  result.totalUniverseSymbols = universeTotal;
  result.prefilteredSymbols = universePrefiltered;
  result.nextCursor = nextCursor;
  result.dynamicCandidatesCount = dynamicResult?.candidates.length ?? 0;
  result.dynamicRejectedLowVolume = dynamicResult?.rejectedLowVolume ?? 0;
  result.dynamicRejectedStablecoin = dynamicResult?.rejectedStablecoin ?? 0;
  result.dynamicRejectedHighSpread = dynamicResult?.rejectedHighSpread ?? 0;
  result.dynamicRejectedPumpDump = dynamicResult?.rejectedPumpDump ?? 0;
  result.dynamicRejectedWeakMomentum = dynamicResult?.rejectedWeakMomentum ?? 0;
  result.dynamicRejectedNoData = dynamicResult?.rejectedNoData ?? 0;
  // Phase 6 / 7 — populate unified diagnostics. These are display-only and
  // never gate trade decisions. When the flag is off or the safety gate is
  // closed, the bundle stays null and only the (optional) provider error is
  // surfaced — existing dashboards see no behavioural change.
  // Phase 14 — populate mode-safe diagnostics (display-only).
  result.unifiedCandidatePoolModeAllowed = poolModeCheck.allowed;
  result.unifiedCandidatePoolBlockedReason = poolModeCheck.blockedReason;
  result.tradeMode = poolModeCheck.tradeMode;
  result.executionMode = poolModeCheck.executionMode;

  if (unifiedBundle) {
    result.unifiedCandidatePoolActive = unifiedSymbolSet.size > 0;
    result.unifiedPoolSize = unifiedBundle.poolSize;
    result.unifiedDeepCandidatesCount = unifiedBundle.deepCandidates.length;
    result.unifiedPoolGeneratedAt = unifiedBundle.generatedAt;
    result.unifiedPoolFromCache = unifiedBundle.fromCache;
  } else if (env.useUnifiedCandidatePool && poolModeCheck.allowed) {
    // Flag on, mode gate open, but provider returned null → real error.
    result.unifiedCandidatePoolActive = false;
    if (!result.unifiedProviderError) {
      result.unifiedProviderError = getUnifiedProviderLastError(exchange) ?? "provider returned null";
    }
  }

  const daily = await getDailyStatus(userId, effectiveCapitalUsdt, {
    dailyMaxLossPercent: riskCfg.dailyMaxLossPercent,
  });
  if (daily.targetHit) {
    result.ok = true;
    result.reason = "daily_target_hit";
    result.durationMs = Date.now() - start;
    await botLog({ userId, eventType: "tick_completed", message: "Tick tamamlandı — günlük hedef doldu, işlem yok", metadata: { ...summary(result) } });
    await writeSkipSummary(userId, opts?.workerContext, "daily_target_hit", tickStartedAt);
    return result;
  }
  if (daily.lossLimitHit) {
    await setBotStatus(userId, "paused", "daily_loss_limit_hit");
    result.reason = "daily_loss_limit_hit";
    result.durationMs = Date.now() - start;
    await botLog({ userId, level: "warn", eventType: "tick_completed", message: "Tick — günlük zarar limiti, bot duraklatıldı" });
    await writeSkipSummary(userId, opts?.workerContext, "daily_loss_limit_hit", tickStartedAt);
    return result;
  }

  // ── STRATEGY HEALTH GATE ── block new trades if score below threshold
  const strategyHealth = await calculateStrategyHealth(userId);
  if (strategyHealth.blocked) {
    result.ok = true;
    result.reason = `strategy_health_blocked: ${strategyHealth.blockReason}`;
    result.durationMs = Date.now() - start;
    await botLog({
      userId, level: "warn", eventType: "tick_completed",
      message: `Tick — strateji sağlık gate reddetti: ${strategyHealth.blockReason}`,
      metadata: { score: strategyHealth.score, totalTrades: strategyHealth.totalTrades },
    });
    await writeSkipSummary(userId, opts?.workerContext, `strategy_health_blocked:${strategyHealth.blockReason ?? "unknown"}`, tickStartedAt);
    return result;
  }

  // Aggressive Paper Test Mode — paper-only relaxed gates.
  const aggMode = checkAggressivePaperMode(settings);
  if (aggMode.active) {
    await botLog({
      userId, eventType: "aggressive_paper_mode_active",
      message: `AGGRESSIVE PAPER TEST MODE aktif — minSignal=${aggMode.minSignalScore} minMQS=${aggMode.minMarketQuality} maxTrades=${aggMode.maxTradesPerDay} maxPos=${aggMode.maxOpenPositions} btcBypass=${aggMode.btcBypass} qualityBypass=${aggMode.qualityBypass}`,
    });
  }

  const { data: openPos } = await sb.from("paper_trades").select("id").eq("user_id", userId).eq("status", "open");
  let openCount = openPos?.length ?? 0;

  // Faz 20: use defaultMaxOpenPositions from risk settings, falling back to DB setting.
  // Aggressive mode overrides with its own (typically higher) open positions limit.
  const effectiveMaxOpenPositions = riskCfg.defaultMaxOpenPositions ?? settings.max_open_positions;
  const loopMaxOpenPositions = aggMode.active ? aggMode.maxOpenPositions : effectiveMaxOpenPositions;

  // Populate risk config diagnostics into result
  result.riskConfigBound = true;
  result.maxOpenPositionsFromRiskSettings = riskCfg.defaultMaxOpenPositions;
  result.dynamicMaxOpenPositions = riskCfg.dynamicMaxOpenPositions;
  result.maxDailyTradesFromRiskSettings = riskCfg.maxDailyTrades;
  result.effectiveCapitalUsdt = effectiveCapitalUsdt;
  result.riskCapitalSource = riskCapitalSource;

  if (openCount >= loopMaxOpenPositions) {
    result.ok = true;
    result.reason = "max_open_positions";
    result.durationMs = Date.now() - start;
    await botLog({ userId, eventType: "tick_completed", message: `Tick — maks açık pozisyon (${openCount}/${loopMaxOpenPositions}) doldu${aggMode.active ? " [AGGRESSIVE]" : ""}` });
    await writeSkipSummary(userId, opts?.workerContext, "max_open_positions", tickStartedAt);
    return result;
  }

  // Faz 20: daily trade count guard from risk settings.
  // Aggressive mode uses its own (typically higher) daily trade limit.
  const maxDailyTrades = riskCfg.maxDailyTrades;
  const loopMaxDailyTrades = aggMode.active
    ? Math.max(maxDailyTrades, aggMode.maxTradesPerDay)
    : maxDailyTrades;
  const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
  const { data: todayTrades } = await sb
    .from("paper_trades")
    .select("id")
    .eq("user_id", userId)
    .gte("opened_at", startOfDay.toISOString());
  const todayTradeCount = todayTrades?.length ?? 0;
  if (todayTradeCount >= loopMaxDailyTrades) {
    result.ok = true;
    result.reason = "max_daily_trades";
    result.durationMs = Date.now() - start;
    await botLog({ userId, eventType: "tick_completed", message: `Tick — günlük maksimum işlem sayısı (${todayTradeCount}/${loopMaxDailyTrades}) doldu${aggMode.active ? " [AGGRESSIVE DAILY_LIMIT_REACHED]" : ""}` });
    await writeSkipSummary(userId, opts?.workerContext, "max_daily_trades", tickStartedAt);
    return result;
  }

  let btcKlines: any[] = [];
  try { btcKlines = await adapter.getKlines("BTC/USDT", tf, 250); } catch { /* non-fatal */ }

  // ── Pre-gate: tier whitelist + volume ──
  // Core coins always pass. Dynamic candidates are already quality-filtered.
  // Symbols not in either set (e.g. from opts.symbols) run the legacy filter.
  const ANALYSIS_MIN_VOLUME_USDT = 5_000_000;
  const dynamicCandidateSet = new Set(dynamicResult?.candidates ?? []);
  // Phase 6: unified candidates are treated as DYNAMIC for tier/risk gates
  // (never auto-traded in live mode). Adding them to dynamicCandidateSet
  // bypasses the legacy whitelist/volume pre-filter — they were already
  // hygiene-screened by the orchestrator's lightweight + momentum screeners.
  for (const sym of unifiedSymbolSet) dynamicCandidateSet.add(sym);
  let lowVolumeSkipped = 0;
  let nonWhitelistSkipped = 0;
  const symbolsToAnalyze = symbols.filter((sym) => {
    if (coreSet.has(sym)) return true;
    if (dynamicCandidateSet.has(sym)) return true;
    if (!isAutoTradeAllowed(sym)) { nonWhitelistSkipped++; return false; }
    const vol = tickerMap[sym]?.quoteVolume24h;
    if (typeof vol !== "number" || vol < ANALYSIS_MIN_VOLUME_USDT) { lowVolumeSkipped++; return false; }
    return true;
  });
  result.lowVolumePrefilterRejected = lowVolumeSkipped + (dynamicResult?.rejectedLowVolume ?? 0);

  await botLog({ userId, exchange, eventType: "scanner_started", message: `${symbolsToAnalyze.length} sembol taranıyor (${tf}) universe=${universeTotal} prefiltered=${universePrefiltered} dynamic=${dynamicResult?.candidates.length ?? 0} nonWhitelist=${nonWhitelistSkipped} lowVolSkipped=${lowVolumeSkipped}` });

  for (const symbol of symbolsToAnalyze) {
    const isDynamic = dynamicCandidateSet.has(symbol);
    const unifiedMeta = unifiedMetaBySymbol[symbol];
    const detail: ScanDetail = {
      symbol,
      coinClass: isDynamic ? "DYNAMIC" : "CORE",
      tier: isDynamic ? "TIER_3" : classifyTier(symbol),
      spreadPercent: 0,
      atrPercent: 0,
      fundingRate: 0,
      orderBookDepth: 0,
      signalType: "UNKNOWN",
      tradeSignalScore: 0,
      signalScore: 0,
      setupScore: 0,
      marketQualityScore: 0,
      longSetupScore: 0,
      shortSetupScore: 0,
      directionCandidate: "NONE",
      directionConfidence: 0,
      waitReasonCodes: [],
      waitReasonSummary: "",
      scoreType: "none",
      scoreReason: "",
      rejectReason: null,
      riskAllowed: null,
      riskRejectReason: null,
      opened: false,
      opportunityCandidate: false,
      // Phase 6 — observation-only metadata. Skipped when the flag is off
      // (unifiedMetaBySymbol stays empty) or the symbol entered analysis via
      // the legacy dynamic path.
      ...(unifiedMeta
        ? {
            sourceDisplay: unifiedMeta.sourceDisplay,
            candidateSources: unifiedMeta.candidateSources,
            candidateRank: unifiedMeta.candidateRank,
            marketQualityPreScore: unifiedMeta.marketQualityPreScore,
            momentumScore: unifiedMeta.momentumScore,
            candidatePoolGeneratedAt: unifiedMeta.candidatePoolGeneratedAt,
          }
        : {}),
    };

    try {
      const preTicker = tickerMap[symbol];
      const [klines, ticker, info, funding, orderBook] = await Promise.all([
        adapter.getKlines(symbol, tf, 250),
        preTicker ? Promise.resolve(preTicker) : adapter.getTicker(symbol),
        adapter.getExchangeInfo(symbol),
        adapter.getFundingRate(symbol),
        adapter.getOrderBook(symbol, 10).catch(() => null),
      ]);

      // Compute bid+ask USDT depth (top-10 levels average)
      let orderbookDepthUsdt = 0;
      if (orderBook) {
        const bidDepth = orderBook.bids.slice(0, 10).reduce((s, b) => s + b.price * b.size, 0);
        const askDepth = orderBook.asks.slice(0, 10).reduce((s, a) => s + a.price * a.size, 0);
        orderbookDepthUsdt = (bidDepth + askDepth) / 2;
      }
      detail.orderBookDepth = orderbookDepthUsdt;

      detail.spreadPercent = ticker.spread * 100;
      detail.fundingRate = funding?.rate ?? 0;

      const sig = generateSignal({
        symbol, timeframe: tf, klines, ticker, funding, btcKlines,
        ...(aggMode.active ? {
          aggressiveMinScore: aggMode.minSignalScore,
          aggressiveBtcBypass: aggMode.btcBypass,
        } : {}),
      });
      detail.signalType = sig.signalType;
      detail.tradeSignalScore = sig.score;
      detail.signalScore = sig.score;
      detail.setupScore = sig.setupScore;
      // Direction explainability — diagnostic mirror of signal-engine output.
      detail.longSetupScore = sig.longSetupScore;
      detail.shortSetupScore = sig.shortSetupScore;
      detail.directionCandidate = sig.directionCandidate;
      detail.directionConfidence = sig.directionConfidence;
      detail.waitReasonCodes = sig.waitReasonCodes;
      detail.waitReasonSummary = sig.waitReasonSummary;
      detail.scoreType = sig.score > 0 ? "signal" : sig.setupScore > 0 ? "setup" : "none";
      detail.scoreReason = sig.score > 0
        ? `İşlem skoru (${sig.score}/100)`
        : sig.setupScore > 0
          ? `Fırsat skoru (${sig.setupScore}/100)`
          : "Yetersiz veri";
      detail.atrPercent = typeof sig.features.atrPctOfClose === "number" ? sig.features.atrPctOfClose : 0;
      detail.indicators = pickIndicators(sig.features as Record<string, unknown>);

      // marketQualityScore: signal-engine provides 0-85 (no order book depth).
      // Order book depth contribution (-15 to +15): low depth penalises mqs, high depth boosts it.
      // Combined with the strict 75-quality scanner gate, illiquid dynamics drop out naturally.
      {
        const baseScore = sig.marketQualityScore; // 0-85 from signal-engine
        let depthDelta = 0;
        if (orderbookDepthUsdt >= 1_000_000) depthDelta = 15;
        else if (orderbookDepthUsdt >= 500_000) depthDelta = 12;
        else if (orderbookDepthUsdt >= 250_000) depthDelta = 6;
        else if (orderbookDepthUsdt >= 150_000) depthDelta = -5;
        else if (orderbookDepthUsdt >= 50_000)  depthDelta = -10;
        else                                     depthDelta = -15;
        detail.marketQualityScore = Math.max(0, Math.min(100, baseScore + depthDelta));
        // Diagnostic — display/logging only. Trade logic is unchanged.
        detail.mqsBaseScore = baseScore;
        detail.mqsDepthAdjustment = depthDelta;
      }

      // Granular opportunity flags — read by the strict scanner filter and the broader
      // opportunity pool. Strict gate combines these with quality + setup thresholds.
      detail.nearMissSignal = !!sig.nearMissDirection;
      detail.strongSetupCandidate = sig.setupScore >= 80;
      detail.btcTrendRejected =
        sig.signalType === "NO_TRADE" &&
        typeof sig.rejectedReason === "string" &&
        sig.rejectedReason.includes("BTC trend");

      // Legacy umbrella flag — kept for backwards compat with persisted data and tests.
      detail.opportunityCandidate =
        sig.score >= 50 ||
        sig.signalType === "LONG" ||
        sig.signalType === "SHORT" ||
        !!sig.nearMissDirection ||
        sig.setupScore >= 45;

      // Persist signal for audit
      await sb.from("signals").insert({
        user_id: userId, exchange_name: exchange, market_type: "futures",
        margin_mode: settings.margin_mode, symbol, timeframe: tf,
        signal_type: sig.signalType, signal_score: sig.score,
        entry_price: sig.entryPrice, stop_loss: sig.stopLoss, take_profit: sig.takeProfit,
        risk_reward_ratio: sig.riskRewardRatio, reasons: sig.reasons,
        rejected_reason: sig.rejectedReason ?? null,
      });

      if (sig.signalType !== "LONG" && sig.signalType !== "SHORT") {
        const rejReason = sig.rejectedReason ?? sig.reasons[0] ?? sig.signalType;
        detail.rejectReason = rejReason;
        result.rejectedSignals.push({ symbol, reason: rejReason });
        await botLog({
          userId, exchange, eventType: "signal_rejected",
          message: `${symbol} ${sig.signalType} — ${rejReason}`,
          metadata: { score: sig.score, features: sig.features },
        });

        // Near-miss: passed all filters except score (50-69). Informational only, never opens a trade.
        if (sig.nearMissDirection && sig.score >= 50) {
          const nmReason = `Skor=${sig.score}/100 — 70 eşiği geçemedi (RR=${sig.riskRewardRatio?.toFixed(2) ?? "?"}, stop=${sig.features.stopDistPct ?? "?"}%)`;
          result.nearMissSignals.push({ symbol, direction: sig.nearMissDirection, score: sig.score, reason: nmReason });
          await botLog({
            userId, exchange, eventType: "near_miss_signal",
            message: `NEAR_MISS ${sig.nearMissDirection} ${symbol} skor=${sig.score}/100 — eşik 70, mevcut ${sig.score}`,
            metadata: { score: sig.score, direction: sig.nearMissDirection, rr: sig.riskRewardRatio, stopDistPct: sig.features.stopDistPct, trendScore: sig.features.trendScore, volConf: sig.features.volConf },
          });
        }

        result.scanDetails.push(detail);
        continue;
      }

      result.generatedSignals.push({ symbol, type: sig.signalType, score: sig.score });
      await botLog({
        userId, exchange, eventType: "signal_generated",
        message: `${symbol} ${sig.signalType} skor=${sig.score} — ${sig.reasons[0] ?? ""}`,
        metadata: { score: sig.score, entryPrice: sig.entryPrice },
      });

      if (!sig.entryPrice || !sig.stopLoss || !sig.takeProfit) {
        detail.rejectReason = "entry/SL/TP eksik";
        result.scanDetails.push(detail);
        continue;
      }

      // ── WHITELIST + TIER GATE ──
      if (isDynamic) {
        // Dynamic coins: allowed in paper mode only — never live trade
        if (settings.trading_mode === "live") {
          const dynReason = "Dynamic: live modda işlem yok";
          detail.rejectReason = dynReason;
          result.rejectedSignals.push({ symbol, reason: dynReason });
          result.scanDetails.push(detail);
          continue;
        }
        // Paper mode: dynamic coins proceed to risk/signal check
      } else {
        const allowedSymbols: string[] = Array.isArray(settings.allowed_symbols) && settings.allowed_symbols.length > 0
          ? settings.allowed_symbols
          : [];
        const symbolNorm = symbol.replace("/", ""); // BTC/USDT → BTCUSDT
        const inDbWhitelist = allowedSymbols.length === 0 || allowedSymbols.includes(symbolNorm) || allowedSymbols.includes(symbol);
        const inTierWhitelist = isAutoTradeAllowed(symbol);
        if (!inTierWhitelist || !inDbWhitelist) {
          const wlReason = "Whitelist dışı (tier/db)";
          detail.rejectReason = wlReason;
          result.rejectedSignals.push({ symbol, reason: wlReason });
          await botLog({
            userId, exchange, eventType: "whitelist_blocked",
            message: `${symbol} otomatik işlem whitelist dışı`,
            metadata: { tier: classifyTier(symbol), dbWhitelist: allowedSymbols.length },
          });
          result.scanDetails.push(detail);
          continue;
        }
      }

      // ── DYNAMIC TIER DOWNGRADE ──
      let tierResult: ReturnType<typeof applyDynamicDowngrade>;
      if (isDynamic) {
        // Dynamic coins use TIER_3 policy; apply runtime risk gates manually
        const atrPct = detail.atrPercent;
        const fundingPct = Math.abs((funding?.rate ?? 0) * 100);
        // Aggressive paper mode bypasses quality gates — logs but does not block.
        if (!aggMode.active || !aggMode.qualityBypass) {
          if (atrPct > 6.0) {
            const r = `Dynamic: ATR aşırı (${atrPct.toFixed(2)}%)`;
            detail.rejectReason = r;
            result.rejectedSignals.push({ symbol, reason: r });
            result.scanDetails.push(detail);
            continue;
          }
          if (fundingPct > 0.04) {
            const r = `Dynamic: Funding yüksek (${fundingPct.toFixed(3)}%)`;
            detail.rejectReason = r;
            result.rejectedSignals.push({ symbol, reason: r });
            result.scanDetails.push(detail);
            continue;
          }
          if (orderbookDepthUsdt < 150_000) {
            const r = `Dynamic: Order book yetersiz (${(orderbookDepthUsdt / 1000).toFixed(0)}K USD)`;
            detail.rejectReason = r;
            result.rejectedSignals.push({ symbol, reason: r });
            result.dynamicRejectedInsufficientDepth = (result.dynamicRejectedInsufficientDepth ?? 0) + 1;
            result.scanDetails.push(detail);
            continue;
          }
        } else {
          // Aggressive mode: log bypassed quality checks for diagnostics (error code: SPREAD_DEPTH_FATAL bypass).
          if (atrPct > 6.0 || fundingPct > 0.04 || orderbookDepthUsdt < 150_000) {
            await botLog({
              userId, exchange, eventType: "aggressive_quality_bypass",
              message: `[AGGRESSIVE PAPER] ${symbol} kalite filtresi bypass — ATR=${atrPct.toFixed(2)}% funding=${fundingPct.toFixed(3)}% depth=${(orderbookDepthUsdt / 1000).toFixed(0)}K`,
            });
          }
        }
        tierResult = {
          originalTier: "REJECTED" as const,
          effectiveTier: "TIER_3" as const,
          downgraded: false,
          rejected: false,
          reasons: ["Dinamik aday — TIER_3 politikası"],
          policy: getTierPolicy("TIER_3"),
        };
      } else {
        tierResult = applyDynamicDowngrade(symbol, {
          spreadPercent: ticker.spread * 100,
          atrPercent: detail.atrPercent,
          fundingRatePercent: Math.abs((funding?.rate ?? 0) * 100),
          orderbookDepthUsdt,
          volume24hUsdt: ticker.quoteVolume24h,
          btcDirectionAligned: undefined,
        });
        if (tierResult.rejected) {
          const tierReason = `Tier reject: ${tierResult.reasons.join(", ")}`;
          detail.rejectReason = tierReason;
          result.rejectedSignals.push({ symbol, reason: tierReason });
          await botLog({
            userId, exchange, eventType: "tier_blocked",
            message: `${symbol} tier reddetti: ${tierResult.reasons.join(", ")}`,
            metadata: { tier: tierResult.originalTier, effective: tierResult.effectiveTier },
          });
          result.scanDetails.push(detail);
          continue;
        }
      }
      detail.tier = tierResult.effectiveTier;

      const tierLeverageCap = Math.min(tierResult.policy.maxLeverage, settings.max_leverage ?? 3);

      const liq = await adapter.getEstimatedLiquidationPrice({
        symbol, direction: sig.signalType, entryPrice: sig.entryPrice,
        leverage: tierLeverageCap, marginMode: "isolated",
      });

      const risk = evaluateRisk({
        accountBalanceUsd: effectiveCapitalUsdt,
        symbol, direction: sig.signalType,
        entryPrice: sig.entryPrice, stopLoss: sig.stopLoss, takeProfit: sig.takeProfit,
        signalScore: sig.score, marketSpread: ticker.spread,
        recentLossStreak: 0, openPositionCount: openCount,
        dailyRealizedPnlUsd: daily.realizedPnlUsd, weeklyRealizedPnlUsd: daily.realizedPnlUsd,
        dailyTargetHit: daily.targetHit, conservativeMode: false,
        killSwitchActive: settings.kill_switch_active,
        webSocketHealthy: true, apiHealthy: true, dataFresh: true,
        fundingRate: funding?.rate,
        estimatedLiquidationPrice: liq,
        tierMaxLeverage: tierResult.policy.maxLeverage,
        tierMinRiskRewardRatio: tierResult.policy.minRiskRewardRatio,
        tierMaxRiskPerTradePercent: tierResult.policy.maxRiskPerTradePercent,
        exchangeMaxLeverage: info?.maxLeverage,
        exchangeMinOrderSize: info?.minOrderSize,
        exchangeStepSize: info?.stepSize,
        exchangeTickSize: info?.tickSize,
        marginMode: "isolated",
        // Faz 20 — risk settings config overrides.
        // Aggressive paper mode aktifse kendi maxOpenPositions limitini kullan.
        riskConfigMaxOpenPositions: aggMode.active ? aggMode.maxOpenPositions : riskCfg.defaultMaxOpenPositions,
        riskConfigDailyMaxLossPercent: riskCfg.dailyMaxLossPercent,
        riskConfigRiskPerTradePercent: riskCfg.riskPerTradePercent,
        riskConfigTotalCapitalUsdt: effectiveCapitalUsdt,
        riskConfigCapitalSource: riskCapitalSource,
      });

      detail.riskAllowed = risk.allowed;
      detail.riskRejectReason = risk.allowed ? null : (risk.reason ?? null);

      if (!risk.allowed) {
        // P0 bugfix: R:R yetersizliği ile gerçek risk reddi ayrı etiketleniyor.
        const isRrOnly = risk.rejectKind === "rr_insufficient";
        const riskReason = isRrOnly
          ? `R:R YETERSİZ: ${risk.reason}`
          : `RİSK REDDİ: ${risk.reason}`;
        detail.rejectReason = riskReason;
        result.rejectedSignals.push({ symbol, reason: riskReason });
        await botLog({
          userId, exchange, eventType: isRrOnly ? "rr_insufficient" : "risk_blocked",
          message: `${symbol} ${sig.signalType} ${isRrOnly ? "R:R yetersiz" : "risk engine reddetti"}: ${risk.reason}`,
          metadata: { violations: risk.ruleViolations, rejectKind: risk.rejectKind },
        });
        result.scanDetails.push(detail);
        continue;
      }

      // Faz 20: compute position notional and stop distance for metadata.
      const stopDistPct = sig.entryPrice > 0
        ? (Math.abs(sig.entryPrice - sig.stopLoss) / sig.entryPrice) * 100
        : 0;
      const positionNotionalUsdt = sig.entryPrice > 0 ? risk.positionSize * sig.entryPrice : 0;

      const aggressiveEntryPrefix = aggMode.active
        ? "AGGRESSIVE PAPER TEST: normal filtreler geçilemedi ancak minimum paper test koşulları sağlandı. "
        : "";
      const trade = await openPaperTrade({
        userId, exchange, symbol, direction: sig.signalType,
        entryPrice: sig.entryPrice, stopLoss: sig.stopLoss, takeProfit: sig.takeProfit,
        leverage: risk.leverage, positionSize: risk.positionSize, marginUsed: risk.marginUsed,
        riskAmount: risk.riskAmount, riskRewardRatio: risk.riskRewardRatio,
        marginMode: "isolated", estimatedLiquidationPrice: risk.estimatedLiquidationPrice ?? null,
        signalScore: sig.score,
        entryReason: `${aggressiveEntryPrefix}${sig.reasons.join(" • ")}`,
        tier: tierResult.effectiveTier,
        spreadPercent: ticker.spread * 100,
        atrPercent: detail.atrPercent,
        fundingRate: funding?.rate ?? undefined,
        signalConfidence: sig.score,
        riskPercent: riskCfg.riskPerTradePercent,
        riskMetadata: {
          risk_amount_usdt: risk.riskAmount,
          risk_per_trade_percent: riskCfg.riskPerTradePercent,
          position_notional_usdt: positionNotionalUsdt,
          stop_distance_percent: stopDistPct,
          risk_config_source: riskCapitalSource,
          risk_config_bound: true,
        },
      });

      detail.opened = true;
      detail.aggressivePaperOpened = aggMode.active;
      result.openedPaperTrades.push({
        symbol, direction: sig.signalType, entryPrice: sig.entryPrice,
      });
      const tradeOpenEvent = aggMode.active ? "aggressive_paper_trade_opened" : "paper_trade_opened";
      await botLog({
        userId, exchange, eventType: tradeOpenEvent,
        message: `${aggMode.active ? "[AGGRESSIVE PAPER]" : ""} ${sig.signalType} ${symbol} @ ${sig.entryPrice} lev=${risk.leverage}x skor=${sig.score}`,
        metadata: { tradeId: trade?.id, aggressivePaper: aggMode.active, minSignalScore: aggMode.minSignalScore },
      });
      result.scanDetails.push(detail);
      openCount++;
      if (openCount >= loopMaxOpenPositions) break;
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      detail.rejectReason = `Hata: ${msg}`;
      result.errors.push({ symbol, error: msg });
      result.scanDetails.push(detail);
      await botLog({ userId, exchange, level: "error", eventType: "tick_error", message: `${symbol}: ${msg}` });
    }
  }

  result.ok = true;
  result.deeplyAnalyzedSymbols = symbolsToAnalyze.length;
  // Phase 7 — analysis-batch composition counters. Computed from
  // symbolsToAnalyze (post pre-filter) so the displayed total matches
  // what was actually deeply analyzed this tick.
  {
    let coreCount = 0;
    let unifiedCount = 0;
    for (const sym of symbolsToAnalyze) {
      if (coreSet.has(sym)) coreCount++;
      else if (unifiedSymbolSet.has(sym)) unifiedCount++;
    }
    result.coreSymbolsCount = coreCount;
    result.unifiedSymbolsCount = unifiedCount;
    result.analyzedSymbolsCount = symbolsToAnalyze.length;
  }

  // ── Final opportunity filter for the scanner table ──
  // Strict three-gate filter: marketQualityScore >= 75, setupScore >= 70, AND at least one
  // of (signalScore >= 50 / near-miss / explicit direction / strong-setup). Dynamic-only;
  // CORE rows always pass. The broader "opportunityPool" is built before this prune so
  // high-setup dynamics that didn't clear the strict gate still feed the top-5 card.
  //
  // allAnalyzedScanDetails retains ALL analyzed rows with displayFilterPassed annotations
  // so the scanner frontend can show every analyzed coin (not just the kept set).
  // Trade/signal/risk logic is never affected — scanDetails backward-compat kept list unchanged.
  const rawScanDetails = result.scanDetails;
  const dynamicAnalyzed = rawScanDetails.filter((d) => d.coinClass === "DYNAMIC").length;
  const opportunityPool = buildOpportunityPool(rawScanDetails);
  const filterRes = filterScanDetailsForDisplay(rawScanDetails); // annotates in-place
  result.allAnalyzedScanDetails = rawScanDetails.slice(0, 120); // all analyzed with annotations
  result.scanDetails = filterRes.kept; // backward compat — trade/dashboard consumers unchanged
  result.opportunityPool = opportunityPool;
  result.dynamicEliminatedLowSignal = filterRes.eliminated;
  result.dynamicEliminatedQuality = filterRes.eliminatedQuality;
  result.dynamicEliminatedSetup = filterRes.eliminatedSetup;
  result.dynamicEliminatedSignal = filterRes.eliminatedSignal;
  result.dynamicBtcTrendRejected = filterRes.btcTrendRejected;
  result.dynamicOpportunityCandidates = dynamicAnalyzed - filterRes.eliminated;

  result.durationMs = Date.now() - start;

  // Persist last tick summary for diagnostics endpoint.
  // Only the lock owner writes this — non-owner workers must not overwrite
  // the canonical summary produced by the active worker.
  const wCtx = opts?.workerContext;
  const generatedAt = new Date().toISOString();
  const lastTickSummary = {
    at: generatedAt,
    generated_at: generatedAt,
    tickSkipped: false,
    skipReason: null,
    tickError: null,
    workerLockOwner: wCtx?.isLockOwner ?? true,
    worker_id:    wCtx?.workerId    ?? null,
    tickStartedAt,
    tickCompletedAt: generatedAt,
    container_id: wCtx?.containerId ?? null,
    git_commit:   wCtx?.gitCommit   ?? null,
    process_pid:  wCtx?.processPid  ?? null,
    universe: universeTotal,
    prefiltered: universePrefiltered,
    scanned: symbolsToAnalyze.length,
    lowVolumePrefilterRejected: lowVolumeSkipped,
    dynamicCandidates: dynamicResult?.candidates.length ?? 0,    // pre-filter pool size (legacy field)
    dynamicOpportunityCandidates: result.dynamicOpportunityCandidates ?? 0,  // in-table count — strict scanner gate survivors
    dynamicEliminatedLowSignal: result.dynamicEliminatedLowSignal ?? 0,
    dynamicEliminatedQuality: result.dynamicEliminatedQuality ?? 0,
    dynamicEliminatedSetup: result.dynamicEliminatedSetup ?? 0,
    dynamicEliminatedSignal: result.dynamicEliminatedSignal ?? 0,
    dynamicBtcTrendRejected: result.dynamicBtcTrendRejected ?? 0,
    dynamicRejectedLowVolume: dynamicResult?.rejectedLowVolume ?? 0,
    dynamicRejectedStablecoin: dynamicResult?.rejectedStablecoin ?? 0,
    dynamicRejectedHighSpread: dynamicResult?.rejectedHighSpread ?? 0,
    dynamicRejectedPumpDump: dynamicResult?.rejectedPumpDump ?? 0,
    dynamicRejectedWeakMomentum: dynamicResult?.rejectedWeakMomentum ?? 0,
    dynamicRejectedNoData: dynamicResult?.rejectedNoData ?? 0,
    dynamicRejectedInsufficientDepth: result.dynamicRejectedInsufficientDepth ?? 0,
    signals: result.generatedSignals.length,
    opened: result.openedPaperTrades.length,
    rejected: result.rejectedSignals.length,
    nearMiss: result.nearMissSignals.length,
    errors: result.errors.length,
    durationMs: result.durationMs,
    scanDetails: result.scanDetails.slice(0, 50), // cap at 50 — backward compat
    allAnalyzedScanDetails: (result.allAnalyzedScanDetails ?? []).slice(0, 120), // all analyzed with displayFilter annotations
    opportunityPool: (result.opportunityPool ?? []).slice(0, 30),
    // Phase 6 / 7 unified pool diagnostics
    unifiedCandidatePoolActive: result.unifiedCandidatePoolActive ?? false,
    unifiedPoolSize: result.unifiedPoolSize ?? 0,
    unifiedDeepCandidatesCount: result.unifiedDeepCandidatesCount ?? 0,
    unifiedPoolGeneratedAt: result.unifiedPoolGeneratedAt ?? null,
    unifiedPoolFromCache: result.unifiedPoolFromCache ?? false,
    unifiedProviderError: result.unifiedProviderError ?? null,
    analyzedSymbolsCount: result.analyzedSymbolsCount ?? symbolsToAnalyze.length,
    coreSymbolsCount: result.coreSymbolsCount ?? 0,
    unifiedSymbolsCount: result.unifiedSymbolsCount ?? 0,
    // Phase 14 — mode-safe diagnostics
    unifiedCandidatePoolModeAllowed: result.unifiedCandidatePoolModeAllowed ?? true,
    unifiedCandidatePoolBlockedReason: result.unifiedCandidatePoolBlockedReason ?? null,
    tradeMode: result.tradeMode ?? poolModeCheck.tradeMode,
    executionMode: result.executionMode ?? poolModeCheck.executionMode,
    lastOpenedTrade: result.openedPaperTrades[0] ?? null,
    topRejectReasons: result.rejectedSignals.slice(0, 10).map((r) => `${r.symbol}: ${r.reason}`),
    topNearMiss: result.nearMissSignals.slice(0, 5).map((n) => `${n.direction} ${n.symbol} skor=${n.score}`),
  };
  if (wCtx?.isLockOwner !== false) {
    await sb.from("bot_settings").update({
      last_tick_at: lastTickSummary.at,
      last_tick_summary: lastTickSummary,
    }).eq("user_id", userId);
  }

  await botLog({
    userId, exchange, eventType: "tick_completed",
    message: `Tick tamamlandı — universe=${universeTotal} prefilter=${universePrefiltered} dynamic=${dynamicResult?.candidates.length ?? 0} lowVolSkip=${lowVolumeSkipped} tarandı=${symbolsToAnalyze.length} sinyal=${result.generatedSignals.length} açıldı=${result.openedPaperTrades.length} red=${result.rejectedSignals.length} hata=${result.errors.length} cursor=${nextCursor} (${result.durationMs}ms)`,
    metadata: summary(result),
  });

  return result;
}

function summary(r: TickResult) {
  return {
    universe: r.totalUniverseSymbols,
    prefiltered: r.prefilteredSymbols,
    scanned: r.scannedSymbols.length,
    generated: r.generatedSignals.length,
    opened: r.openedPaperTrades.length,
    rejected: r.rejectedSignals.length,
    errors: r.errors.length,
    nextCursor: r.nextCursor,
    durationMs: r.durationMs,
  };
}
