// AI Decision — güvenli fallback üretimi.
// API key yoksa veya AI çağrısı başarısız olursa dashboard kırılmasın diye
// her durumda tutarlı bir AIDecisionOutput üretir.

import {
  DEFAULT_OBSERVE_DAYS,
  type AIDecisionOutput,
  type AIFallbackReason,
} from "./types";

const REASON_MESSAGE: Record<AIFallbackReason, string> = {
  AI_UNCONFIGURED: "OpenAI API anahtarı tanımlı değil.",
  AI_TIMEOUT: "AI servisi zaman aşımına uğradı.",
  AI_PARSE_ERROR: "AI yanıtı geçerli formatta değildi.",
  AI_HTTP_ERROR: "AI servisinden hata yanıtı alındı.",
  AI_DISABLED: "AI değerlendirmesi devre dışı.",
};

export function buildFallbackOutput(reason: AIFallbackReason): AIDecisionOutput {
  const msg = REASON_MESSAGE[reason];
  return {
    status: "DATA_INSUFFICIENT",
    riskLevel: "LOW",
    mainFinding: msg,
    systemInterpretation:
      "AI değerlendirmesi şu an üretilemiyor; CoinBot mevcut karar destek kartlarıyla çalışmaya devam ediyor.",
    recommendation:
      "AI bağlantısı tekrar sağlandığında yorum güncellenir. Bu durum ayar değişikliği veya canlı trading'i etkilemez.",
    actionType: "DATA_INSUFFICIENT",
    confidence: 0,
    requiresUserApproval: false,
    observeDays: DEFAULT_OBSERVE_DAYS,
    blockedBy: [reason],
    suggestedPrompt: null,
    safetyNotes: [
      "Bu sonuç AI çağrısı yapılamadığı için fallback'tir.",
      "Live gate, risk ayarları ve trade engine bu sonuçtan etkilenmez.",
    ],
    appliedToTradeEngine: false,
  };
}
