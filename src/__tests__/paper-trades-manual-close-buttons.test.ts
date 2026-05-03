// Regression suite for the stateful "KAPAT / İZLENİYOR / SÜRE AŞIMI" close
// button on /paper-trades and the matching server-side guards.
//
// Behavior locked by these tests:
//   • UI button text is age-driven: <12h → KAPAT, 12-24h → İZLENİYOR, ≥24h
//     → SÜRE AŞIMI.
//   • Button colour is PnL-driven (profit / loss / break_even bands at
//     ±0.25 USDT). 12-24h is disabled regardless.
//   • Server rejects close requests for the 12-24h bucket with code
//     POSITION_UNDER_OBSERVATION.
//   • Server rejects close requests for net-loss positions without
//     `confirmLossClose: true` with code LOSS_CLOSE_CONFIRMATION_REQUIRED.
//   • Sidebar / dashboard surfaces the renamed "Pozisyonlar" label; technical
//     route, API path and DB table name (paper_trades) are unchanged.
//   • No /fapi/v1/order or /fapi/v1/leverage call introduced.
//   • Live-safety invariants preserved.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

const PAGE_SRC = read("src/app/paper-trades/page.tsx");
const ROUTE_SRC = read("src/app/api/paper-trades/close/route.ts");
const ENGINE_SRC = read("src/lib/engines/paper-trading-engine.ts");
const GET_ROUTE_SRC = read("src/app/api/paper-trades/route.ts");
const SIDEBAR_SRC = read("src/components/Sidebar.tsx");
const DASH_SRC = read("src/app/page.tsx");

describe("paper-trades manual close — age-driven button text", () => {
  it("page maps <12h to KAPAT", () => {
    expect(PAGE_SRC).toMatch(/if \(age === "fresh"\) return "KAPAT"/);
  });
  it("page maps 12-24h to İZLENİYOR", () => {
    expect(PAGE_SRC).toMatch(/if \(age === "monitoring"\) return "İZLENİYOR"/);
  });
  it("page maps 24h+ to SÜRE AŞIMI", () => {
    expect(PAGE_SRC).toMatch(/return "SÜRE AŞIMI"/);
  });
  it("ageBucketFor uses 12h and 24h cutoffs", () => {
    expect(PAGE_SRC).toMatch(/if \(ageH < 12\) return "fresh"/);
    expect(PAGE_SRC).toMatch(/if \(ageH < 24\) return "monitoring"/);
  });
});

describe("paper-trades manual close — PnL-driven button colour", () => {
  it("profit bucket maps to success palette", () => {
    expect(PAGE_SRC).toMatch(/pnl === "profit"\s*\?\s*"bg-success/);
  });
  it("loss bucket maps to danger palette", () => {
    expect(PAGE_SRC).toMatch(/pnl === "loss"\s*\?\s*"bg-danger/);
  });
  it("break_even bucket maps to sky/blue palette", () => {
    expect(PAGE_SRC).toMatch(/pnl === "break_even"\s*\?\s*"bg-sky-500/);
  });
  it("break-even thresholds are ±0.25 USDT", () => {
    expect(PAGE_SRC).toMatch(/PROFIT_THRESHOLD\s*=\s*0\.25/);
    expect(PAGE_SRC).toMatch(/LOSS_THRESHOLD\s*=\s*-0\.25/);
  });
});

describe("paper-trades manual close — disabled / clickable rules", () => {
  it("monitoring bucket renders disabled button", () => {
    expect(PAGE_SRC).toMatch(/isMonitoring = age === "monitoring"/);
    expect(PAGE_SRC).toMatch(/disabled =[\s\S]*isMonitoring[\s\S]*priceUnavailable/);
  });
  it("monitoring bucket short-circuits onCloseClick (no auto close)", () => {
    expect(PAGE_SRC).toMatch(/if \(age === "monitoring"\) return;/);
  });
  it("stale bucket clickable — sends close request via sendClose", () => {
    expect(PAGE_SRC).toMatch(/onCloseClick/);
    expect(PAGE_SRC).toMatch(/void sendClose\(t\.id, false\);/);
  });
  it("priceUnavailable forces a neutral disabled tooltip", () => {
    expect(PAGE_SRC).toMatch(/Güncel fiyat yok; güvenli kapatma hesaplanamıyor\./);
  });
});

describe("paper-trades manual close — loss confirmation modal", () => {
  it("loss bucket opens the modal instead of closing immediately", () => {
    expect(PAGE_SRC).toMatch(/if \(pnl === "loss"\) \{[\s\S]*setLossModal/);
  });
  it("modal renders the spec wording verbatim", () => {
    expect(PAGE_SRC).toMatch(/Bu pozisyon zararda\. Kapatırsanız zarar realize edilir\. Devam etmek istiyor musunuz\?/);
  });
  it("modal exposes both the cancel and confirm-loss buttons", () => {
    expect(PAGE_SRC).toMatch(/Vazgeç/);
    expect(PAGE_SRC).toMatch(/Zararı Onayla ve Kapat/);
  });
  it("confirmLossClose is sent in the close POST body", () => {
    expect(PAGE_SRC).toMatch(/confirmLossClose\s*\}/);
    expect(PAGE_SRC).toMatch(/sendClose\(id, true\)/);
  });
  it("page does NOT render a permanent loss/observation banner", () => {
    // The only loss warning surface is the modal. The page must not contain
    // a top-level always-on alert tied to the loss state.
    expect(PAGE_SRC).not.toMatch(/className="alert-warning[^"]*"[^>]*>\s*Zarar/);
    expect(PAGE_SRC).not.toMatch(/Pozisyon izleme.*alert-/);
  });
});

describe("paper-trades close route — server-side guards", () => {
  it("route accepts confirmLossClose flag in the body schema", () => {
    expect(ROUTE_SRC).toMatch(/confirmLossClose:\s*z\.boolean\(\)\.default\(false\)/);
  });
  it("route exposes POSITION_UNDER_OBSERVATION code", () => {
    expect(ROUTE_SRC).toMatch(/"POSITION_UNDER_OBSERVATION"/);
  });
  it("route exposes LOSS_CLOSE_CONFIRMATION_REQUIRED code", () => {
    expect(ROUTE_SRC).toMatch(/"LOSS_CLOSE_CONFIRMATION_REQUIRED"/);
  });
  it("route blocks close in 12-24h window", () => {
    expect(ROUTE_SRC).toMatch(/if \(age === "monitoring"\)/);
    expect(ROUTE_SRC).toMatch(/POSITION_UNDER_OBSERVATION/);
  });
  it("route requires confirmLossClose for loss bucket", () => {
    expect(ROUTE_SRC).toMatch(/pnlCat === "loss" && !parsed\.confirmLossClose/);
    expect(ROUTE_SRC).toMatch(/LOSS_CLOSE_CONFIRMATION_REQUIRED/);
  });
  it("route uses estimateNetUnrealizedPnl from the canonical engine", () => {
    expect(ROUTE_SRC).toMatch(/estimateNetUnrealizedPnl/);
    expect(ENGINE_SRC).toMatch(/export function estimateNetUnrealizedPnl/);
  });
  it("route maps fresh+profit/loss/break_even to canonical exit_reason", () => {
    expect(ROUTE_SRC).toMatch(/"manual_profit_close"/);
    expect(ROUTE_SRC).toMatch(/"manual_loss_close"/);
    expect(ROUTE_SRC).toMatch(/"manual_break_even_close"/);
  });
  it("route maps stale+profit/loss/break_even to canonical stale exit_reason", () => {
    expect(ROUTE_SRC).toMatch(/"manual_stale_profit_close"/);
    expect(ROUTE_SRC).toMatch(/"manual_stale_loss_close"/);
    expect(ROUTE_SRC).toMatch(/"manual_stale_break_even_close"/);
  });
  it("12-24h monitoring bucket has no canonical exit_reason mapping", () => {
    // canonicalExitReason only branches on "fresh" and "stale" — monitoring
    // requests are blocked before reaching this function.
    const idx = ROUTE_SRC.indexOf("function canonicalExitReason");
    expect(idx).toBeGreaterThan(0);
    const fnSrc = ROUTE_SRC.slice(idx, idx + 600);
    expect(fnSrc).not.toMatch(/"monitoring"/);
  });
  it("route emits the spec'd manual-close log events", () => {
    const required = [
      "paper_trade_manual_profit_close_requested",
      "paper_trade_manual_break_even_close_requested",
      "paper_trade_manual_loss_close_confirmation_required",
      "paper_trade_manual_loss_close_confirmed",
      "paper_trade_manual_stale_profit_close_requested",
      "paper_trade_manual_stale_loss_close_confirmation_required",
      "paper_trade_manual_stale_loss_close_confirmed",
      "paper_trade_manual_stale_break_even_close_requested",
      "paper_trade_manual_close_failed",
      "paper_trade_close_blocked_under_observation",
    ];
    for (const evt of required) {
      expect(ROUTE_SRC).toMatch(new RegExp(`"${evt}"`));
    }
  });
});

describe("paper-trades close route — SL/TP path untouched", () => {
  it("closePaperTrade is still the canonical helper invoked", () => {
    expect(ROUTE_SRC).toMatch(/await closePaperTrade\(\{/);
  });
  it("evaluateOpenTrades (SL/TP sweep) is unchanged in shape", () => {
    expect(ENGINE_SRC).toMatch(/export async function evaluateOpenTrades\(userId: string\)/);
    // SL/TP exit reasons unchanged
    expect(ENGINE_SRC).toMatch(/exitReason = "stop_loss"/);
    expect(ENGINE_SRC).toMatch(/exitReason = "take_profit"/);
  });
});

describe("paper-trades GET route — open rows enriched with mark price + pnl", () => {
  it("GET enriches open rows with current_price + net_unrealized_pnl", () => {
    expect(GET_ROUTE_SRC).toMatch(/current_price/);
    expect(GET_ROUTE_SRC).toMatch(/net_unrealized_pnl/);
  });
  it("GET uses fetchOpenTradeMarkPrices + estimateNetUnrealizedPnl", () => {
    expect(GET_ROUTE_SRC).toMatch(/fetchOpenTradeMarkPrices/);
    expect(GET_ROUTE_SRC).toMatch(/estimateNetUnrealizedPnl/);
  });
});

describe("paper-trades — visible label renamed to Pozisyonlar", () => {
  it("sidebar label is 'Pozisyonlar'", () => {
    expect(SIDEBAR_SRC).toMatch(/label:\s*'Pozisyonlar'/);
    expect(SIDEBAR_SRC).not.toMatch(/label:\s*'Sanal İşlemler'/);
  });
  it("page title is 'Pozisyonlar'", () => {
    expect(PAGE_SRC).toMatch(/<h1[^>]*>\s*Pozisyonlar\s*<\/h1>/);
  });
  it("dashboard reference text uses 'Pozisyonlar' not 'Sanal İşlemler'", () => {
    expect(DASH_SRC).toMatch(/Pozisyonlar ▸ Kapanan İşlemler/);
    expect(DASH_SRC).not.toMatch(/Sanal İşlemler ▸ Kapanan İşlemler/);
  });
});

describe("paper-trades — technical names preserved", () => {
  it("route path remains /paper-trades", () => {
    expect(SIDEBAR_SRC).toMatch(/href:\s*'\/paper-trades'/);
  });
  it("API close route still under /api/paper-trades/close", () => {
    expect(fs.existsSync(path.join(REPO_ROOT, "src/app/api/paper-trades/close/route.ts"))).toBe(true);
  });
  it("DB table name paper_trades is preserved", () => {
    expect(ROUTE_SRC).toMatch(/from\("paper_trades"\)/);
    expect(GET_ROUTE_SRC).toMatch(/from\("paper_trades"\)/);
    expect(ENGINE_SRC).toMatch(/from\("paper_trades"\)/);
  });
});

describe("paper-trades — live-safety invariants", () => {
  it("no /fapi/v1/order in close route", () => {
    const code = ROUTE_SRC.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/['"`][^'"`]*\/fapi\/v1\/order[^'"`]*['"`]/);
  });
  it("no /fapi/v1/leverage in close route", () => {
    const code = ROUTE_SRC.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/['"`][^'"`]*\/fapi\/v1\/leverage[^'"`]*['"`]/);
  });
  it("no /fapi/v1/order in paper-trades page", () => {
    const code = PAGE_SRC.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/\/fapi\/v1\/order/);
    expect(code).not.toMatch(/\/fapi\/v1\/leverage/);
  });
  it("close route still routes through closePaperTrade (no exchange order)", () => {
    expect(ROUTE_SRC).toMatch(/await closePaperTrade\(/);
  });
});

describe("close-price fallback chain — binance → scanner → signal → metadata → log", () => {
  it("engine exports the ClosePriceSource enum + resolveClosePriceFallback", () => {
    expect(ENGINE_SRC).toMatch(/export type ClosePriceSource = "binance" \| "scanner" \| "signal" \| "metadata" \| "log"/);
    expect(ENGINE_SRC).toMatch(/export async function resolveClosePriceFallback/);
  });
  it("fallback chain rejects entry_price as a substitute", () => {
    // Spec: entry price must not be used as fallback (would zero PnL and bypass
    // the loss-close gate). The resolver explicitly states this in its contract
    // and never references entry_price as a candidate field.
    const idx = ENGINE_SRC.indexOf("export async function resolveClosePriceFallback");
    const fnSrc = ENGINE_SRC.slice(idx, idx + 4500);
    expect(fnSrc).not.toMatch(/trade\.entry_price/);
  });
  it("scanner source applies for signals ≤5 minutes old", () => {
    expect(ENGINE_SRC).toMatch(/ageMs <= 5 \* 60 \* 1000 \? "scanner" : "signal"/);
  });
  it("metadata source consults known mark-price keys (no entry_price)", () => {
    expect(ENGINE_SRC).toMatch(/"currentPrice", "lastPrice", "mark_price", "last_price", "markPrice", "current_price"/);
  });
  it("log source pulls from bot_logs signal_generated metadata", () => {
    expect(ENGINE_SRC).toMatch(/from\("bot_logs"\)/);
    expect(ENGINE_SRC).toMatch(/event_type[\s\S]{0,30}signal_generated/);
  });
  it("close route emits paper_trade_close_price_unavailable when fallback chain is empty", () => {
    expect(ROUTE_SRC).toMatch(/eventType:\s*"paper_trade_close_price_unavailable"/);
  });
  it("close route emits paper_trade_close_price_fallback_used when a non-binance source wins", () => {
    expect(ROUTE_SRC).toMatch(/eventType:\s*"paper_trade_close_price_fallback_used"/);
  });
  it("close route reports fallbackSource in fallback log metadata", () => {
    expect(ROUTE_SRC).toMatch(/fallbackSource:\s*resolved\.source/);
  });
  it("close route response surfaces the resolved closePriceSource", () => {
    // The response always includes closePriceSource — UI uses it to decide
    // whether to show the compact fallback notice.
    expect(ROUTE_SRC).toMatch(/closePriceSource,/);
  });
  it("page renders fallback notice that names the source label", () => {
    expect(PAGE_SRC).toMatch(/fallback fiyat kullanıldı/i);
    expect(PAGE_SRC).toMatch(/closePriceSource/);
  });
  it("GET enrichment surfaces current_price_source on each open row", () => {
    expect(GET_ROUTE_SRC).toMatch(/current_price_source/);
  });
});

describe("estimateNetUnrealizedPnl — pure math invariants", () => {
  it("LONG profitable position returns positive netPnl", async () => {
    const { estimateNetUnrealizedPnl } = await import("@/lib/engines/paper-trading-engine");
    const r = estimateNetUnrealizedPnl({
      direction: "LONG",
      entryPrice: 100,
      positionSize: 10,
      marginUsed: 500,
      openedAt: new Date().toISOString(),
      currentPrice: 110,
    });
    // gross = 100, fees ≈ 100*210*0.0004 = 8.4, slippage ≈ 5.25, funding ~ 0
    expect(r.netPnl).toBeGreaterThan(80);
    expect(r.netPnl).toBeLessThan(100);
    expect(r.pnlPct).toBeGreaterThan(0);
  });
  it("SHORT profitable position returns positive netPnl", async () => {
    const { estimateNetUnrealizedPnl } = await import("@/lib/engines/paper-trading-engine");
    const r = estimateNetUnrealizedPnl({
      direction: "SHORT",
      entryPrice: 100,
      positionSize: 10,
      marginUsed: 500,
      openedAt: new Date().toISOString(),
      currentPrice: 90,
    });
    expect(r.netPnl).toBeGreaterThan(80);
    expect(r.netPnl).toBeLessThan(100);
  });
  it("LONG losing position falls below the loss threshold", async () => {
    const { estimateNetUnrealizedPnl } = await import("@/lib/engines/paper-trading-engine");
    const r = estimateNetUnrealizedPnl({
      direction: "LONG",
      entryPrice: 100,
      positionSize: 10,
      marginUsed: 500,
      openedAt: new Date().toISOString(),
      currentPrice: 99,
    });
    // gross = -10, fees + slippage make it more negative
    expect(r.netPnl).toBeLessThan(-0.25);
  });
});
