// AI Aksiyon Merkezi — Faz 6: Kod Aksiyonu / Prompt Üretim Merkezi.
//
// Bu modül "uygulamaz" — yalnızca Claude Code / Codex'e verilebilecek
// güvenli prompt'lar üretir, uygun aracı önerir, zorunlu safety bloğunu
// her promptta yer aldığını garanti eder.
//
// MUTLAK KURALLAR:
//   • DB write yok. Risk ayarına dokunmaz.
//   • Binance API çağrısı yok.
//   • Promptun içinde live trading açma talimatı OLMAZ.
//   • /fapi/v1/order veya /fapi/v1/leverage referansı OLMAZ.
//   • HARD_LIVE_TRADING_ALLOWED bayrağını aktive etme talimatı OLMAZ.
//   • MIN_SIGNAL_CONFIDENCE düşürme, BTC trend kapatma talimatı OLMAZ.
//   • Force/aggressive/learning bypass açma talimatı OLMAZ.
//   • Üretilen prompt'un tamamı asla bot_logs metadata'sına yazılmaz —
//     sadece promptId / target / scope / promptLength gibi güvenli alanlar.

import {
  ALLOWED_ACTION_TYPES,
  FORBIDDEN_ACTION_TYPES,
  type ActionPlan,
  type ActionPlanType,
} from "./types";

export type CodePromptTarget = "claude_code" | "codex";

export type CodePromptScope =
  | "ui_patch"
  | "backend_patch"
  | "worker_patch"
  | "risk_settings_review"
  | "data_analysis"
  | "test_fix"
  | "safety_audit";

export interface CodePromptRequest {
  planId: string;
  actionType: ActionPlanType | string;
  target: CodePromptTarget;
  scope: CodePromptScope;
  includeSafetyChecklist: true;
  includeDeployChecklist: true;
}

export interface CodePromptResult {
  ok: true;
  promptId: string;
  target: CodePromptTarget;
  scope: CodePromptScope;
  title: string;
  prompt: string;
  safetyChecklist: readonly string[];
  deployChecklist: readonly string[];
  generatedAt: string;
  /**
   * UI'da gösterilecek bilgilendirme. Apply edilebilir tipler için
   * "Bu aksiyon sistem içinde uygulanabilir; prompt yalnızca manuel
   * inceleme içindir." notu döner.
   */
  applicabilityNote: string | null;
}

export const CODE_PROMPT_TARGETS: readonly CodePromptTarget[] = [
  "claude_code",
  "codex",
] as const;

export const CODE_PROMPT_SCOPES: readonly CodePromptScope[] = [
  "ui_patch",
  "backend_patch",
  "worker_patch",
  "risk_settings_review",
  "data_analysis",
  "test_fix",
  "safety_audit",
] as const;

/**
 * Faz 3'te apply edilebilir tipler — "sistem içinde uygulanabilir" notu
 * için. Diğer tipler (REQUEST_MANUAL_REVIEW, CREATE_IMPLEMENTATION_PROMPT)
 * doğrudan prompt amaçlıdır.
 */
const APPLY_CAPABLE_TYPES: readonly string[] = [
  "UPDATE_RISK_PER_TRADE_DOWN",
  "UPDATE_MAX_DAILY_LOSS_DOWN",
  "UPDATE_MAX_OPEN_POSITIONS_DOWN",
  "UPDATE_MAX_DAILY_TRADES_DOWN",
  "SET_OBSERVATION_MODE",
];

const SCOPE_LABEL: Record<CodePromptScope, string> = {
  ui_patch: "UI Patch",
  backend_patch: "Backend Patch",
  worker_patch: "Worker Patch",
  risk_settings_review: "Risk İnceleme",
  data_analysis: "Veri Analizi",
  test_fix: "Test Fix",
  safety_audit: "Güvenlik Denetimi",
};

const TARGET_LABEL: Record<CodePromptTarget, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
};

export function getCodePromptScopeLabel(scope: CodePromptScope): string {
  return SCOPE_LABEL[scope];
}

export function getCodePromptTargetLabel(target: CodePromptTarget): string {
  return TARGET_LABEL[target];
}

/** Zorunlu safety bloğu — her promptta yer alır. */
export const PROMPT_SAFETY_CHECKLIST: readonly string[] = [
  "Live trading açma. HARD_LIVE_TRADING_ALLOWED=false korunmalı.",
  "DEFAULT_TRADING_MODE=paper kalacak.",
  "enable_live_trading=false kalacak.",
  "openLiveOrder fonksiyonu LIVE_EXECUTION_NOT_IMPLEMENTED döndürmeye devam edecek.",
  "/fapi/v1/order veya /fapi/v1/leverage çağrısı eklenmeyecek.",
  "Binance canlı emir gönderme kodu eklenmeyecek.",
  "MIN_SIGNAL_CONFIDENCE=70 düşürülmeyecek.",
  "BTC trend filtresi kapatılmayacak.",
  "Force / aggressive / learning bypass modları açılmayacak (active=false korunacak).",
  "Risk ayarları otomatik artırılmayacak; sadece kullanıcı onayıyla düşürme yönünde değişebilir.",
  "Kaldıraç (leverage) artırılmayacak.",
  "SL/TP algoritması otomatik değiştirilmeyecek.",
  "API key / secret / token / authorization / bearer değerleri loglanmayacak veya commit'lenmeyecek.",
] as const;

export const PROMPT_DEPLOY_CHECKLIST: readonly string[] = [
  "npm run typecheck — type hatası olmamalı.",
  "npm test — ilgili test paketleri yeşil olmalı.",
  "npm run build — production build başarılı olmalı.",
  "Anlamlı bir commit mesajı ile commit + git push origin main.",
  "GitHub Actions workflow yeşilse otomatik deploy izlenir; yol filtresi eşleşmiyorsa gh workflow run deploy-worker.yml ile manuel tetikle.",
  "Vercel deploy: https://coin.onursuay.com erişilebilir olmalı.",
  "VPS heartbeat: https://coin.onursuay.com/api/bot/heartbeat → online:true ve status:running_paper.",
  "Live safety: HARD_LIVE_TRADING_ALLOWED=false ve trading_mode=paper doğrulanmalı.",
] as const;

const DEFAULT_DONT_TOUCH: readonly string[] = [
  "worker/** trade-open mantığı (mevcut paper akışı korunmalı).",
  "src/lib/engines/risk-engine.ts gating sıkılığı düşürülmemeli.",
  "src/lib/engines/signal-engine.ts skor formülü gevşetilmemeli.",
  "openLiveOrder(...) fonksiyonu LIVE_EXECUTION_NOT_IMPLEMENTED olarak kalmalı.",
  "Bot settings live trading toggle'ları (trading_mode, enable_live_trading) değiştirilmemeli.",
  "HARD_LIVE_TRADING_ALLOWED bayrağı false değerinde kalmalı; .env / process.env üzerinden açılmamalı.",
];

// ── Tool selection helper ────────────────────────────────────────────────────

/**
 * Deterministic tool önerisi. UI'da "Önerilen Araç: Claude Code / Codex"
 * olarak gösterilir; kullanıcı manuel olarak değiştirebilir.
 *
 * Codex tarafı:
 *   • UI polish, küçük frontend patch
 *   • label/text/filter
 *   • test-only değişiklikler
 *   • basit CSS/layout
 *
 * Claude Code tarafı:
 *   • route/API/backend
 *   • worker/engine
 *   • risk settings inceleme
 *   • çok dosyalı mimari
 *   • safety audit
 *   • deploy/heartbeat doğrulama
 */
export function recommendPromptTarget(
  plan: Pick<ActionPlan, "type" | "riskLevel"> | null,
  scope: CodePromptScope,
): CodePromptTarget {
  switch (scope) {
    case "ui_patch":
      return "codex";
    case "test_fix":
      // test-only değişiklik küçükse Codex; safety/critical risk'liyse Claude.
      if (plan?.riskLevel === "critical" || plan?.riskLevel === "high") {
        return "claude_code";
      }
      return "codex";
    case "backend_patch":
    case "worker_patch":
    case "risk_settings_review":
    case "data_analysis":
    case "safety_audit":
      return "claude_code";
    default:
      return "claude_code";
  }
}

// ── Prompt ID üretimi ────────────────────────────────────────────────────────

let __counter = 0;
function nextSeq(): string {
  __counter = (__counter + 1) % 1_000_000;
  return __counter.toString(36).padStart(4, "0");
}

function rand6(): string {
  // Kriptografik garantiye gerek yok — collision olasılığı düşük olsun yeter.
  return Math.random().toString(36).slice(2, 8);
}

function buildPromptId(planId: string, target: CodePromptTarget): string {
  const t = Date.now().toString(36);
  const seed = planId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24) || "plan";
  return `prm:${target}:${seed}:${t}:${nextSeq()}${rand6()}`;
}

// ── Prompt builder ───────────────────────────────────────────────────────────

interface BuildArgs {
  request: CodePromptRequest;
  plan: ActionPlan;
}

/**
 * Verilen ActionPlan + (target, scope) için tam prompt üretir.
 *
 * Yapı:
 *   - Başlık
 *   - Amaç
 *   - Kapsam
 *   - Dokunulmayacak alanlar
 *   - Yapılacaklar
 *   - Test/build
 *   - Commit/deploy
 *   - Çıktı raporu
 *   - Güvenlik kuralları (zorunlu safety block)
 */
export function buildCodePrompt(args: BuildArgs): CodePromptResult {
  const { request, plan } = args;
  const generatedAt = new Date().toISOString();
  const promptId = buildPromptId(plan.id, request.target);
  const targetLabel = TARGET_LABEL[request.target];
  const scopeLabel = SCOPE_LABEL[request.scope];

  const title = scopeTitle(plan, request.scope);

  const lines: string[] = [];
  lines.push(`# ${targetLabel} Görevi — ${title}`);
  lines.push("");
  lines.push(`**Plan ID:** ${plan.id}`);
  lines.push(`**Aksiyon Tipi:** ${plan.type}`);
  lines.push(`**Hedef Araç:** ${targetLabel}`);
  lines.push(`**Kapsam:** ${scopeLabel}`);
  lines.push(`**Risk Seviyesi:** ${plan.riskLevel}`);
  lines.push(`**Üretilme Zamanı:** ${generatedAt}`);
  lines.push("");

  lines.push(`## 1. Amaç`);
  lines.push(scopePurpose(plan, request.scope));
  lines.push("");

  lines.push(`## 2. Kapsam`);
  lines.push(scopeBody(plan, request.scope));
  if (plan.currentValue || plan.recommendedValue) {
    lines.push("");
    lines.push(`Mevcut değer: ${plan.currentValue ?? "—"}`);
    lines.push(`Önerilen değer (gözlem amaçlı): ${plan.recommendedValue ?? "—"}`);
  }
  lines.push("");

  lines.push(`## 3. Dokunulmayacak Alanlar`);
  for (const item of DEFAULT_DONT_TOUCH) {
    lines.push(`- ${item}`);
  }
  lines.push("");

  lines.push(`## 4. Yapılacaklar`);
  for (const step of scopeTodos(plan, request.scope)) {
    lines.push(`- ${step}`);
  }
  lines.push("");

  lines.push(`## 5. Test / Build`);
  lines.push("- npm run typecheck");
  lines.push("- npm test (ilgili paketler en azından)");
  lines.push("- npm run build");
  lines.push("");

  lines.push(`## 6. Commit / Deploy`);
  for (const item of PROMPT_DEPLOY_CHECKLIST) {
    lines.push(`- ${item}`);
  }
  lines.push("");

  lines.push(`## 7. Çıktı Raporu`);
  lines.push(`Yanıtında şu bilgileri ver:`);
  lines.push(`- Değiştirilen dosyalar`);
  lines.push(`- Eklenen / silinen satır sayısı`);
  lines.push(`- Yeni / güncellenen testler ve sonuçları`);
  lines.push(`- Typecheck / build sonucu`);
  lines.push(`- Commit hash`);
  lines.push(`- Deploy / heartbeat doğrulama sonucu`);
  lines.push(`- Live safety doğrulama (HARD_LIVE_TRADING_ALLOWED=false, trading_mode=paper)`);
  lines.push("");

  lines.push(`## 8. Güvenlik Kuralları (asla ihlal etme)`);
  for (const item of PROMPT_SAFETY_CHECKLIST) {
    lines.push(`- ${item}`);
  }
  lines.push("");

  lines.push(
    `Bu prompt yalnızca yorum/inceleme amaçlıdır. Yukarıdaki güvenlik kurallarını ihlal eden hiçbir kod değişikliği üretme.`,
  );

  const applicabilityNote = APPLY_CAPABLE_TYPES.includes(plan.type)
    ? "Bu aksiyon sistem içinde uygulanabilir; prompt yalnızca manuel inceleme içindir."
    : null;

  return {
    ok: true,
    promptId,
    target: request.target,
    scope: request.scope,
    title,
    prompt: lines.join("\n"),
    safetyChecklist: PROMPT_SAFETY_CHECKLIST,
    deployChecklist: PROMPT_DEPLOY_CHECKLIST,
    generatedAt,
    applicabilityNote,
  };
}

// ── Scope-specific copy ──────────────────────────────────────────────────────

function scopeTitle(plan: ActionPlan, scope: CodePromptScope): string {
  switch (scope) {
    case "ui_patch":
      return `${plan.title} — UI inceleme/patch`;
    case "backend_patch":
      return `${plan.title} — Backend inceleme/patch`;
    case "worker_patch":
      return `${plan.title} — Worker inceleme`;
    case "risk_settings_review":
      return `${plan.title} — Risk ayarı incelemesi`;
    case "data_analysis":
      return `${plan.title} — Veri analizi`;
    case "test_fix":
      return `${plan.title} — Test düzeltmesi`;
    case "safety_audit":
      return `${plan.title} — Güvenlik denetimi`;
    default:
      return plan.title;
  }
}

function scopePurpose(plan: ActionPlan, scope: CodePromptScope): string {
  const base = plan.summary || plan.title;
  switch (scope) {
    case "ui_patch":
      return `Aşağıdaki AI Aksiyon Merkezi önerisini /ai-actions UI'sında daha anlaşılır hale getir veya gerekli görsel iyileştirmeyi yap. ${base}`;
    case "backend_patch":
      return `Aşağıdaki öneriyi karşılayacak backend (route / lib) iyileştirmesini incele ve gereken patch'i hazırla. ${base}`;
    case "worker_patch":
      return `Worker (VPS) tarafında yalnızca veri/paper akışı kapsamında inceleme/patch hazırla. Trade-open mantığı ve canlı emir akışı kesinlikle değiştirilmemeli. ${base}`;
    case "risk_settings_review":
      return `Risk ayarlarının mevcut performansa göre incelenmesi. Sadece düşürme yönünde öneri üret; kullanıcı onayı zorunlu. ${base}`;
    case "data_analysis":
      return `Sorunu çözmek için ilgili paper trade / log verilerini analiz et ve raporla. Kod değişikliği gerekmeyebilir. ${base}`;
    case "test_fix":
      return `İlgili test paketinde kırılan veya eksik test'leri düzelt. Üretim mantığı değişmiyor; yalnızca test kalitesi artırılıyor. ${base}`;
    case "safety_audit":
      return `Güvenlik denetimi: live trading kilitleri, paper-only akış, prompt güvenliği ve secret leakage kontrolü. ${base}`;
    default:
      return base;
  }
}

function scopeBody(plan: ActionPlan, scope: CodePromptScope): string {
  const reason = plan.reason || plan.summary;
  switch (scope) {
    case "ui_patch":
      return `Kapsam: src/app/** ve src/components/** içinde küçük UI patch. ${reason}`;
    case "backend_patch":
      return `Kapsam: src/app/api/** ve src/lib/** ihtiyaç olan route/handler. ${reason}`;
    case "worker_patch":
      return `Kapsam: worker/** veya src/lib/engines/** içinde sadece okuma/log akışı. Trade-open mantığı ve openLiveOrder dokunulmaz. ${reason}`;
    case "risk_settings_review":
      return `Kapsam: src/lib/risk-settings/** + dashboard kayıtları. Sadece düşürme yönünde öneri. ${reason}`;
    case "data_analysis":
      return `Kapsam: paper_trades / bot_logs / risk_events tablolarından sorgu. Kod patch'i gerekmeyebilir. ${reason}`;
    case "test_fix":
      return `Kapsam: src/__tests__/** içinde mevcut test'leri düzelt veya yenisini ekle. ${reason}`;
    case "safety_audit":
      return `Kapsam: HARD_LIVE_TRADING_ALLOWED, openLiveOrder, /fapi/v1/order, /fapi/v1/leverage referanslarının yokluğu; bot_settings live toggle'ları; prompt güvenlik bloğunun korunması. ${reason}`;
    default:
      return reason;
  }
}

function scopeTodos(plan: ActionPlan, scope: CodePromptScope): string[] {
  switch (scope) {
    case "ui_patch":
      return [
        "İlgili sayfayı/bileşeni dikkatlice oku.",
        "Küçük, lokal patch uygula; geniş refactor yapma.",
        `Kullanıcıya ${plan.title} hakkında daha net bilgi göster.`,
        "Erişilebilirlik (kontrast, klavye) bozulmamalı.",
      ];
    case "backend_patch":
      return [
        "İlgili route ve lib dosyalarını incele.",
        "Plan tipine göre minimum patch hazırla; risk artırma yapma.",
        "Tüm DB yazımları audit log + verify SELECT akışını korumalı.",
      ];
    case "worker_patch":
      return [
        "worker/** içindeki ana döngüyü değiştirme.",
        "Yalnızca observability/log iyileştirmesi yap.",
        "Trade-open ve live order yolu sabit kalmalı.",
      ];
    case "risk_settings_review":
      return [
        `Mevcut değer (${plan.currentValue ?? "—"}) ve önerilen değer (${plan.recommendedValue ?? "—"}) için gerekçeyi raporla.`,
        "Yalnızca düşürme yönünde değer öner; artırma yok.",
        "AI Aksiyon Merkezi 'Uygula' akışı zaten mevcut — kullanıcı manuel tetikleyecek.",
      ];
    case "data_analysis":
      return [
        "İlgili paper_trades / bot_logs sorgularını çalıştır.",
        "Bulguları rakamsal özetle (kazanma oranı, profit factor, drawdown vb.).",
        "Kod değişikliği önermek zorunda değilsin.",
      ];
    case "test_fix":
      return [
        "Kırılan testin sebebini belirle.",
        "Test'i düzelt veya yeni bir koruyucu test ekle.",
        "Üretim mantığını değiştirme; yalnızca test kalitesini artır.",
      ];
    case "safety_audit":
      return [
        "HARD_LIVE_TRADING_ALLOWED bayrağının yanlışlıkla aktive edilmediğini grep'le doğrula (false bekleniyor).",
        "Binance private futures emir endpoint'lerine (order / leverage) referans olmadığını doğrula.",
        "openLiveOrder fonksiyonunun LIVE_EXECUTION_NOT_IMPLEMENTED döndürdüğünü doğrula.",
        "Prompt safety bloğunun her promptta üretildiğini doğrula.",
        "Audit log'ta tam prompt içeriği yer almadığını doğrula.",
      ];
    default:
      return ["Manuel inceleme."];
  }
}

// ── Validation (endpoint için) ───────────────────────────────────────────────

export type PromptValidationCode =
  | "CONFIRMATION_REQUIRED"
  | "PLAN_NOT_FOUND"
  | "PLAN_BLOCKED"
  | "FORBIDDEN_ACTION"
  | "ACTION_NOT_ALLOWED"
  | "INVALID_TARGET"
  | "INVALID_SCOPE";

export interface PromptValidationFailure {
  ok: false;
  code: PromptValidationCode;
  message: string;
}

export interface PromptValidationSuccess {
  ok: true;
  request: CodePromptRequest;
  plan: ActionPlan;
}

export type PromptValidation =
  | PromptValidationSuccess
  | PromptValidationFailure;

interface ValidateArgs {
  body: {
    planId: string;
    target?: string;
    scope?: string;
    confirmGenerate: unknown;
  };
  plans: readonly ActionPlan[];
}

/**
 * Endpoint girişinde tüm guard'ları sırasıyla uygular. Sonuç:
 *   1. confirmGenerate true değilse  → CONFIRMATION_REQUIRED.
 *   2. planId aktif planlarda yoksa  → PLAN_NOT_FOUND.
 *   3. plan generator tarafından bloke ise → PLAN_BLOCKED.
 *   4. actionType FORBIDDEN_ACTION_TYPES ise → FORBIDDEN_ACTION.
 *   5. actionType ALLOWED listesinde değilse → ACTION_NOT_ALLOWED.
 *   6. Geçersiz target/scope sanitize edilir; tamamen geçersizse default'a düşülür.
 */
export function validatePromptRequest(args: ValidateArgs): PromptValidation {
  const { body, plans } = args;
  if (body.confirmGenerate !== true) {
    return {
      ok: false,
      code: "CONFIRMATION_REQUIRED",
      message:
        "İkinci onay alınmadı: confirmGenerate=true gerekir.",
    };
  }
  const plan = plans.find((p) => p.id === body.planId);
  if (!plan) {
    return {
      ok: false,
      code: "PLAN_NOT_FOUND",
      message:
        "Bu plan artık aktif değil; güncel öneri listesinde bulunamadı.",
    };
  }
  if (!plan.allowed) {
    return {
      ok: false,
      code: "PLAN_BLOCKED",
      message:
        plan.blockedReason ??
        "Plan generator tarafından bloke; prompt üretilmez.",
    };
  }
  if ((FORBIDDEN_ACTION_TYPES as readonly string[]).includes(plan.type)) {
    return {
      ok: false,
      code: "FORBIDDEN_ACTION",
      message: "Bu aksiyon tipi açıkça yasak; prompt üretilmez.",
    };
  }
  if (!(ALLOWED_ACTION_TYPES as readonly string[]).includes(plan.type)) {
    return {
      ok: false,
      code: "ACTION_NOT_ALLOWED",
      message: "Aksiyon tipi izinli liste dışı.",
    };
  }

  const target = sanitizeTarget(body.target);
  const scope = sanitizeScope(body.scope, plan);

  return {
    ok: true,
    plan,
    request: {
      planId: plan.id,
      actionType: plan.type as ActionPlanType,
      target,
      scope,
      includeSafetyChecklist: true,
      includeDeployChecklist: true,
    },
  };
}

function sanitizeTarget(raw: unknown): CodePromptTarget {
  if (typeof raw === "string" && (CODE_PROMPT_TARGETS as readonly string[]).includes(raw)) {
    return raw as CodePromptTarget;
  }
  return "claude_code";
}

function sanitizeScope(raw: unknown, plan: ActionPlan): CodePromptScope {
  if (typeof raw === "string" && (CODE_PROMPT_SCOPES as readonly string[]).includes(raw)) {
    return raw as CodePromptScope;
  }
  return defaultScopeForPlan(plan);
}

/**
 * Plan tipine göre varsayılan scope.
 *   • SET_OBSERVATION_MODE / REQUEST_MANUAL_REVIEW → data_analysis.
 *   • UPDATE_*_DOWN → risk_settings_review.
 *   • CREATE_IMPLEMENTATION_PROMPT → backend_patch (genel).
 */
export function defaultScopeForPlan(plan: ActionPlan): CodePromptScope {
  switch (plan.type) {
    case "UPDATE_RISK_PER_TRADE_DOWN":
    case "UPDATE_MAX_DAILY_LOSS_DOWN":
    case "UPDATE_MAX_OPEN_POSITIONS_DOWN":
    case "UPDATE_MAX_DAILY_TRADES_DOWN":
      return "risk_settings_review";
    case "SET_OBSERVATION_MODE":
      return "data_analysis";
    case "REQUEST_MANUAL_REVIEW":
      return "safety_audit";
    case "CREATE_IMPLEMENTATION_PROMPT":
      return "backend_patch";
    default:
      return "data_analysis";
  }
}
