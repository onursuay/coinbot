"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { COIN_SOURCE_LABEL, type ScanModesConfig } from "@/lib/scan-modes/types";

// Tarama Modları sayfası.
// Faz 1 — 3 mod kartı + Aktif/Pasif toggle.
// Faz 4 — Manuel İzleme Listesi için Binance Futures evrenine bağlı arama
// (cache'li, dağınık fetch yok). Arama sonuçları satır olarak gösterilir;
// her satırda "Ekle" veya zaten ekliyse "Seçili" pasif rozeti bulunur.
// Bu sayfa scanner/sinyal/risk davranışını DEĞİŞTİRMEZ.

interface SearchResult {
  symbol: string;
  baseAsset: string;
  alreadyAdded: boolean;
}

type SaveState = "idle" | "saving" | "saved" | "error";

export default function ScanModesPage() {
  const [config, setConfig] = useState<ScanModesConfig | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashSaved = () => {
    setSaveState("saved");
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSaveState("idle"), 1500);
  };

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
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const toggle = async (mode: "wideMarket" | "momentum" | "manualList", next: boolean) => {
    setBusy(mode);
    setError(null);
    setSaveState("saving");
    try {
      const res = await fetch("/api/scan-modes", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [mode]: { active: next } }),
      }).then((r) => r.json());
      if (res.ok) {
        setConfig(res.data);
        flashSaved();
      } else {
        setError(res.error ?? "Güncelleme başarısız");
        setSaveState("error");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
      setSaveState("error");
    } finally {
      setBusy(null);
    }
  };

  const addSymbol = async (rawSym: string) => {
    const sym = rawSym.trim();
    if (!sym) return;
    setBusy(`add:${sym}`);
    setError(null);
    setSaveState("saving");
    try {
      const res = await fetch("/api/scan-modes/manual-list", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol: sym }),
      }).then((r) => r.json());
      if (res.ok) {
        setConfig(res.data);
        flashSaved();
      } else {
        setError(res.error ?? "Ekleme başarısız");
        setSaveState("error");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
      setSaveState("error");
    } finally {
      setBusy(null);
    }
  };

  const removeSymbol = async (sym: string) => {
    setBusy(`rm:${sym}`);
    setError(null);
    setSaveState("saving");
    try {
      const res = await fetch(`/api/scan-modes/manual-list?symbol=${encodeURIComponent(sym)}`, {
        method: "DELETE",
      }).then((r) => r.json());
      if (res.ok) {
        setConfig(res.data);
        flashSaved();
      } else {
        setError(res.error ?? "Kaldırma başarısız");
        setSaveState("error");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
      setSaveState("error");
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
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Tarama Modları</h1>
          <SaveBadge state={saveState} />
        </div>
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
            addSymbol={addSymbol}
            removeSymbol={removeSymbol}
            busy={busy}
          />
        </ModeCard>
      </div>
    </div>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  if (state === "saving") {
    return <span className="text-[10px] uppercase tracking-wider text-muted">Kaydediliyor…</span>;
  }
  if (state === "saved") {
    return <span className="text-[10px] uppercase tracking-wider text-success">Kaydedildi</span>;
  }
  return <span className="text-[10px] uppercase tracking-wider text-danger">Kaydetme hatası</span>;
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
  addSymbol,
  removeSymbol,
  busy,
}: {
  symbols: string[];
  active: boolean;
  addSymbol: (sym: string) => void | Promise<void>;
  removeSymbol: (s: string) => void;
  busy: string | null;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchWarning, setSearchWarning] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const symbolsSet = useMemo(() => new Set(symbols), [symbols]);

  // Debounced search — fetches from /api/scan-modes/manual-list/search.
  // The endpoint is backed by the Phase-2 cached market universe (6h TTL),
  // so each keystroke does NOT trigger a Binance API call.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setSearchError(null);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/scan-modes/manual-list/search?q=${encodeURIComponent(query.trim())}&limit=20`,
        ).then((r) => r.json());
        if (res.ok) {
          setResults(res.data.results ?? []);
          setSearchError(null);
          setSearchWarning(res.data.warning ?? null);
        } else {
          setResults([]);
          setSearchError("Arama geçici olarak kullanılamıyor.");
          setSearchWarning(null);
        }
      } catch {
        setSearchError("Arama geçici olarak kullanılamıyor.");
        setSearchWarning(null);
      } finally {
        setSearching(false);
      }
    }, 220);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <div className="space-y-3">
      {/* Selected coin chips */}
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

      {/* Search input */}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Coin ara (örn. SOL, BTC, ETH)"
          className="w-full px-2 py-1.5 rounded-lg bg-bg-soft border border-border text-sm focus:outline-none focus:border-accent"
        />
        {searching && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted">…</div>
        )}
      </div>

      {/* Search results */}
      {searchWarning && <div className="text-xs text-warning">{searchWarning}</div>}
      {searchError && <div className="text-xs text-muted">{searchError}</div>}
      {query.trim() && !searching && results.length === 0 && !searchError && (
        <div className="text-xs text-muted italic">Sonuç bulunamadı</div>
      )}
      {results.length > 0 && (
        <ul className="space-y-1 max-h-56 overflow-y-auto pr-1">
          {results.map((r) => {
            const already = r.alreadyAdded || symbolsSet.has(r.symbol);
            const adding = busy === `add:${r.symbol}`;
            return (
              <li
                key={r.symbol}
                className="flex items-center justify-between gap-2 px-2 py-1 rounded border border-border bg-bg-soft/40 text-xs"
              >
                <span className="font-mono truncate">{r.symbol}</span>
                {already ? (
                  <span className="text-[10px] text-success uppercase tracking-wider">Seçili</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => addSymbol(r.symbol)}
                    disabled={adding}
                    className="btn-ghost text-[10px] px-2 py-0.5"
                  >
                    {adding ? "Ekleniyor…" : "Ekle"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!active && symbols.length > 0 && (
        <div className="text-[10px] text-muted">
          Mod pasif — liste korunur, taramaya dahil edilmez.
        </div>
      )}
    </div>
  );
}
