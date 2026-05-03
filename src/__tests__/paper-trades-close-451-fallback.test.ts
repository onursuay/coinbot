// Regression suite for the paper-trades close endpoint.
//
// Behavior locked by these tests:
//   • Binance ticker call may throw HTTP 451 (Vercel/edge geo-block); the
//     route falls back to `signals.entry_price` (most recent within 1h) and
//     still closes the position.
//   • If both primary and fallback fail, the route returns a structured
//     JSON body with `code: "BINANCE_451"` (or "PRICE_UNAVAILABLE") and
//     never raw text/HTML/HTTP-status strings.
//   • Successful close response includes `closePriceSource` and an explicit
//     `data` envelope so the canonical paper-stats helper aggregates the
//     same `pnl` value that the table renders per-row.
//   • The route NEVER calls /fapi/v1/order or /fapi/v1/leverage — it is a
//     paper-only flow.

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ROUTE_SRC = fs.readFileSync(
  path.join(REPO_ROOT, "src/app/api/paper-trades/close/route.ts"),
  "utf8",
);
const PAGE_SRC = fs.readFileSync(
  path.join(REPO_ROOT, "src/app/paper-trades/page.tsx"),
  "utf8",
);

describe("paper-trades close — source invariants (live-safety)", () => {
  it("route never calls fapi v1 order or leverage endpoints (executable code only)", () => {
    // Strip comments before checking — code must not contain real fetches to
    // these endpoints, but the file may name them in a "never call" comment.
    const code = ROUTE_SRC
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/['"`][^'"`]*\/fapi\/v1\/order[^'"`]*['"`]/);
    expect(code).not.toMatch(/['"`][^'"`]*\/fapi\/v1\/leverage[^'"`]*['"`]/);
  });

  it("route uses closePaperTrade from the canonical engine helper", () => {
    expect(ROUTE_SRC).toMatch(/from "@\/lib\/engines\/paper-trading-engine"/);
    expect(ROUTE_SRC).toMatch(/await closePaperTrade\(/);
  });

  it("route exports the BINANCE_451 / PRICE_UNAVAILABLE codes", () => {
    expect(ROUTE_SRC).toMatch(/"BINANCE_451"/);
    expect(ROUTE_SRC).toMatch(/"PRICE_UNAVAILABLE"/);
    expect(ROUTE_SRC).toMatch(/"CLOSE_FAILED"/);
  });

  it("route always returns JSON via NextResponse.json (no HTML / text rendering)", () => {
    expect(ROUTE_SRC).toMatch(/NextResponse\.json/);
    expect(ROUTE_SRC).not.toMatch(/return new Response\(['"]<html/);
  });

  it("route emits the close-flow log events (request/price-fetch-failed/fallback-used/success/manual-close-failed)", () => {
    expect(ROUTE_SRC).toMatch(/eventType:\s*"paper_trade_close_requested"/);
    expect(ROUTE_SRC).toMatch(/eventType:\s*"paper_trade_close_price_fetch_failed"/);
    expect(ROUTE_SRC).toMatch(/eventType:\s*"paper_trade_close_price_fallback_used"/);
    expect(ROUTE_SRC).toMatch(/eventType:\s*"paper_trade_close_success"/);
    // The terminal-failure event was renamed from `paper_trade_close_failed`
    // to `paper_trade_manual_close_failed` when the manual-close gates were
    // added. Both unsuccessful-path branches (price unavailable / close
    // helper threw) emit this same event.
    expect(ROUTE_SRC).toMatch(/eventType:\s*"paper_trade_manual_close_failed"/);
  });

  it("frontend never alerts the raw HTTP status string", () => {
    expect(PAGE_SRC).not.toMatch(/alert\(res\.error\)/);
    // alert() is reserved for native browser-confirmation dialogs only;
    // any error display must go through the inline notice banner.
    const alertHits = (PAGE_SRC.match(/alert\(/g) ?? []).filter(
      (_, i, arr) => i === arr.findIndex((x) => x === "alert("),
    );
    // confirm() use is fine — keeps the "are you sure" prompt.
    expect(PAGE_SRC).toMatch(/confirm\(/);
    // No alert() of error message text:
    expect(PAGE_SRC).not.toMatch(/alert\([^)]*error/);
    expect(PAGE_SRC).not.toMatch(/alert\([^)]*HTTP/);
    void alertHits;
  });

  it("frontend disables the Kapat button while a close is in flight", () => {
    // The button is now stateful (KAPAT/İZLENİYOR/SÜRE AŞIMI) and `disabled`
    // is computed from a combined predicate, but the in-flight guard remains:
    // when closingId matches the current row OR another row is already
    // closing, the button is disabled.
    expect(PAGE_SRC).toMatch(/closingId/);
    expect(PAGE_SRC).toMatch(/closingId === t\.id/);
    expect(PAGE_SRC).toMatch(/closingId !== null && closingId !== t\.id/);
  });

  it("frontend maps backend `code` field to a localized message", () => {
    expect(PAGE_SRC).toMatch(/closeMessageFor/);
    expect(PAGE_SRC).toMatch(/"BINANCE_451"/);
    expect(PAGE_SRC).toMatch(/"PRICE_UNAVAILABLE"/);
  });
});

// Functional tests — exercise the real route handler with mocked supabase + adapter.

const TRADE_ID = "11111111-1111-1111-1111-111111111111";
const FAKE_TRADE = {
  id: TRADE_ID,
  user_id: "test-user",
  exchange_name: "binance",
  symbol: "BTC/USDT",
  direction: "LONG",
  entry_price: 30000,
  stop_loss: 29500,
  take_profit: 31000,
  position_size: 0.001,
  margin_used: 30,
  leverage: 10,
  opened_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  status: "open",
  risk_metadata: null,
};

interface MockShape {
  paperRow: any;
  fallbackRows: Array<{ entry_price: number; created_at: string }>;
  updates: any[];
  inserts: any[];
}

function setupMocks(shape: MockShape, opts: { tickerError?: Error; tickerPrice?: number }) {
  vi.resetModules();

  const supabaseAdminFn = () => ({
    from: (table: string) => {
      if (table === "paper_trades") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({ data: shape.paperRow, error: null }),
              }),
            }),
          }),
          update: (patch: any) => {
            const updateChain = {
              eq: () => updateChain,
              select: () => ({
                single: async () => {
                  const merged = { ...shape.paperRow, ...patch };
                  shape.updates.push(merged);
                  return { data: merged, error: null };
                },
              }),
            };
            return updateChain;
          },
        };
      }
      if (table === "signals") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                gte: () => ({
                  order: () => ({
                    limit: async () => ({ data: shape.fallbackRows }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "bot_logs" || table === "trade_learning_events") {
        return {
          insert: async (row: any) => {
            shape.inserts.push({ table, row });
            return { error: null };
          },
        };
      }
      return {
        select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) }),
        insert: async () => ({ error: null }),
      };
    },
  });

  vi.doMock("@/lib/supabase/server", () => ({
    supabaseConfigured: () => true,
    supabaseAdmin: supabaseAdminFn,
  }));
  vi.doMock("@/lib/auth", () => ({ getCurrentUserId: () => "test-user" }));
  vi.doMock("@/lib/exchanges/exchange-factory", () => ({
    getAdapter: () => ({
      getTicker: async () => {
        if (opts.tickerError) throw opts.tickerError;
        return { lastPrice: opts.tickerPrice ?? 30500, bid: 0, ask: 0, spread: 0 };
      },
    }),
  }));
}

describe("paper-trades close — functional", () => {
  beforeEach(() => vi.resetModules());

  it("happy path: Binance ticker OK → closes with closePriceSource=binance", async () => {
    const shape: MockShape = { paperRow: { ...FAKE_TRADE }, fallbackRows: [], updates: [], inserts: [] };
    setupMocks(shape, { tickerPrice: 30500 });

    const { POST } = await import("@/app/api/paper-trades/close/route");
    const req = new Request("http://x/api/paper-trades/close", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tradeId: TRADE_ID }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.closePriceSource).toBe("binance");
    expect(shape.updates.length).toBe(1);
    expect(shape.updates[0].status).toBe("closed");
  });

  it("Binance returns 451 + signals fallback present → closes with closePriceSource=fallback_signal", async () => {
    const ExchangeHttpError = (await import("@/lib/exchanges/http")).ExchangeHttpError;
    const shape: MockShape = {
      paperRow: { ...FAKE_TRADE },
      fallbackRows: [{ entry_price: 30700, created_at: new Date().toISOString() }],
      updates: [],
      inserts: [],
    };
    setupMocks(shape, { tickerError: new ExchangeHttpError(451, "geoblocked") });

    const { POST } = await import("@/app/api/paper-trades/close/route");
    const req = new Request("http://x/api/paper-trades/close", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tradeId: TRADE_ID }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // The fallback chain now emits one of the structured source labels
    // ("scanner"|"signal"|"metadata"|"log") rather than the legacy
    // "fallback_signal" tag. Anything other than "binance" implies a fallback
    // path was taken — that's the invariant this test locks.
    expect(body.closePriceSource).toMatch(/^(scanner|signal|metadata|log)$/);
    expect(body.closePriceSource).not.toBe("binance");
    expect(body.warning).toMatch(/Fallback fiyat/);
    // Fallback log was emitted
    const fallbackLog = shape.inserts.find(
      (x) => x.table === "bot_logs" && x.row.event_type === "paper_trade_close_price_fallback_used",
    );
    expect(fallbackLog).toBeTruthy();
    // Position actually closed
    expect(shape.updates.length).toBe(1);
    expect(shape.updates[0].status).toBe("closed");
  });

  it("Binance 451 + no fallback → JSON code=BINANCE_451, status 503, position stays open", async () => {
    const ExchangeHttpError = (await import("@/lib/exchanges/http")).ExchangeHttpError;
    const shape: MockShape = {
      paperRow: { ...FAKE_TRADE },
      fallbackRows: [], // no recent signal
      updates: [],
      inserts: [],
    };
    setupMocks(shape, { tickerError: new ExchangeHttpError(451, "geoblocked") });

    const { POST } = await import("@/app/api/paper-trades/close/route");
    const req = new Request("http://x/api/paper-trades/close", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tradeId: TRADE_ID }),
    });
    const res = await POST(req);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("BINANCE_451");
    expect(body.error).toMatch(/Binance fiyat verisine erişilemedi/);
    // Position must NOT be closed
    expect(shape.updates.length).toBe(0);
  });

  it("Trade already closed → JSON code=TRADE_ALREADY_CLOSED, status 409", async () => {
    const shape: MockShape = {
      paperRow: { ...FAKE_TRADE, status: "closed" },
      fallbackRows: [],
      updates: [],
      inserts: [],
    };
    setupMocks(shape, { tickerPrice: 30500 });

    const { POST } = await import("@/app/api/paper-trades/close/route");
    const req = new Request("http://x/api/paper-trades/close", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tradeId: TRADE_ID }),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("TRADE_ALREADY_CLOSED");
  });

  it("response body is always JSON with stable shape; never raw HTTP text", async () => {
    const ExchangeHttpError = (await import("@/lib/exchanges/http")).ExchangeHttpError;
    const shape: MockShape = { paperRow: { ...FAKE_TRADE }, fallbackRows: [], updates: [], inserts: [] };
    setupMocks(shape, { tickerError: new ExchangeHttpError(451, "geoblocked") });

    const { POST } = await import("@/app/api/paper-trades/close/route");
    const req = new Request("http://x/api/paper-trades/close", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tradeId: TRADE_ID }),
    });
    const res = await POST(req);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toMatch(/application\/json/);
    const body = await res.json();
    // Stable error shape
    expect(typeof body.ok).toBe("boolean");
    expect(typeof body.error).toBe("string");
    expect(typeof body.code).toBe("string");
    // Never echoes the raw "HTTP 451" string back to the user
    expect(body.error).not.toBe("HTTP 451");
  });
});
