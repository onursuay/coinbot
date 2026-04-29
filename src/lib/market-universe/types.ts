// Phase 2 — Geniş Market Taraması Katmanlı Altyapı: types and config.
//
// SCOPE: scaffold only. This module defines the shape and configuration for
// the layered scan pipeline (universe → lightweight screen → candidate pool
// → deep-analysis selection). It does NOT change worker tick behavior,
// signal scoring, risk engine or live trading gates. See
// docs/BINANCE_API_GUARDRAILS.md — no new Binance traffic is introduced
// from this layer; it consumes already-fetched ticker data.

import type { SingleCoinSource } from "@/lib/scan-modes/types";

/**
 * A symbol entry that survived the universe filter.
 * Mirrors a tradable USDT-margined perpetual that is currently in TRADING
 * status on the exchange.
 */
export interface MarketSymbolInfo {
  symbol: string;          // canonical "BTC/USDT"
  baseAsset: string;
  quoteAsset: "USDT";
  contractType: "perpetual";
  status: "TRADING";
  // Forward-compatible — adapters may populate more later (tickSize, etc).
}

/**
 * Output of the lightweight screener — one row per surviving symbol.
 * No deep indicators here; this is intentionally cheap and computed only
 * from already-cached bulk-ticker data.
 */
export interface LightweightCandidate {
  symbol: string;
  priceChangePercent: number;   // 24h, signed
  quoteVolume: number;          // 24h, USDT
  lastPrice: number;
  bidPrice: number | null;      // null if bulk endpoint didn't carry it
  askPrice: number | null;      // null if bulk endpoint didn't carry it
  spreadPercent: number | null; // (ask-bid)/mid * 100, null if bid/ask missing
  active: boolean;              // i.e. symbol is in TRADING status & in universe
  sourceCandidates: SingleCoinSource[]; // which scan modes proposed this row
  marketQualityPreScore: number;        // 0-100, higher = better candidate
}

/**
 * Candidate-pool entry — a coin that may have been proposed by multiple
 * scan modes. Sources are kept as a list; the displayed source label is
 * resolved at render time (see lib/scan-modes/sources.ts → MIXED → "KRM").
 */
export interface CandidatePoolEntry {
  symbol: string;
  sources: SingleCoinSource[];
  // Snapshot of the most informative lightweight candidate (highest preScore
  // wins on collision). Future phases may aggregate further.
  candidate: LightweightCandidate;
}

/**
 * Deep-analysis candidate — a strict subset of the pool, ordered for
 * downstream signal-engine evaluation. Phase 2 does NOT call signal-engine;
 * this list is the boundary handoff prepared for a later phase.
 */
export interface DeepAnalysisCandidate extends CandidatePoolEntry {
  rank: number; // 1-based position in the deep list
}

/**
 * Lightweight pre-screen thresholds. Defaults are conservative — the goal
 * in Phase 2 is the architecture, not aggressive filtering.
 */
export interface LightweightScreenerConfig {
  /** Minimum 24h quote (USDT) volume — below this the coin is not liquid enough. */
  minQuoteVolumeUsd: number;
  /** Maximum allowed spread (%) when bid/ask is available. */
  maxSpreadPercent: number;
  /** Minimum |24h price change %| — coin needs *some* movement to be interesting. */
  minAbsPriceChangePercent: number;
  /** Reject when bid or ask are present but non-positive. Default true. */
  rejectInvalidBidAsk: boolean;
}

/**
 * Full Geniş Market Taraması config — TTLs, pool/list caps, and screener
 * thresholds. Centralised here so no magic numbers live in scattered places.
 */
export interface MarketUniverseConfig {
  /** Universe (exchangeInfo) refresh TTL — default 6h. */
  universeTtlMs: number;
  /** Lightweight scan cadence — default 2 minutes. NOT auto-invoked here;
   *  consumed by future phases that wire this into the worker tick. */
  lightweightScanIntervalMs: number;
  /** Maximum coins kept in the unified candidate pool. */
  candidatePoolMax: number;
  /** Maximum coins handed to deep analysis per cycle. */
  deepAnalysisMax: number;
  /** Lightweight screener thresholds. */
  screener: LightweightScreenerConfig;
}

/** Sensible default config — meant to be edited via a future settings UI. */
export const DEFAULT_MARKET_UNIVERSE_CONFIG: MarketUniverseConfig = {
  universeTtlMs: 6 * 60 * 60 * 1000, // 6 hours
  lightweightScanIntervalMs: 2 * 60 * 1000, // 2 minutes
  candidatePoolMax: 50,
  deepAnalysisMax: 30,
  screener: {
    minQuoteVolumeUsd: 1_000_000, // $1M/24h floor — conservative; below this is illiquid
    maxSpreadPercent: 0.30,        // 0.30% — only applied when bid/ask available
    minAbsPriceChangePercent: 0.5, // 0.5% — coin must show *some* daily movement
    rejectInvalidBidAsk: true,
  },
};
