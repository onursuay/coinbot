// Risk tier classification — symbol → tier-specific risk policy.
// TIER 1: BTC, ETH (most liquid, lower max leverage 3x).
// TIER 2: SOL, BNB, XRP, LTC (large-cap volatile, 2x).
// TIER 3: AVAX, LINK, ADA, DOGE (high-vol, 2x with stricter filters).
//
// DOGE always TIER 3 — never promoted regardless of market conditions.
//
// Dynamic downgrade: tier can be DOWNGRADED at runtime based on live market
// conditions (spread/depth/volatility), but never UPGRADED.

export type RiskTier = "TIER_1" | "TIER_2" | "TIER_3" | "REJECTED";

export interface TierPolicy {
  tier: RiskTier;
  maxLeverage: number;
  defaultLeverage: number;
  maxRiskPerTradePercent: number;
  minRiskRewardRatio: number;
  requireBtcDirectionFilter: boolean;
  maxSpreadPercent: number;       // %, e.g. 0.05 = 0.05%
  maxAtrPercent: number;          // %
  maxFundingRatePercent: number;  // %, abs value
  minOrderbookDepthUsdt: number;
  min24hVolumeUsdt: number;
}

// Canonical "BASE/QUOTE" symbol → tier mapping (UPPER, normalized).
// Symbols not listed are NOT whitelisted and cannot trade automatically.
const TIER_1: ReadonlySet<string> = new Set(["BTC/USDT", "ETH/USDT"]);
const TIER_2: ReadonlySet<string> = new Set(["SOL/USDT", "BNB/USDT", "XRP/USDT", "LTC/USDT"]);
const TIER_3: ReadonlySet<string> = new Set(["AVAX/USDT", "LINK/USDT", "ADA/USDT", "DOGE/USDT"]);

const TIER_1_POLICY: TierPolicy = {
  tier: "TIER_1",
  maxLeverage: 3,
  defaultLeverage: 2,
  maxRiskPerTradePercent: 1.0,
  minRiskRewardRatio: 2.0,
  requireBtcDirectionFilter: true,
  maxSpreadPercent: 0.03,
  maxAtrPercent: 4.0,
  maxFundingRatePercent: 0.05,
  minOrderbookDepthUsdt: 250_000,
  min24hVolumeUsdt: 100_000_000,
};

const TIER_2_POLICY: TierPolicy = {
  tier: "TIER_2",
  maxLeverage: 2,
  defaultLeverage: 2,
  maxRiskPerTradePercent: 0.75,
  minRiskRewardRatio: 2.2,
  requireBtcDirectionFilter: true,
  maxSpreadPercent: 0.05,
  maxAtrPercent: 5.0,
  maxFundingRatePercent: 0.05,
  minOrderbookDepthUsdt: 200_000,
  min24hVolumeUsdt: 50_000_000,
};

const TIER_3_POLICY: TierPolicy = {
  tier: "TIER_3",
  maxLeverage: 2,
  defaultLeverage: 1,
  maxRiskPerTradePercent: 0.5,
  // P0 bugfix: Engine üretiyor TP=dist*2.2 (RR=2.20). 2.5 isteyince sistem
  // kendi sinyalini reddediyordu (TIER_3 + tüm DYNAMIC adaylar). Paper-only
  // proje (live execution kalıcı kapalı); 2.0 profesyonel taban (CFA).
  minRiskRewardRatio: 2.0,
  requireBtcDirectionFilter: true,
  maxSpreadPercent: 0.07,
  maxAtrPercent: 6.0,
  maxFundingRatePercent: 0.04,
  minOrderbookDepthUsdt: 150_000,
  min24hVolumeUsdt: 30_000_000,
};

const REJECTED_POLICY: TierPolicy = {
  tier: "REJECTED",
  maxLeverage: 0,
  defaultLeverage: 0,
  maxRiskPerTradePercent: 0,
  minRiskRewardRatio: 999,
  requireBtcDirectionFilter: true,
  maxSpreadPercent: 0,
  maxAtrPercent: 0,
  maxFundingRatePercent: 0,
  minOrderbookDepthUsdt: Number.POSITIVE_INFINITY,
  min24hVolumeUsdt: Number.POSITIVE_INFINITY,
};

// Normalize symbol to canonical form. Accepts BTCUSDT, BTC/USDT, BTC-USDT, btc_usdt.
function normalize(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  if (s.includes("/")) return s;
  if (s.includes("-")) {
    const [b, q] = s.split("-");
    return `${b}/${q || "USDT"}`;
  }
  if (s.includes("_")) {
    const [b, q] = s.split("_");
    return `${b}/${q || "USDT"}`;
  }
  for (const q of ["USDT", "USDC", "USD", "BUSD"]) {
    if (s.endsWith(q)) return `${s.slice(0, -q.length)}/${q}`;
  }
  return s;
}

export function classifyTier(symbol: string): RiskTier {
  const norm = normalize(symbol);
  if (TIER_1.has(norm)) return "TIER_1";
  if (TIER_2.has(norm)) return "TIER_2";
  if (TIER_3.has(norm)) return "TIER_3";
  return "REJECTED";
}

export function getTierPolicy(tier: RiskTier): TierPolicy {
  switch (tier) {
    case "TIER_1": return TIER_1_POLICY;
    case "TIER_2": return TIER_2_POLICY;
    case "TIER_3": return TIER_3_POLICY;
    case "REJECTED": return REJECTED_POLICY;
  }
}

export function getPolicyForSymbol(symbol: string): TierPolicy {
  return getTierPolicy(classifyTier(symbol));
}

// Dynamic downgrade — applied at runtime based on live market conditions.
// Never upgrades; only downgrades or rejects.
export interface MarketSnapshot {
  spreadPercent: number;       // %
  atrPercent: number;          // %
  fundingRatePercent: number;  // %, abs
  orderbookDepthUsdt: number;
  volume24hUsdt: number;
  recentWickRatio?: number;    // 0..1
  pumpDumpFlag?: boolean;
  btcDirectionAligned?: boolean;
}

export interface TierDowngradeResult {
  originalTier: RiskTier;
  effectiveTier: RiskTier;
  downgraded: boolean;
  rejected: boolean;
  reasons: string[];
  policy: TierPolicy;
}

export function applyDynamicDowngrade(symbol: string, m: MarketSnapshot): TierDowngradeResult {
  const original = classifyTier(symbol);
  if (original === "REJECTED") {
    return {
      originalTier: original, effectiveTier: original,
      downgraded: false, rejected: true,
      reasons: ["Symbol not in whitelist"],
      policy: REJECTED_POLICY,
    };
  }

  const reasons: string[] = [];
  let effective = original;

  // DOGE locked at TIER_3 — no upgrade ever
  // (already enforced by classifyTier; this is just defense in depth)
  if (normalize(symbol) === "DOGE/USDT" && effective !== "TIER_3") {
    effective = "TIER_3";
    reasons.push("DOGE locked at TIER_3");
  }

  // TIER_1 with extreme volatility → reject (don't downgrade BTC/ETH; just refuse)
  if (effective === "TIER_1" && m.atrPercent > 6) {
    return {
      originalTier: original, effectiveTier: "REJECTED",
      downgraded: true, rejected: true,
      reasons: [`TIER_1 ATR aşırı yüksek (${m.atrPercent.toFixed(2)}%)`],
      policy: REJECTED_POLICY,
    };
  }

  // TIER_2 with deteriorated conditions → manage as TIER_3
  if (effective === "TIER_2") {
    if (m.spreadPercent > 0.07 || m.orderbookDepthUsdt < 200_000) {
      effective = "TIER_3";
      reasons.push("TIER_2 spread/depth zayıf — TIER_3 olarak yönetiliyor");
    }
  }

  // TIER_3 risk gates — reject outright if too risky
  if (effective === "TIER_3") {
    if (m.atrPercent > 6) {
      return {
        originalTier: original, effectiveTier: "REJECTED",
        downgraded: true, rejected: true,
        reasons: [...reasons, `TIER_3 ATR aşırı (${m.atrPercent.toFixed(2)}%)`],
        policy: REJECTED_POLICY,
      };
    }
    if (m.fundingRatePercent > 0.04) {
      return {
        originalTier: original, effectiveTier: "REJECTED",
        downgraded: true, rejected: true,
        reasons: [...reasons, `Funding rate yüksek (${m.fundingRatePercent.toFixed(3)}%)`],
        policy: REJECTED_POLICY,
      };
    }
    if (m.recentWickRatio !== undefined && m.recentWickRatio > 0.6) {
      return {
        originalTier: original, effectiveTier: "REJECTED",
        downgraded: true, rejected: true,
        reasons: [...reasons, `Aşırı wick/iğne mum`],
        policy: REJECTED_POLICY,
      };
    }
    if (m.pumpDumpFlag) {
      return {
        originalTier: original, effectiveTier: "REJECTED",
        downgraded: true, rejected: true,
        reasons: [...reasons, `Pump/dump algılandı`],
        policy: REJECTED_POLICY,
      };
    }
  }

  // BTC direction filter (all tiers)
  if (m.btcDirectionAligned === false) {
    return {
      originalTier: original, effectiveTier: "REJECTED",
      downgraded: true, rejected: true,
      reasons: [...reasons, `BTC yönü tersine`],
      policy: REJECTED_POLICY,
    };
  }

  return {
    originalTier: original, effectiveTier: effective,
    downgraded: effective !== original, rejected: false,
    reasons,
    policy: getTierPolicy(effective),
  };
}

export function tierWhitelist(): string[] {
  return [...TIER_1, ...TIER_2, ...TIER_3];
}

// Returns true if the symbol is approved for AUTOMATIC trading.
// Symbols outside the tier system can be analyzed but never traded automatically.
export function isAutoTradeAllowed(symbol: string): boolean {
  return classifyTier(symbol) !== "REJECTED";
}

// TIER_1 + TIER_2 symbols that must be analyzed in every scanner tick.
// TIER_3 symbols join the regular cursor rotation (still whitelisted, just not pinned).
export function getPrioritySymbols(): string[] {
  return [...TIER_1, ...TIER_2];
}
