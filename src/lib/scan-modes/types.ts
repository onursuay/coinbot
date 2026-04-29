// Phase 1 — Tarama Modları (scan modes) data model.
// SCOPE: scaffold only. This module defines types/defaults/helpers for the
// 3-mode coin selection architecture (Geniş Market Taraması, Momentum
// Taraması, Manuel İzleme Listesi). It does NOT change scanner behavior,
// signal scoring, risk engine, worker tick or live trading gates.
// See docs/BINANCE_API_GUARDRAILS.md — no new Binance traffic is introduced.

/**
 * Coin source — where a coin entered the scan universe from.
 * - WIDE_MARKET : Geniş Market Taraması (broad market, top-volume sweep)
 * - MOMENTUM    : Momentum Taraması (gainers + losers, both directions)
 * - MANUAL_LIST : Manuel İzleme Listesi (user-curated symbols)
 * - MIXED       : aggregate of >1 source (resolved at display time)
 */
export type CoinSource = "WIDE_MARKET" | "MOMENTUM" | "MANUAL_LIST" | "MIXED";

/** Short UI label per source — shown in scanner/table cells. */
export const COIN_SOURCE_LABEL: Record<CoinSource, string> = {
  WIDE_MARKET: "GMT",
  MOMENTUM: "MT",
  MANUAL_LIST: "MİL",
  MIXED: "KRM",
};

/** Long Turkish name per source — shown in tooltips and the modes page. */
export const COIN_SOURCE_NAME: Record<CoinSource, string> = {
  WIDE_MARKET: "Geniş Market Taraması",
  MOMENTUM: "Momentum Taraması",
  MANUAL_LIST: "Manuel İzleme Listesi",
  MIXED: "Karma Kaynak",
};

/**
 * Single source — the three real (non-aggregate) sources. MIXED is derived,
 * never stored as a coin's primary source on its own.
 */
export type SingleCoinSource = Exclude<CoinSource, "MIXED">;

/**
 * Scan modes configuration — all three modes live here. There is no extra
 * "gainers/losers/both" knob: when Momentum Taraması is active it logically
 * covers both directions. The UI exposes only Aktif/Pasif.
 */
export interface ScanModesConfig {
  wideMarket: {
    active: boolean;
  };
  momentum: {
    active: boolean;
    // Forward-compatible. Currently always "both"; UI does not expose this.
    direction: "both";
  };
  manualList: {
    active: boolean;
    // Selected coin canonical symbols (e.g. "BTC/USDT"). When manualList is
    // toggled inactive, this list is preserved — only the inclusion in the
    // scan universe is suspended.
    symbols: string[];
  };
}

/** Default config — Geniş + Momentum aktif, Manuel pasif. */
export const DEFAULT_SCAN_MODES_CONFIG: ScanModesConfig = {
  wideMarket: { active: true },
  momentum: { active: true, direction: "both" },
  manualList: { active: false, symbols: [] },
};
