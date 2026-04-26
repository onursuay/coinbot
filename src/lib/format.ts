export const fmtNum = (n: number | null | undefined, digits = 2) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
};
export const fmtUsd = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : `$${fmtNum(n, digits)}`;
export const fmtPct = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : `${fmtNum(n, digits)}%`;
export const fmtPrice = (n: number | null | undefined) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (n >= 1000) return fmtNum(n, 2);
  if (n >= 1) return fmtNum(n, 4);
  return fmtNum(n, 6);
};
