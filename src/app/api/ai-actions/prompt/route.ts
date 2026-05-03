// AI Aksiyon Merkezi — Faz 6: POST /api/ai-actions/prompt
//
// Claude Code / Codex'e verilebilecek güvenli uygulama promptu üretir.
//
// MUTLAK KURALLAR:
//   • DB write yok (audit log dışında).
//   • Risk ayarına dokunmaz.
//   • Binance API çağrısı yapmaz.
//   • Üretilen prompt tamamı bot_logs metadata'sına yazılmaz —
//     sadece promptId / target / scope / promptLength gibi güvenli
//     metadata yazılır.
//   • confirmGenerate !== true  → CONFIRMATION_REQUIRED.
//   • planId aktif planlarda yoksa → PLAN_NOT_FOUND.
//   • Yasak action type → FORBIDDEN_ACTION.
//   • allowed=false plan → PLAN_BLOCKED.
//
// Audit log eventleri:
//   • ai_action_prompt_requested
//   • ai_action_prompt_generated
//   • ai_action_prompt_blocked
//   • ai_action_prompt_failed

import { z } from "zod";
import { ok, fail, parseBody, isResponse } from "@/lib/api-helpers";
import { getCurrentUserId } from "@/lib/auth";
import { botLog } from "@/lib/logger";
import {
  buildCodePrompt,
  validatePromptRequest,
  CODE_PROMPT_SCOPES,
  CODE_PROMPT_TARGETS,
} from "@/lib/ai-actions";
import { buildAIActionsResult } from "@/lib/ai-actions/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  planId: z.string().min(1),
  target: z
    .enum([CODE_PROMPT_TARGETS[0], ...CODE_PROMPT_TARGETS.slice(1)] as [
      string,
      ...string[],
    ])
    .optional(),
  scope: z
    .enum([CODE_PROMPT_SCOPES[0], ...CODE_PROMPT_SCOPES.slice(1)] as [
      string,
      ...string[],
    ])
    .optional(),
  confirmGenerate: z.boolean(),
});

export async function POST(req: Request) {
  const parsed = await parseBody(req, Body);
  if (isResponse(parsed)) return parsed;

  const userId = getCurrentUserId();

  // ── Audit: prompt request kaydı ────────────────────────────────────────
  await botLog({
    userId,
    level: "info",
    eventType: "ai_action_prompt_requested",
    message: `prompt requested planId=${parsed.planId} target=${parsed.target ?? "auto"} scope=${parsed.scope ?? "auto"} confirm=${parsed.confirmGenerate}`,
    metadata: {
      planId: parsed.planId,
      target: parsed.target ?? null,
      scope: parsed.scope ?? null,
      confirmGenerate: parsed.confirmGenerate,
      source: "ai_action_center",
      timestamp: new Date().toISOString(),
    },
  });

  let plansResult;
  try {
    plansResult = await buildAIActionsResult(userId);
  } catch (e) {
    const errSafe =
      e instanceof Error ? e.message.slice(0, 200) : "snapshot error";
    await botLog({
      userId,
      level: "error",
      eventType: "ai_action_prompt_failed",
      message: `prompt snapshot failed planId=${parsed.planId}: ${errSafe}`,
      metadata: {
        planId: parsed.planId,
        target: parsed.target ?? null,
        scope: parsed.scope ?? null,
        source: "ai_action_center",
        error: errSafe,
        timestamp: new Date().toISOString(),
      },
    });
    return fail("Prompt üretimi sırasında hata oluştu.", 500, {
      code: "PROMPT_SNAPSHOT_FAILED",
    });
  }

  const validation = validatePromptRequest({
    body: {
      planId: parsed.planId,
      target: parsed.target,
      scope: parsed.scope,
      confirmGenerate: parsed.confirmGenerate,
    },
    plans: plansResult.plans,
  });

  if (!validation.ok) {
    await botLog({
      userId,
      level: "warn",
      eventType: "ai_action_prompt_blocked",
      message: `prompt blocked planId=${parsed.planId} code=${validation.code}: ${validation.message.slice(0, 200)}`,
      metadata: {
        planId: parsed.planId,
        target: parsed.target ?? null,
        scope: parsed.scope ?? null,
        source: "ai_action_center",
        code: validation.code,
        blockedReason: validation.code,
        timestamp: new Date().toISOString(),
      },
    });
    const httpStatus = validation.code === "PLAN_NOT_FOUND" ? 404 : 400;
    return fail(validation.message, httpStatus, { code: validation.code });
  }

  let result;
  try {
    result = buildCodePrompt({
      request: validation.request,
      plan: validation.plan,
    });
  } catch (e) {
    const errSafe =
      e instanceof Error ? e.message.slice(0, 200) : "build error";
    await botLog({
      userId,
      level: "error",
      eventType: "ai_action_prompt_failed",
      message: `prompt build failed planId=${parsed.planId}: ${errSafe}`,
      metadata: {
        planId: parsed.planId,
        target: validation.request.target,
        scope: validation.request.scope,
        source: "ai_action_center",
        error: errSafe,
        timestamp: new Date().toISOString(),
      },
    });
    return fail("Prompt üretimi başarısız.", 500, {
      code: "PROMPT_BUILD_FAILED",
    });
  }

  // ── Audit: prompt başarılı üretildi ────────────────────────────────────
  // Tam prompt içeriği bot_logs'a YAZILMAZ. Sadece güvenli metadata.
  await botLog({
    userId,
    level: "info",
    eventType: "ai_action_prompt_generated",
    message: `prompt generated planId=${parsed.planId} type=${validation.plan.type} target=${result.target} scope=${result.scope}`,
    metadata: {
      planId: parsed.planId,
      actionType: validation.plan.type,
      target: result.target,
      scope: result.scope,
      promptId: result.promptId,
      source: "ai_action_center",
      promptLength: result.prompt.length,
      safetyChecklistIncluded: true,
      deployChecklistIncluded: true,
      timestamp: new Date().toISOString(),
    },
  });

  return ok({
    code: "PROMPT_GENERATED",
    promptId: result.promptId,
    target: result.target,
    scope: result.scope,
    title: result.title,
    prompt: result.prompt,
    safetyChecklist: result.safetyChecklist,
    deployChecklist: result.deployChecklist,
    generatedAt: result.generatedAt,
    applicabilityNote: result.applicabilityNote,
  });
}
