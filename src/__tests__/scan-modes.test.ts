// Phase 1 — Tarama Modları skeleton tests.
// Verifies the new scan modes data model + invariants and asserts that
// trade-threshold and live-trading-gate values were NOT changed.

import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_SCAN_MODES_CONFIG,
  COIN_SOURCE_LABEL,
  COIN_SOURCE_NAME,
  type ScanModesConfig,
} from "@/lib/scan-modes/types";
import {
  resolveDisplayedCoinSource,
  resolveDisplayedSourceLabel,
  getCoinSourceName,
} from "@/lib/scan-modes/sources";
import {
  getScanModesConfig,
  updateScanModesConfig,
  addManualSymbol,
  removeManualSymbol,
  __resetScanModesStoreForTests,
} from "@/lib/scan-modes/store";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

describe("ScanModesConfig data model", () => {
  it("includes the three modes with documented defaults", () => {
    expect(DEFAULT_SCAN_MODES_CONFIG.wideMarket.active).toBe(true);
    expect(DEFAULT_SCAN_MODES_CONFIG.momentum.active).toBe(true);
    expect(DEFAULT_SCAN_MODES_CONFIG.manualList.active).toBe(false);
    expect(DEFAULT_SCAN_MODES_CONFIG.manualList.symbols).toEqual([]);
  });

  it("momentum mode exposes only an Aktif/Pasif boolean (direction is internal-only)", () => {
    const cfg: ScanModesConfig = DEFAULT_SCAN_MODES_CONFIG;
    // Internally direction is fixed to "both" — UI never exposes a knob.
    expect(cfg.momentum.direction).toBe("both");
    // Only `active` is the user-facing toggle.
    expect(typeof cfg.momentum.active).toBe("boolean");
  });

  it("exposes both short labels and full Turkish names for every source", () => {
    expect(COIN_SOURCE_LABEL.WIDE_MARKET).toBe("GMT");
    expect(COIN_SOURCE_LABEL.MOMENTUM).toBe("MT");
    expect(COIN_SOURCE_LABEL.MANUAL_LIST).toBe("MİL");
    expect(COIN_SOURCE_LABEL.MIXED).toBe("KRM");
    expect(COIN_SOURCE_NAME.WIDE_MARKET).toBe("Geniş Market Taraması");
    expect(COIN_SOURCE_NAME.MOMENTUM).toBe("Momentum Taraması");
    expect(COIN_SOURCE_NAME.MANUAL_LIST).toBe("Manuel İzleme Listesi");
  });
});

describe("CoinSource resolution (single vs. mixed)", () => {
  it("returns the single source when only one is present", () => {
    expect(resolveDisplayedCoinSource(["WIDE_MARKET"])).toBe("WIDE_MARKET");
    expect(resolveDisplayedCoinSource(["MOMENTUM"])).toBe("MOMENTUM");
    expect(resolveDisplayedCoinSource(["MANUAL_LIST"])).toBe("MANUAL_LIST");
  });

  it("collapses multiple sources to MIXED (KRM in UI)", () => {
    expect(resolveDisplayedCoinSource(["WIDE_MARKET", "MOMENTUM"])).toBe("MIXED");
    expect(resolveDisplayedCoinSource(["MOMENTUM", "MANUAL_LIST"])).toBe("MIXED");
    expect(resolveDisplayedCoinSource(["WIDE_MARKET", "MOMENTUM", "MANUAL_LIST"])).toBe("MIXED");
    expect(resolveDisplayedSourceLabel(["WIDE_MARKET", "MOMENTUM"])).toBe("KRM");
  });

  it("dedupes input — repeated single source is still a single source", () => {
    expect(resolveDisplayedCoinSource(["MOMENTUM", "MOMENTUM"])).toBe("MOMENTUM");
  });

  it("returns null when no sources attached", () => {
    expect(resolveDisplayedCoinSource([])).toBeNull();
    expect(resolveDisplayedSourceLabel([])).toBeNull();
  });

  it("getCoinSourceName returns the full Turkish name", () => {
    expect(getCoinSourceName("MIXED")).toBe("Karma Kaynak");
  });
});

describe("ScanModes store — toggle and manual list semantics", () => {
  beforeEach(() => {
    __resetScanModesStoreForTests();
  });

  it("starts at defaults", () => {
    const cfg = getScanModesConfig();
    expect(cfg).toEqual(DEFAULT_SCAN_MODES_CONFIG);
  });

  it("returns a deep-cloned config (caller cannot mutate internal state)", () => {
    const a = getScanModesConfig();
    a.manualList.symbols.push("HACK/USDT");
    const b = getScanModesConfig();
    expect(b.manualList.symbols).toEqual([]);
  });

  it("toggling each mode independently updates only that flag", () => {
    let cfg = updateScanModesConfig({ wideMarket: { active: false } });
    expect(cfg.wideMarket.active).toBe(false);
    expect(cfg.momentum.active).toBe(true);
    expect(cfg.manualList.active).toBe(false);

    cfg = updateScanModesConfig({ manualList: { active: true } });
    expect(cfg.manualList.active).toBe(true);
    expect(cfg.wideMarket.active).toBe(false);
  });

  it("deactivating manualList does NOT clear the curated symbol list", () => {
    addManualSymbol("BTC/USDT");
    addManualSymbol("ETH/USDT");
    let cfg = updateScanModesConfig({ manualList: { active: true } });
    expect(cfg.manualList.symbols).toEqual(["BTC/USDT", "ETH/USDT"]);

    cfg = updateScanModesConfig({ manualList: { active: false } });
    expect(cfg.manualList.active).toBe(false);
    expect(cfg.manualList.symbols).toEqual(["BTC/USDT", "ETH/USDT"]);
  });

  it("addManualSymbol is idempotent and canonicalizes input", () => {
    addManualSymbol("btcusdt");
    addManualSymbol("BTC/USDT");
    addManualSymbol("BTCUSDT");
    const cfg = getScanModesConfig();
    expect(cfg.manualList.symbols).toEqual(["BTC/USDT"]);
  });

  it("removeManualSymbol removes only the targeted symbol", () => {
    addManualSymbol("BTC/USDT");
    addManualSymbol("ETH/USDT");
    removeManualSymbol("BTC/USDT");
    expect(getScanModesConfig().manualList.symbols).toEqual(["ETH/USDT"]);
  });
});

describe("Phase 1 invariants — values that must NOT change", () => {
  it("signal-engine still rejects trades below 70 (MIN_SIGNAL_CONFIDENCE)", () => {
    const src = read("src/lib/engines/signal-engine.ts");
    // Default threshold is still 70 when no aggressiveMinScore is provided.
    expect(src).toMatch(/aggressiveMinScore\s*\?\?\s*70/);
    // Rejection message references the dynamic minScore variable.
    expect(src).toMatch(/Sinyal skoru düşük.*minScore/);
  });

  it("env defaults still keep live trading off and paper as default mode", () => {
    const src = read("src/lib/env.ts");
    // hardLiveTradingAllowed default = false
    expect(src).toMatch(/hardLiveTradingAllowed:\s*bool\(process\.env\.HARD_LIVE_TRADING_ALLOWED,\s*false\)/);
    // defaultTradingMode default = "paper"
    expect(src).toMatch(/defaultTradingMode:\s*str\(process\.env\.DEFAULT_TRADING_MODE,\s*"paper"\)/);
  });

  it("settings/update endpoint still does NOT accept enable_live_trading from clients", () => {
    const src = read("src/app/api/settings/update/route.ts");
    expect(src).not.toMatch(/enable_live_trading/);
  });
});
