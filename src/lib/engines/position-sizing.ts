// Faz 20 — Risk-based position sizing.
//
// Formula:
//   riskAmountUsdt       = totalBotCapitalUsdt * riskPerTradePercent / 100
//   stopDistancePercent  = |entryPrice - stopLoss| / entryPrice * 100
//   positionNotionalUsdt = riskAmountUsdt / (stopDistancePercent / 100)
//   quantity             = positionNotionalUsdt / entryPrice
//
// Leverage does NOT affect position sizing in this formula.
// Leverage is config-only metadata in this phase.

export interface PositionSizeInput {
  totalBotCapitalUsdt: number;
  riskPerTradePercent: number;
  entryPrice: number;
  stopLoss: number;
  side: "LONG" | "SHORT";
  symbol: string;
  minNotional?: number;
  maxNotional?: number;
}

export interface PositionSizeResult {
  riskAmountUsdt: number;
  stopDistancePercent: number;
  quantity: number;
  notionalUsdt: number;
  valid: boolean;
  reason?: string;
}

function invalid(reason: string): PositionSizeResult {
  return { riskAmountUsdt: 0, stopDistancePercent: 0, quantity: 0, notionalUsdt: 0, valid: false, reason };
}

export function calculatePositionSizeByRisk(input: PositionSizeInput): PositionSizeResult {
  if (!input.stopLoss || input.stopLoss <= 0) return invalid("stopLoss eksik veya geçersiz");
  if (!input.entryPrice || input.entryPrice <= 0) return invalid("entryPrice <= 0");

  const stopDistanceAbs = Math.abs(input.entryPrice - input.stopLoss);
  if (stopDistanceAbs <= 0) return invalid("Stop mesafesi sıfır");

  const stopDistancePercent = (stopDistanceAbs / input.entryPrice) * 100;
  if (!Number.isFinite(stopDistancePercent) || stopDistancePercent <= 0) {
    return invalid("Stop mesafesi yüzde hesaplanamadı");
  }

  const capital = input.totalBotCapitalUsdt;
  if (!capital || capital <= 0) {
    return invalid("capital_missing: totalBotCapitalUsdt tanımsız veya sıfır");
  }

  const riskAmountUsdt = (capital * input.riskPerTradePercent) / 100;
  if (!Number.isFinite(riskAmountUsdt) || riskAmountUsdt <= 0) {
    return invalid("riskAmountUsdt hesaplanamadı");
  }

  // positionNotionalUsdt = riskAmount / (stopDistPct / 100) = riskAmount * entry / stopDistAbs
  const notionalUsdt = riskAmountUsdt / (stopDistancePercent / 100);
  if (!Number.isFinite(notionalUsdt) || notionalUsdt <= 0) {
    return invalid("Pozisyon büyüklüğü hesaplanamadı (NaN/Infinity)");
  }

  if (input.minNotional !== undefined && notionalUsdt < input.minNotional) {
    return invalid(`Notional ${notionalUsdt.toFixed(2)} < minimum ${input.minNotional}`);
  }
  if (input.maxNotional !== undefined && notionalUsdt > input.maxNotional) {
    return invalid(`Notional ${notionalUsdt.toFixed(2)} > maksimum ${input.maxNotional}`);
  }

  const quantity = notionalUsdt / input.entryPrice;
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return invalid("Miktar hesaplanamadı");
  }

  return { riskAmountUsdt, stopDistancePercent, quantity, notionalUsdt, valid: true };
}
