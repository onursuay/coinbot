"use client";
// Phase 9 — Aksiyon kart altyapısı (ONAYLA / REDDET / GÖZLEM / PROMPT).
//
// Bu component sadece **aksiyon gerektiren** kartlarda kullanılır;
// her kartın altında otomatik olarak görünmez. Bu fazda hiçbir kritik
// ayarı değiştirmez — yalnızca lokal bir aksiyon callback alır ve
// kullanıcı seçimini parent'a iletir.
//
// SAFETY:
// - "ONAYLA" / "REDDET" yalnızca onAction callback'ini tetikler;
//   doğrudan trade engine, risk engine veya canlı gate ile bağı yoktur.
// - "GÖZLEM" 1 haftalık izleme niyetini ifade eder; storage burada
//   değil, parent component katmanında yönetilir.
// - "PROMPT" Claude Code / Codex'e iletilecek talimat hazırlamayı
//   simgeler; bu fazda yalnızca onAction("PROMPT") çağrısı yapar.
import { useState } from "react";

export type CardAction = "APPROVE" | "REJECT" | "OBSERVE" | "PROMPT";

export interface ActionFooterProps {
  /** Aksiyon kartının kısa kimliği (ör. "market-pulse-elevated-fomo"). */
  actionId: string;
  /** Parent'a hangi aksiyonun seçildiğini ileten callback. */
  onAction?: (action: CardAction, actionId: string) => void;
  /** Hangi butonların gösterileceği — varsayılan olarak hepsi görünür. */
  show?: Partial<Record<CardAction, boolean>>;
  /** "GÖZLEM" tıklandığında üstüne yazılacak gün sayısı. Varsayılan 7. */
  observeDays?: number;
}

const LABEL: Record<CardAction, string> = {
  APPROVE: "ONAYLA",
  REJECT: "REDDET",
  OBSERVE: "GÖZLEM",
  PROMPT: "PROMPT",
};

const ARIA_HINT: Record<CardAction, string> = {
  APPROVE: "Önerilen aksiyonu onayla",
  REJECT: "Önerilen aksiyonu reddet",
  OBSERVE: "Bir hafta gözlem altında tut",
  PROMPT: "Claude/Codex prompt taslağı oluştur (gelecek faz)",
};

function btnClass(kind: CardAction, selected: CardAction | null): string {
  const isSelected = selected === kind;
  const base = "text-[11px] font-medium px-3 py-1.5 rounded-md border transition-colors";
  if (isSelected) {
    if (kind === "APPROVE") return `${base} border-success bg-success/20 text-success`;
    if (kind === "REJECT")  return `${base} border-danger bg-danger/20 text-danger`;
    if (kind === "OBSERVE") return `${base} border-warning bg-warning/15 text-warning`;
    if (kind === "PROMPT")  return `${base} border-accent bg-accent/15 text-accent`;
  }
  return `${base} border-border bg-bg-soft text-slate-300 hover:border-accent hover:text-accent`;
}

export default function ActionFooter({
  actionId,
  onAction,
  show,
  observeDays = 7,
}: ActionFooterProps) {
  const [selected, setSelected] = useState<CardAction | null>(null);

  const visible: CardAction[] = (["APPROVE", "REJECT", "OBSERVE", "PROMPT"] as const).filter(
    (k) => show?.[k] !== false,
  );

  const trigger = (a: CardAction) => {
    setSelected(a);
    onAction?.(a, actionId);
  };

  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3"
      data-action-footer={actionId}
      role="group"
      aria-label="Aksiyon önerileri"
    >
      {visible.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => trigger(k)}
          className={btnClass(k, selected)}
          title={k === "OBSERVE" ? `${ARIA_HINT[k]} (${observeDays} gün)` : ARIA_HINT[k]}
          aria-label={ARIA_HINT[k]}
        >
          {LABEL[k]}
        </button>
      ))}
      {selected && (
        <span className="ml-auto text-[10px] uppercase tracking-wider text-muted">
          Seçildi: {LABEL[selected]}
        </span>
      )}
    </div>
  );
}
