"use client";
import { useEffect, useState } from "react";
import { COIN_SOURCE_LABEL, type ScanModesConfig } from "@/lib/scan-modes/types";

// Phase 1 — Tarama Modları sayfası.
// 3 mod kartı: Geniş Market Taraması, Momentum Taraması, Manuel İzleme Listesi.
// Sadece Aktif/Pasif kontrolü ve Manuel İzleme Listesi için sembol chip iskeleti.
// Bu sayfa scanner/sinyal/risk davranışını DEĞİŞTİRMEZ — yalnızca mod state'i yönetir.

export default function ScanModesPage() {
  const [config, setConfig] = useState<ScanModesConfig | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newSymbol, setNewSymbol] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/scan-modes").then((r) => r.json());
      if (res.ok) setConfig(res.data);
      else setError(res.error ?? "Tarama modları yüklenemedi");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggle = async (mode: "wideMarket" | "momentum" | "manualList", next: boolean) => {
    setBusy(mode);
    setError(null);
    try {
      const res = await fetch("/api/scan-modes", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [mode]: { active: next } }),
      }).then((r) => r.json());
      if (res.ok) setConfig(res.data);
      else setError(res.error ?? "Güncelleme başarısız");
    } finally {
      setBusy(null);
    }
  };

  const addSymbol = async () => {
    const sym = newSymbol.trim();
    if (!sym) return;
    setBusy("add");
    setError(null);
    try {
      const res = await fetch("/api/scan-modes/manual-list", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol: sym }),
      }).then((r) => r.json());
      if (res.ok) {
        setConfig(res.data);
        setNewSymbol("");
      } else setError(res.error ?? "Ekleme başarısız");
    } finally {
      setBusy(null);
    }
  };

  const removeSymbol = async (sym: string) => {
    setBusy(`rm:${sym}`);
    setError(null);
    try {
      const res = await fetch(`/api/scan-modes/manual-list?symbol=${encodeURIComponent(sym)}`, {
        method: "DELETE",
      }).then((r) => r.json());
      if (res.ok) setConfig(res.data);
      else setError(res.error ?? "Kaldırma başarısız");
    } finally {
      setBusy(null);
    }
  };

  if (!config) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Tarama Modları</h1>
        <div className="text-muted">Yükleniyor…</div>
        {error && <div className="text-danger text-sm">{error}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Tarama Modları</h1>
        <p className="text-sm text-muted">
          Coin seçim mimarisi — 3 bağımsız mod. Bu sayfadaki ayarlar yalnızca
          tarama evrenini etkiler; sinyal eşikleri, risk yönetimi ve canlı
          trading kapısı değişmez.
        </p>
      </header>

      {error && (
        <div className="card border-danger/40 text-danger text-sm">{error}</div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <ModeCard
          title="GENİŞ MARKET TARAMASI"
          shortLabel={COIN_SOURCE_LABEL.WIDE_MARKET}
          active={config.wideMarket.active}
          busy={busy === "wideMarket"}
          onToggle={(next) => toggle("wideMarket", next)}
        />
        <ModeCard
          title="MOMENTUM TARAMASI"
          shortLabel={COIN_SOURCE_LABEL.MOMENTUM}
          active={config.momentum.active}
          busy={busy === "momentum"}
          onToggle={(next) => toggle("momentum", next)}
        />
        <ModeCard
          title="MANUEL İZLEME LİSTESİ"
          shortLabel={COIN_SOURCE_LABEL.MANUAL_LIST}
          active={config.manualList.active}
          busy={busy === "manualList"}
          onToggle={(next) => toggle("manualList", next)}
        >
          <ManualListBody
            symbols={config.manualList.symbols}
            active={config.manualList.active}
            newSymbol={newSymbol}
            setNewSymbol={setNewSymbol}
            addSymbol={addSymbol}
            removeSymbol={removeSymbol}
            busy={busy}
          />
        </ModeCard>
      </div>
    </div>
  );
}

function ModeCard({
  title,
  shortLabel,
  active,
  busy,
  onToggle,
  children,
}: {
  title: string;
  shortLabel: string;
  active: boolean;
  busy: boolean;
  onToggle: (next: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <section className="card flex flex-col gap-4 min-h-[200px]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted">{shortLabel}</div>
          <h2 className="text-base font-semibold uppercase tracking-wide leading-tight mt-0.5">
            {title}
          </h2>
        </div>
        <Toggle active={active} busy={busy} onToggle={onToggle} />
      </div>
      <div className="text-xs text-muted">
        Durum: {active ? <span className="text-success">AKTİF</span> : <span className="text-warning">PASİF</span>}
      </div>
      {children && <div className="flex-1 flex flex-col">{children}</div>}
    </section>
  );
}

function Toggle({
  active,
  busy,
  onToggle,
}: {
  active: boolean;
  busy: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      disabled={busy}
      onClick={() => onToggle(!active)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        active ? "bg-success/80" : "bg-bg-soft border border-border"
      } ${busy ? "opacity-50 cursor-wait" : ""}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
          active ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function ManualListBody({
  symbols,
  active,
  newSymbol,
  setNewSymbol,
  addSymbol,
  removeSymbol,
  busy,
}: {
  symbols: string[];
  active: boolean;
  newSymbol: string;
  setNewSymbol: (s: string) => void;
  addSymbol: () => void;
  removeSymbol: (s: string) => void;
  busy: string | null;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5 min-h-[36px]">
        {symbols.length === 0 && (
          <div className="text-xs text-muted italic">Henüz coin eklenmedi</div>
        )}
        {symbols.map((s) => (
          <span
            key={s}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs ${
              active ? "border-accent/40 text-accent" : "border-border text-muted"
            }`}
          >
            {s}
            <button
              type="button"
              onClick={() => removeSymbol(s)}
              disabled={busy === `rm:${s}`}
              className="text-muted hover:text-danger transition-colors"
              aria-label={`${s} kaldır`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={newSymbol}
          onChange={(e) => setNewSymbol(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addSymbol();
          }}
          placeholder="BTC/USDT"
          className="flex-1 px-2 py-1.5 rounded-lg bg-bg-soft border border-border text-sm focus:outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={addSymbol}
          disabled={busy === "add" || !newSymbol.trim()}
          className="btn-ghost text-xs px-3"
        >
          Ekle
        </button>
      </div>
      {!active && symbols.length > 0 && (
        <div className="text-[10px] text-muted">
          Mod pasif — liste korunur, taramaya dahil edilmez.
        </div>
      )}
    </div>
  );
}
