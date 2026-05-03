const EXIT_REASON_LABELS: Record<string, string> = {
  take_profit: "KÂR AL",
  stop_loss: "ZARAR DURDUR",
  manual: "MANUEL KAPATMA",
  manual_profit_close: "KÂRDA KAPATILDI",
  manual_loss_close: "ZARARDA KAPATILDI",
  manual_break_even_close: "BAŞABAŞ KAPATILDI",
  manual_stale_profit_close: "SÜRE AŞIMI · KÂRDA KAPATILDI",
  manual_stale_loss_close: "SÜRE AŞIMI · ZARARDA KAPATILDI",
  manual_stale_break_even_close: "SÜRE AŞIMI · BAŞABAŞ KAPATILDI",
};

export type ExitReasonTone = "success" | "danger" | "neutral";

export function normalizeExitReason(reason: unknown): string {
  return String(reason ?? "").trim().toLowerCase();
}

export function mapExitReasonLabel(reason: unknown): string {
  const key = normalizeExitReason(reason);
  return EXIT_REASON_LABELS[key] ?? "BİLİNMİYOR";
}

export function mapExitReasonTone(reason: unknown): ExitReasonTone {
  const key = normalizeExitReason(reason);
  if (key === "take_profit" || key.includes("_profit_")) return "success";
  if (key === "stop_loss" || key.includes("_loss_")) return "danger";
  return "neutral";
}
