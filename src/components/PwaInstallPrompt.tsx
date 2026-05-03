"use client";
import { useEffect, useState } from "react";

const DISMISSED_KEY = "pwa-install-dismissed";

export default function PwaInstallPrompt() {
  const [prompt, setPrompt] = useState<Event | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISSED_KEY)) return;
    } catch { /* ignore */ }

    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!visible || !prompt) return null;

  const dismiss = () => {
    setVisible(false);
    try { localStorage.setItem(DISMISSED_KEY, "1"); } catch { /* ignore */ }
  };

  const install = async () => {
    setVisible(false);
    // @ts-expect-error — BeforeInstallPromptEvent is non-standard
    await prompt.prompt?.();
    try { localStorage.setItem(DISMISSED_KEY, "1"); } catch { /* ignore */ }
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-accent/30 bg-bg-card px-4 py-3 shadow-lg">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-100">CoinBot&apos;u Yükle</div>
          <div className="text-xs text-muted">Ana ekrana ekle, uygulama gibi aç</div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="px-2 py-1 text-xs text-muted hover:text-slate-200 transition-colors"
            aria-label="Kapat"
          >
            ✕
          </button>
          <button
            type="button"
            onClick={install}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-accent/40 bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
          >
            Yükle
          </button>
        </div>
      </div>
    </div>
  );
}
