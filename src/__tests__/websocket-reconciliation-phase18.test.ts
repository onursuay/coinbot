// Faz 18 — WebSocket + Reconciliation güvenli altyapı testleri.
//
// Kapsam:
//   • Market feed status default = disconnected, feedMode = none
//   • Stale hesaplaması
//   • Reconciliation issue detection (DB_OPEN_EXCHANGE_MISSING vb.)
//   • Duplicate position guard
//   • clientOrderId uniqueness
//   • Worker heartbeat sahte "ok" üretmiyor (statik file check)
//   • Reconciliation loop fail-closed (paper / hardLive=false → no-op)
//   • Korunan değişmezler (HARD_LIVE_TRADING_ALLOWED, MIN_SIGNAL_CONFIDENCE, vb.)
//   • /fapi/v1/order yok, openLiveOrder hâlâ NOT_IMPLEMENTED

import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  getMarketFeedStatus,
  resetMarketFeedStatus,
  setMarketFeedStatus,
  createPublicMarketFeed,
  toHeartbeatWebsocketStatus,
  DEFAULT_FEED_STATUS,
  MARKET_FEED_STALE_SEC,
} from "@/lib/market-feed";

import {
  reconcile,
  detectDuplicateOpenPositions,
  detectDuplicateOpenPosition,
  buildClientOrderId,
  validateClientOrderIdUniqueness,
  type DbTradeSnapshot,
  type ExchangePositionSnapshot,
} from "@/lib/reconciliation";

// ── Grup 1: Market feed status defaults ───────────────────────────────────────

describe("Faz 18 — Market feed status defaults", () => {
  beforeEach(() => { resetMarketFeedStatus(); });

  it("default websocketStatus is disconnected", () => {
    const s = getMarketFeedStatus();
    expect(s.websocketStatus).toBe("disconnected");
  });

  it("default feedMode is none", () => {
    const s = getMarketFeedStatus();
    expect(s.feedMode).toBe("none");
  });

  it("default disconnectReason is set", () => {
    const s = getMarketFeedStatus();
    expect(s.disconnectReason).toBe("market_feed_not_started");
  });

  it("default stale = true (no message ever received)", () => {
    const s = getMarketFeedStatus();
    expect(s.stale).toBe(true);
    expect(s.staleAgeSec).toBeNull();
  });

  it("MARKET_FEED_STALE_SEC is 60", () => {
    expect(MARKET_FEED_STALE_SEC).toBe(60);
  });
});

// ── Grup 2: Market feed stale calculation ─────────────────────────────────────

describe("Faz 18 — Market feed stale calculation", () => {
  beforeEach(() => { resetMarketFeedStatus(); });

  it("recent message → stale = false", () => {
    setMarketFeedStatus({
      websocketStatus: "connected",
      lastMessageAt: new Date(Date.now() - 5_000).toISOString(),
    });
    const s = getMarketFeedStatus();
    expect(s.stale).toBe(false);
    expect(s.staleAgeSec).toBeLessThan(10);
  });

  it("old message → stale = true", () => {
    setMarketFeedStatus({
      websocketStatus: "connected",
      lastMessageAt: new Date(Date.now() - 120_000).toISOString(),
    });
    const s = getMarketFeedStatus();
    expect(s.stale).toBe(true);
    expect(s.staleAgeSec).toBeGreaterThan(60);
  });
});

// ── Grup 3: Skeleton public market feed ───────────────────────────────────────

describe("Faz 18 — createPublicMarketFeed (skeleton)", () => {
  beforeEach(() => { resetMarketFeedStatus(); });

  it("skeletonOnly defaults to true → no real socket, status disconnected", () => {
    const feed = createPublicMarketFeed();
    expect(feed.getStatus().websocketStatus).toBe("disconnected");
    expect(feed.getStatus().disconnectReason).toMatch(/skeleton_only|market_feed_not_started/);
  });

  it("subscribe / unsubscribe updates symbolsSubscribed", () => {
    const feed = createPublicMarketFeed();
    feed.subscribeSymbols(["BTCUSDT", "ETHUSDT"]);
    expect(feed.getStatus().symbolsSubscribed.sort()).toEqual(["BTCUSDT", "ETHUSDT"]);
    feed.unsubscribeSymbols(["BTCUSDT"]);
    expect(feed.getStatus().symbolsSubscribed).toEqual(["ETHUSDT"]);
  });

  it("close() sets status to disconnected with reason", () => {
    const feed = createPublicMarketFeed();
    feed.close();
    expect(feed.getStatus().websocketStatus).toBe("disconnected");
    expect(feed.getStatus().disconnectReason).toBe("feed_closed_by_caller");
  });
});

// ── Grup 4: heartbeat status mapper ───────────────────────────────────────────

describe("Faz 18 — toHeartbeatWebsocketStatus", () => {
  it("connected → connected", () => {
    expect(toHeartbeatWebsocketStatus("connected")).toBe("connected");
  });
  it("disconnected → disconnected", () => {
    expect(toHeartbeatWebsocketStatus("disconnected")).toBe("disconnected");
  });
  it("connecting → reconnecting", () => {
    expect(toHeartbeatWebsocketStatus("connecting")).toBe("reconnecting");
  });
  it("degraded → reconnecting", () => {
    expect(toHeartbeatWebsocketStatus("degraded")).toBe("reconnecting");
  });
});

// ── Grup 5: Reconciliation pure function ──────────────────────────────────────

function dbTrade(over: Partial<DbTradeSnapshot> = {}): DbTradeSnapshot {
  return {
    id: "db-1",
    symbol: "BTCUSDT",
    side: "LONG",
    quantity: 0.01,
    entryPrice: 100000,
    status: "open",
    clientOrderId: null,
    ...over,
  };
}

function exPos(over: Partial<ExchangePositionSnapshot> = {}): ExchangePositionSnapshot {
  return {
    symbol: "BTCUSDT",
    side: "LONG",
    quantity: 0.01,
    entryPrice: 100000,
    status: "open",
    ...over,
  };
}

describe("Faz 18 — reconcile()", () => {
  it("ok=true when DB and exchange match perfectly", () => {
    const r = reconcile({ dbTrades: [dbTrade()], exchangePositions: [exPos()] });
    expect(r.ok).toBe(true);
    expect(r.issueCount).toBe(0);
    expect(r.criticalCount).toBe(0);
  });

  it("DB_OPEN_EXCHANGE_MISSING when DB has open but exchange does not", () => {
    const r = reconcile({ dbTrades: [dbTrade()], exchangePositions: [] });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "DB_OPEN_EXCHANGE_MISSING")).toBe(true);
    expect(r.criticalCount).toBeGreaterThan(0);
  });

  it("EXCHANGE_OPEN_DB_MISSING when exchange has open but DB does not", () => {
    const r = reconcile({ dbTrades: [], exchangePositions: [exPos()] });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "EXCHANGE_OPEN_DB_MISSING")).toBe(true);
  });

  it("SIZE_MISMATCH when quantities differ beyond tolerance", () => {
    const r = reconcile({
      dbTrades: [dbTrade({ quantity: 0.01 })],
      exchangePositions: [exPos({ quantity: 0.02 })],
    });
    expect(r.issues.some((i) => i.code === "SIZE_MISMATCH")).toBe(true);
  });

  it("SIDE_MISMATCH when sides differ", () => {
    const r = reconcile({
      dbTrades: [dbTrade({ side: "LONG" })],
      exchangePositions: [exPos({ side: "SHORT" })],
    });
    // Note: side mismatch indexes differently; key uses symbol+side, so
    // LONG+SHORT will appear as DB_OPEN + EXCHANGE_OPEN missing pair.
    // Both are valid critical-class signals.
    const codes = r.issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["DB_OPEN_EXCHANGE_MISSING", "EXCHANGE_OPEN_DB_MISSING"]));
  });

  it("DUPLICATE_OPEN_POSITION when DB has 2 open with same symbol+side", () => {
    const r = reconcile({
      dbTrades: [dbTrade({ id: "a" }), dbTrade({ id: "b" })],
      exchangePositions: [exPos()],
    });
    expect(r.issues.some((i) => i.code === "DUPLICATE_OPEN_POSITION")).toBe(true);
  });

  it("PRICE_MISMATCH severity=info (non-critical)", () => {
    const r = reconcile({
      dbTrades: [dbTrade({ entryPrice: 100000 })],
      exchangePositions: [exPos({ entryPrice: 105000 })],  // 5% diff
    });
    const priceIssues = r.issues.filter((i) => i.code === "PRICE_MISMATCH");
    expect(priceIssues.length).toBeGreaterThan(0);
    expect(priceIssues[0].severity).toBe("info");
  });

  it("generatedAt is a valid ISO timestamp", () => {
    const r = reconcile({ dbTrades: [], exchangePositions: [] });
    expect(new Date(r.generatedAt).getTime()).toBeGreaterThan(0);
  });

  it("detectDuplicateOpenPositions returns critical severity", () => {
    const issues = detectDuplicateOpenPositions([dbTrade({ id: "a" }), dbTrade({ id: "b" })]);
    expect(issues.length).toBe(1);
    expect(issues[0].severity).toBe("critical");
  });
});

// ── Grup 6: Duplicate guard / clientOrderId ───────────────────────────────────

describe("Faz 18 — Duplicate position guard", () => {
  it("detects duplicate when symbol+side already open", () => {
    const r = detectDuplicateOpenPosition("BTCUSDT", "LONG", [dbTrade({ id: "x" })]);
    expect(r.duplicate).toBe(true);
    expect(r.conflictingDbId).toBe("x");
  });

  it("no duplicate when different side", () => {
    const r = detectDuplicateOpenPosition("BTCUSDT", "SHORT", [dbTrade({ side: "LONG" })]);
    expect(r.duplicate).toBe(false);
  });

  it("ignores closed trades", () => {
    const r = detectDuplicateOpenPosition("BTCUSDT", "LONG", [dbTrade({ status: "closed" })]);
    expect(r.duplicate).toBe(false);
  });
});

describe("Faz 18 — buildClientOrderId / uniqueness", () => {
  it("generates non-empty unique-looking id with prefix", () => {
    const id = buildClientOrderId("BTCUSDT", "LONG");
    expect(id.startsWith("cb-")).toBe(true);
    expect(id.length).toBeGreaterThan(8);
    expect(id.length).toBeLessThanOrEqual(36);
  });

  it("two consecutive ids are different", () => {
    const a = buildClientOrderId("BTCUSDT", "LONG", 111);
    const b = buildClientOrderId("BTCUSDT", "LONG", 111);
    expect(a).not.toBe(b);
  });

  it("uniqueness check rejects empty id", () => {
    expect(validateClientOrderIdUniqueness("", []).unique).toBe(false);
  });

  it("uniqueness check finds existing", () => {
    const r = validateClientOrderIdUniqueness("cb-X", [dbTrade({ clientOrderId: "cb-X" })]);
    expect(r.unique).toBe(false);
    expect(r.conflictingDbId).toBe("db-1");
  });

  it("uniqueness check passes when no conflict", () => {
    const r = validateClientOrderIdUniqueness("cb-Y", [dbTrade({ clientOrderId: "cb-Z" })]);
    expect(r.unique).toBe(true);
  });
});

// ── Grup 7: Static file invariants ────────────────────────────────────────────

describe("Faz 18 — Güvenlik invariantları", () => {
  const workerPath = path.resolve(__dirname, "../../worker/index.ts");
  const adapterPath = path.resolve(__dirname, "../lib/live-execution/adapter.ts");
  const envPath = path.resolve(__dirname, "../lib/env.ts");
  const reconcilePath = path.resolve(__dirname, "../lib/reconciliation/reconcile.ts");
  const marketStatusPath = path.resolve(__dirname, "../lib/market-feed/status.ts");

  let worker: string;
  let adapter: string;
  let envTs: string;
  let reconcileTs: string;
  let marketStatus: string;

  beforeAll(() => {
    worker = fs.readFileSync(workerPath, "utf8");
    adapter = fs.readFileSync(adapterPath, "utf8");
    envTs = fs.readFileSync(envPath, "utf8");
    reconcileTs = fs.readFileSync(reconcilePath, "utf8");
    marketStatus = fs.readFileSync(marketStatusPath, "utf8");
  });

  it("worker no longer hardcodes binanceApiStatus to ok", () => {
    // Must NOT have the literal `binanceApiStatus: "ok"` anymore.
    expect(worker).not.toMatch(/binanceApiStatus:\s*["']ok["']/);
  });

  it("worker no longer hardcodes websocketStatus to disconnected literal", () => {
    expect(worker).not.toMatch(/websocketStatus:\s*["']disconnected["'],\s*\/\/ wired up later/);
  });

  it("worker uses getMarketFeedStatus / toHeartbeatWebsocketStatus", () => {
    expect(worker).toMatch(/getMarketFeedStatus/);
    expect(worker).toMatch(/toHeartbeatWebsocketStatus/);
  });

  it("worker reconciliation loop is fail-closed on hardLive flag", () => {
    expect(worker).toMatch(/isHardLiveAllowed/);
  });

  it("reconciliation module contains no /fapi/v1/order", () => {
    expect(reconcileTs).not.toMatch(/\/fapi\/v1\/order/);
  });

  it("market-feed module contains no /fapi/v1/order", () => {
    expect(marketStatus).not.toMatch(/\/fapi\/v1\/order/);
  });

  it("market-feed module makes no fetch calls", () => {
    expect(marketStatus).not.toMatch(/\bfetch\s*\(/);
  });

  it("market-feed module makes no listenKey/user data stream calls", () => {
    // The file may contain the strings inside top-of-file guard comments;
    // we check that they don't appear as actual API path references.
    expect(marketStatus).not.toMatch(/\/api\/v[13]\/userDataStream/);
    expect(marketStatus).not.toMatch(/listenKey=/);
    expect(marketStatus).not.toMatch(/POST.*listenKey/i);
  });

  // Korunan değişmezler
  it("env hardLiveTradingAllowed defaults to false", () => {
    expect(envTs).toMatch(/hardLiveTradingAllowed.*HARD_LIVE_TRADING_ALLOWED.*false/);
  });

  it("env defaultTradingMode defaults to paper", () => {
    expect(envTs).toMatch(/defaultTradingMode.*DEFAULT_TRADING_MODE.*"paper"/);
  });

  it("openLiveOrder still returns LIVE_EXECUTION_NOT_IMPLEMENTED, no fetch", () => {
    expect(adapter).toMatch(/LIVE_EXECUTION_NOT_IMPLEMENTED/);
    expect(adapter).not.toMatch(/\bfetch\s*\(/);
  });
});
