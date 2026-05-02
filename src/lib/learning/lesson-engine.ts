// Rule-based lesson engine — Phase 1 (no LLM call).
//
// Given a closed paper trade + the bypass metadata captured at open, produces
// a short Turkish lesson string that can be persisted as a lesson_created
// trade_learning_event. The downstream LLM phase will replace this with a
// model-generated summary; the rule-based output is the deterministic
// fallback and is always written.

export interface ClosedTradeContext {
  symbol: string;
  direction: "LONG" | "SHORT";
  pnl: number | null;
  pnlPercent: number | null;
  exitReason: string | null;        // "stop_loss" | "take_profit" | etc.
  hoursOpen: number | null;
  /** Bypass metadata captured at open. */
  bypassedRiskGates?: string[] | null;
  normalModeWouldReject?: boolean | null;
  originalRejectReason?: string | null;
  originalSignalScore?: number | null;
  originalMarketQualityScore?: number | null;
  generatedFallbackSlTp?: boolean | null;
  btcTrendState?: string | null;
  marketRegime?: string | null;
}

export interface OutcomeAnalysis {
  outcome: "win" | "loss" | "breakeven";
  riskWarrantedFlag: boolean;        // bypassed gate was actually risky?
  bypassesEvaluated: string[];
  notes: string[];
}

export interface Lesson {
  text: string;
  tags: string[];
  outcome: "win" | "loss" | "breakeven";
}

function classifyOutcome(pnl: number | null): "win" | "loss" | "breakeven" {
  if (pnl === null || !Number.isFinite(pnl)) return "breakeven";
  if (pnl > 0.01) return "win";
  if (pnl < -0.01) return "loss";
  return "breakeven";
}

export function analyzeOutcome(ctx: ClosedTradeContext): OutcomeAnalysis {
  const outcome = classifyOutcome(ctx.pnl);
  const bypasses = ctx.bypassedRiskGates ?? [];
  const notes: string[] = [];

  // The bypass was "warranted" if outcome is loss (the gate was right to
  // reject) and "unwarranted" if outcome is win (the gate was too strict).
  // breakeven is treated as inconclusive.
  let riskWarrantedFlag = false;

  if (outcome === "loss" && bypasses.length > 0) {
    riskWarrantedFlag = true;
    notes.push(`bypass_warranted: ${bypasses.length} gate bypass edildi, işlem zarar etti`);
  }
  if (outcome === "win" && bypasses.length > 0) {
    notes.push(`bypass_unwarranted: ${bypasses.length} gate bypass edildi, işlem kâr etti`);
  }
  if (ctx.exitReason === "stop_loss" && bypasses.length > 0) {
    notes.push("stop_loss_hit_after_bypass");
  }
  if (ctx.exitReason === "take_profit" && bypasses.length > 0) {
    notes.push("take_profit_hit_despite_bypass");
  }
  if (ctx.generatedFallbackSlTp) {
    notes.push("fallback_sl_tp_used");
  }

  return {
    outcome,
    riskWarrantedFlag,
    bypassesEvaluated: bypasses,
    notes,
  };
}

/**
 * Produce a short Turkish lesson. Always returns something; never throws.
 */
export function generateLesson(ctx: ClosedTradeContext): Lesson {
  const outcome = classifyOutcome(ctx.pnl);
  const bypasses = ctx.bypassedRiskGates ?? [];
  const tags: string[] = [];
  const dir = ctx.direction;
  const pnlPct = typeof ctx.pnlPercent === "number" ? `${ctx.pnlPercent.toFixed(2)}%` : "—";
  const exit = ctx.exitReason === "take_profit" ? "TP" : ctx.exitReason === "stop_loss" ? "SL" : (ctx.exitReason ?? "—");

  let body: string;

  if (outcome === "win") {
    if (bypasses.includes("market_quality_bypass")) {
      tags.push("market_quality", "win");
      body = `${ctx.symbol} ${dir} pozisyonu market quality bypass edilerek açıldı ve ${exit} ile kapandı (PnL ${pnlPct}). Bu sembolde quality cezası fazla sert çalışmış olabilir; kalibrasyon için aday.`;
    } else if (bypasses.includes("btc_filter_bypass")) {
      tags.push("btc_filter", "win");
      body = `${ctx.symbol} ${dir} BTC filtresi bypass edilerek açıldı ve ${exit} ile kapandı (PnL ${pnlPct}). BTC yön uyumu zorunlu görünmüyor; soft penalty yeterli.`;
    } else if (bypasses.some((b) => b.startsWith("risk:"))) {
      tags.push("risk_engine", "win");
      body = `${ctx.symbol} ${dir} risk engine itirazlarına rağmen ${exit} ile kapandı (PnL ${pnlPct}). Bypass edilen kurallar: ${bypasses.filter((b) => b.startsWith("risk:")).join(", ")}.`;
    } else if (bypasses.length > 0) {
      tags.push("multi_bypass", "win");
      body = `${ctx.symbol} ${dir} bypass'lı (${bypasses.join(", ")}) açıldı, ${exit} ile kapandı (PnL ${pnlPct}). Pozitif sonuç — bypass haklı çıktı.`;
    } else {
      tags.push("no_bypass", "win");
      body = `${ctx.symbol} ${dir} normal kurallarla açıldı, ${exit} ile kapandı (PnL ${pnlPct}). Standart kazanım.`;
    }
  } else if (outcome === "loss") {
    if (bypasses.includes("btc_filter_bypass")) {
      tags.push("btc_filter", "loss");
      body = `${ctx.symbol} ${dir} BTC filtresi bypass edildi ve ${exit} ile kapandı (PnL ${pnlPct}). BTC yön uyumsuzluğu gerçek risk üretti — filtre haklıydı.`;
    } else if (bypasses.includes("market_quality_bypass")) {
      tags.push("market_quality", "loss");
      body = `${ctx.symbol} ${dir} düşük quality (orig=${ctx.originalMarketQualityScore ?? "?"}) ile açıldı ve ${exit} ile kapandı (PnL ${pnlPct}). Quality bypass burada riskliydi.`;
    } else if (bypasses.some((b) => b.startsWith("risk:"))) {
      tags.push("risk_engine", "loss");
      body = `${ctx.symbol} ${dir} risk engine itirazı bypass edildi ve ${exit} ile kapandı (PnL ${pnlPct}). Risk uyarıları doğruydu.`;
    } else if (bypasses.length > 0) {
      tags.push("multi_bypass", "loss");
      body = `${ctx.symbol} ${dir} bypass'lı (${bypasses.join(", ")}) açıldı, ${exit} ile kapandı (PnL ${pnlPct}). Bypass'lar doğrulandı — gate'ler korunmalı.`;
    } else {
      tags.push("no_bypass", "loss");
      body = `${ctx.symbol} ${dir} normal kurallarla açıldı, ${exit} ile kapandı (PnL ${pnlPct}). Sinyalin kendi kalitesi sorgulanmalı.`;
    }
  } else {
    tags.push("breakeven");
    body = `${ctx.symbol} ${dir} breakeven kapandı (${exit}, PnL ${pnlPct}). Sonuç belirsiz; daha fazla örnek gerekiyor.`;
  }

  if (ctx.generatedFallbackSlTp) {
    tags.push("fallback_sl_tp");
  }

  return { text: body, tags, outcome };
}

/**
 * Aggregate stats from a list of analyzed outcomes — used by dashboard.
 */
export interface BypassStats {
  bypass: string;
  total: number;
  wins: number;
  losses: number;
  winRate: number;  // 0-1
}

export function summarizeByBypass(
  records: Array<{ bypassedRiskGates?: string[] | null; outcome: "win" | "loss" | "breakeven" }>,
): BypassStats[] {
  const map = new Map<string, { total: number; wins: number; losses: number }>();
  for (const r of records) {
    const bps = r.bypassedRiskGates ?? [];
    for (const b of bps) {
      const cur = map.get(b) ?? { total: 0, wins: 0, losses: 0 };
      cur.total += 1;
      if (r.outcome === "win") cur.wins += 1;
      else if (r.outcome === "loss") cur.losses += 1;
      map.set(b, cur);
    }
  }
  const out: BypassStats[] = [];
  for (const [bypass, s] of map.entries()) {
    const decided = s.wins + s.losses;
    out.push({
      bypass,
      total: s.total,
      wins: s.wins,
      losses: s.losses,
      winRate: decided > 0 ? s.wins / decided : 0,
    });
  }
  out.sort((a, b) => b.total - a.total);
  return out;
}
