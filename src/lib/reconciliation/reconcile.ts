// Faz 18 — Saf reconciliation fonksiyonu.
// Exchange'e hiç bağlanmaz; girdileri saf veri olarak alır.

import {
  type DbTradeSnapshot,
  type ExchangePositionSnapshot,
  type ReconciliationIssue,
  type ReconciliationResult,
  SIZE_TOLERANCE_PCT,
  PRICE_TOLERANCE_PCT,
} from "./types";

function pctDiff(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return Number.POSITIVE_INFINITY;
  return Math.abs((a - b) / b) * 100;
}

function key(symbol: string, side: string): string {
  return `${symbol.toUpperCase()}::${side.toUpperCase()}`;
}

export function detectDuplicateOpenPositions(trades: DbTradeSnapshot[]): ReconciliationIssue[] {
  const counts = new Map<string, DbTradeSnapshot[]>();
  for (const t of trades) {
    if (t.status !== "open") continue;
    const k = key(t.symbol, t.side);
    if (!counts.has(k)) counts.set(k, []);
    counts.get(k)!.push(t);
  }
  const issues: ReconciliationIssue[] = [];
  for (const [k, arr] of counts) {
    if (arr.length > 1) {
      const [sym, side] = k.split("::");
      issues.push({
        code: "DUPLICATE_OPEN_POSITION",
        severity: "critical",
        symbol: sym,
        side: side as any,
        message: `Aynı symbol+side için ${arr.length} açık pozisyon tespit edildi`,
        dbId: arr[0].id,
      });
    }
  }
  return issues;
}

export interface ReconcileInput {
  dbTrades: DbTradeSnapshot[];
  exchangePositions: ExchangePositionSnapshot[];
}

export function reconcile(input: ReconcileInput): ReconciliationResult {
  const generatedAt = new Date().toISOString();
  const issues: ReconciliationIssue[] = [];

  // 1) Duplicate open positions in DB.
  issues.push(...detectDuplicateOpenPositions(input.dbTrades));

  // Index by symbol+side for matching.
  const dbOpen = new Map<string, DbTradeSnapshot>();
  for (const t of input.dbTrades) {
    if (t.status === "open") {
      const k = key(t.symbol, t.side);
      // For duplicates, keep the first; duplicate already raised above.
      if (!dbOpen.has(k)) dbOpen.set(k, t);
    }
  }
  const exOpen = new Map<string, ExchangePositionSnapshot>();
  for (const p of input.exchangePositions) {
    if (p.status === "open") exOpen.set(key(p.symbol, p.side), p);
  }

  // 2) DB open without exchange counterpart.
  for (const [k, t] of dbOpen) {
    if (!exOpen.has(k)) {
      issues.push({
        code: "DB_OPEN_EXCHANGE_MISSING",
        severity: "critical",
        symbol: t.symbol,
        side: t.side,
        message: "DB'de açık pozisyon var, exchange tarafında bulunamadı",
        dbId: t.id,
      });
    }
  }

  // 3) Exchange open without DB counterpart.
  for (const [k, p] of exOpen) {
    if (!dbOpen.has(k)) {
      issues.push({
        code: "EXCHANGE_OPEN_DB_MISSING",
        severity: "critical",
        symbol: p.symbol,
        side: p.side,
        message: "Exchange'de açık pozisyon var, DB'de yok",
      });
    }
  }

  // 4) Size / price / side mismatch for matched pairs.
  for (const [k, t] of dbOpen) {
    const p = exOpen.get(k);
    if (!p) continue;
    if (t.side !== p.side) {
      issues.push({
        code: "SIDE_MISMATCH",
        severity: "critical",
        symbol: t.symbol,
        message: `DB side=${t.side} exchange side=${p.side}`,
        dbId: t.id,
      });
    }
    if (pctDiff(t.quantity, p.quantity) > SIZE_TOLERANCE_PCT) {
      issues.push({
        code: "SIZE_MISMATCH",
        severity: "warning",
        symbol: t.symbol,
        side: t.side,
        message: `DB qty=${t.quantity} exchange qty=${p.quantity} (>${SIZE_TOLERANCE_PCT}% fark)`,
        dbId: t.id,
      });
    }
    if (t.entryPrice > 0 && p.entryPrice > 0 && pctDiff(t.entryPrice, p.entryPrice) > PRICE_TOLERANCE_PCT) {
      issues.push({
        code: "PRICE_MISMATCH",
        severity: "info",
        symbol: t.symbol,
        side: t.side,
        message: `DB entry=${t.entryPrice} exchange entry=${p.entryPrice} (>${PRICE_TOLERANCE_PCT}% fark)`,
        dbId: t.id,
      });
    }
    if (t.status !== p.status) {
      issues.push({
        code: "STATUS_MISMATCH",
        severity: "warning",
        symbol: t.symbol,
        side: t.side,
        message: `DB status=${t.status} exchange status=${p.status}`,
        dbId: t.id,
      });
    }
  }

  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  return {
    ok: issues.length === 0,
    issueCount: issues.length,
    criticalCount,
    issues,
    generatedAt,
  };
}
