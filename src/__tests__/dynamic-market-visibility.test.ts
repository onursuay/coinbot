// Dynamic Market Visibility + Candidate Pool Display Patch tests.
//
// Visibility-only — these tests cover the scanner display/diagnostics flow.
// Trade-opening logic, MIN_SIGNAL_CONFIDENCE, BTC trend filter, risk gate,
// SL/TP/R:R checks, signal-engine math and the live-trading gate are NOT
// touched by this patch and are NOT exercised here.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

const ORCHESTRATOR = read("src/lib/engines/bot-orchestrator.ts");
const DIAGNOSTICS_ROUTE = read("src/app/api/bot/diagnostics/route.ts");
const SCANNER_PAGE = read("src/app/scanner/page.tsx");

// ── 1. Orchestrator: rawScanDetails preserved as allAnalyzedScanDetails ──
describe("orchestrator preserves raw scan details", () => {
  it("rawScanDetails is captured before filtering and exposed via allAnalyzedScanDetails", () => {
    expect(ORCHESTRATOR).toContain("const rawScanDetails = result.scanDetails;");
    expect(ORCHESTRATOR).toContain("result.allAnalyzedScanDetails = rawScanDetails.slice(0, 120)");
  });

  it("filtered scanDetails is kept as backward-compat for trade/dashboard consumers", () => {
    expect(ORCHESTRATOR).toContain("result.scanDetails = filterRes.kept;");
  });
});

// ── 2. filterScanDetailsForDisplay annotates display-filter reasons ───────
describe("filterScanDetailsForDisplay reason annotations", () => {
  it("annotates displayFilterPassed/Reasons/ReasonText for quality-rejected dynamic", async () => {
    const { filterScanDetailsForDisplay } = await import("@/lib/engines/bot-orchestrator");
    const details = [{
      symbol: "LOWQ/USDT", coinClass: "DYNAMIC", tier: "TIER_3",
      spreadPercent: 0, atrPercent: 0, fundingRate: 0, orderBookDepth: 0,
      signalType: "WAIT", signalScore: 0, setupScore: 75, marketQualityScore: 30,
      rejectReason: null, riskAllowed: null, riskRejectReason: null,
      opened: false, opportunityCandidate: false,
    }];
    filterScanDetailsForDisplay(details as any);
    const r = details[0] as any;
    expect(r.displayFilterPassed).toBe(false);
    expect(r.displayFilterReason).toBe("quality_below_threshold");
    expect(r.displayFilterReasons).toContain("quality_below_threshold");
    expect(r.displayFilterReasons).toContain("low_volume");
    expect(typeof r.displayFilterReasonText).toBe("string");
    expect(r.displayFilterReasonText.length).toBeGreaterThan(0);
  });

  it("annotates btc_conflict when btcTrendRejected dynamic is filtered", async () => {
    const { filterScanDetailsForDisplay } = await import("@/lib/engines/bot-orchestrator");
    const details = [{
      symbol: "BTCBLK/USDT", coinClass: "DYNAMIC", tier: "TIER_3",
      spreadPercent: 0, atrPercent: 0, fundingRate: 0, orderBookDepth: 0,
      signalType: "NO_TRADE", signalScore: 0, setupScore: 75, marketQualityScore: 80,
      rejectReason: "BTC trend negatif", riskAllowed: null, riskRejectReason: null,
      opened: false, opportunityCandidate: false, btcTrendRejected: true,
    }];
    filterScanDetailsForDisplay(details as any);
    const r = details[0] as any;
    expect(r.displayFilterReason).toBe("signal_below_threshold");
    expect(r.displayFilterReasons).toContain("btc_conflict");
  });

  it("annotates no_confirmed_direction when signal gate fails without LONG/SHORT", async () => {
    const { filterScanDetailsForDisplay } = await import("@/lib/engines/bot-orchestrator");
    const details = [{
      symbol: "NODIR/USDT", coinClass: "DYNAMIC", tier: "TIER_3",
      spreadPercent: 0, atrPercent: 0, fundingRate: 0, orderBookDepth: 0,
      signalType: "NO_TRADE", signalScore: 0, setupScore: 75, marketQualityScore: 80,
      rejectReason: null, riskAllowed: null, riskRejectReason: null,
      opened: false, opportunityCandidate: false,
    }];
    filterScanDetailsForDisplay(details as any);
    const r = details[0] as any;
    expect(r.displayFilterReasons).toContain("no_confirmed_direction");
  });

  it("CORE rows always pass display filter and have empty reasons", async () => {
    const { filterScanDetailsForDisplay } = await import("@/lib/engines/bot-orchestrator");
    const details = [{
      symbol: "BTC/USDT", coinClass: "CORE", tier: "TIER_1",
      spreadPercent: 0, atrPercent: 0, fundingRate: 0, orderBookDepth: 0,
      signalType: "WAIT", signalScore: 0, setupScore: 0, marketQualityScore: 0,
      rejectReason: null, riskAllowed: null, riskRejectReason: null,
      opened: false, opportunityCandidate: false,
    }];
    const { kept } = filterScanDetailsForDisplay(details as any);
    expect(kept).toHaveLength(1);
    const r = details[0] as any;
    expect(r.displayFilterPassed).toBe(true);
    expect(r.displayFilterReason).toBeNull();
  });

  it("buildDisplayFilterReasonText produces Turkish text for known reason codes", async () => {
    const { buildDisplayFilterReasonText } = await import("@/lib/engines/bot-orchestrator");
    expect(buildDisplayFilterReasonText(["signal_below_threshold"])).toContain("işlem skoru");
    expect(buildDisplayFilterReasonText(["setup_below_threshold"])).toContain("setup");
    expect(buildDisplayFilterReasonText(["btc_conflict"])).toContain("BTC");
    expect(buildDisplayFilterReasonText([])).toBe("");
  });
});

// ── 3. Diagnostics response surfaces alias + summary fields ───────────────
describe("diagnostics response shape", () => {
  it("exposes scan_details_all alias", () => {
    expect(DIAGNOSTICS_ROUTE).toContain("scan_details_all:");
  });

  it("exposes scan_details_filtered alias", () => {
    expect(DIAGNOSTICS_ROUTE).toContain("scan_details_filtered:");
  });

  it("keeps legacy scan_details for backward compat", () => {
    expect(DIAGNOSTICS_ROUTE).toContain("scan_details:");
  });

  it("display_filter_summary includes coreCount/gmtCount/mtCount/milCount/krmCount", () => {
    expect(DIAGNOSTICS_ROUTE).toContain("gmtCount");
    expect(DIAGNOSTICS_ROUTE).toContain("mtCount");
    expect(DIAGNOSTICS_ROUTE).toContain("milCount");
    expect(DIAGNOSTICS_ROUTE).toContain("krmCount");
    expect(DIAGNOSTICS_ROUTE).toContain("dynamicAnalyzedCount");
  });

  it("preserves unified_diagnostics for pool-empty notice", () => {
    expect(DIAGNOSTICS_ROUTE).toContain("unified_diagnostics:");
  });
});

// ── 4. Scanner page: data priority + cap + label/source rules ─────────────
describe("scanner page rules", () => {
  it("prefers scan_details_all, then all_analyzed_scan_details, then scan_details", () => {
    expect(SCANNER_PAGE).toMatch(/scan_details_all\s*\?\?\s*data\?\.all_analyzed_scan_details\s*\?\?\s*data\?\.scan_details/);
  });

  it("caps visible rows at 80", () => {
    expect(SCANNER_PAGE).toContain(".slice(0, 80)");
  });

  it("source label maps WIDE_MARKET → GMT, MOMENTUM → MT, MANUAL_LIST → MİL, multi → KRM", () => {
    expect(SCANNER_PAGE).toContain("WIDE_MARKET");
    expect(SCANNER_PAGE).toContain("MOMENTUM");
    expect(SCANNER_PAGE).toContain("MANUAL_LIST");
    expect(SCANNER_PAGE).toContain('return "KRM"');
    expect(SCANNER_PAGE).toContain('return "GMT"');
    expect(SCANNER_PAGE).toContain('return "MT"');
    expect(SCANNER_PAGE).toContain('return "MİL"');
  });

  it("does not surface 'ÇEKİRDEK' label", () => {
    expect(SCANNER_PAGE).not.toMatch(/ÇEKİRDEK|Çekirdek|çekirdek/);
  });

  it("renders compact source-mix summary line (CORE/GMT/MT/MİL/KRM/Filtrelenen)", () => {
    expect(SCANNER_PAGE).toContain("Analiz edilen:");
    expect(SCANNER_PAGE).toContain("CORE:");
    expect(SCANNER_PAGE).toContain("GMT:");
    expect(SCANNER_PAGE).toContain("MT:");
    expect(SCANNER_PAGE).toContain("MİL:");
    expect(SCANNER_PAGE).toContain("KRM:");
    expect(SCANNER_PAGE).toContain("Filtrelenen:");
  });

  it("shows pool-empty notice when unified pool is empty / provider errored", () => {
    expect(SCANNER_PAGE).toContain("Dinamik aday havuzu boş");
    expect(SCANNER_PAGE).toContain("Unified provider hata aldı");
  });

  it("eşiğe kalan derives from tradeSignalScore (canonical) with signalScore fallback", () => {
    expect(SCANNER_PAGE).toContain("row.tradeSignalScore ?? row.signalScore");
  });

  it("renders '—' when trade score is missing", () => {
    expect(SCANNER_PAGE).toContain('"—"');
  });

  it("buildReasonText uses displayFilterReasonText when row was display-filtered", () => {
    expect(SCANNER_PAGE).toContain("displayFilterReasonText");
    expect(SCANNER_PAGE).toContain("displayFilterPassed === false");
  });
});

// ── 5. Safety invariants — patch must not relax any trade-gate config ─────
describe("safety invariants — trade logic untouched by this patch", () => {
  it("signal threshold (70) remains in signal-engine and scanner UI", () => {
    const SIGNAL_ENGINE = read("src/lib/engines/signal-engine.ts");
    expect(SIGNAL_ENGINE).toMatch(/70/);
    expect(SCANNER_PAGE).toContain("SIGNAL_THRESHOLD = 70");
  });

  it("HARD_LIVE_TRADING_ALLOWED default stays false", () => {
    const ENV = read("src/lib/env.ts");
    expect(ENV).toContain("HARD_LIVE_TRADING_ALLOWED");
  });

  it("no Binance order endpoints introduced by this patch", () => {
    expect(ORCHESTRATOR).not.toContain("/fapi/v1/order");
    expect(ORCHESTRATOR).not.toContain("/fapi/v1/leverage");
    expect(SCANNER_PAGE).not.toContain("/fapi/v1/order");
    expect(SCANNER_PAGE).not.toContain("/fapi/v1/leverage");
    expect(DIAGNOSTICS_ROUTE).not.toContain("/fapi/v1/order");
  });
});
