"use client";
import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { fmtNum, fmtPct, fmtUsd } from "@/lib/format";
import { COIN_SOURCE_LABEL, type ScanModesConfig } from "@/lib/scan-modes/types";

// ── Types ──────────────────────────────────────────────────────────────────────
type Tab = "strategy" | "scan-modes" | "performance";

const TABS: { key: Tab; label: string }[] = [
  { key: "strategy", label: "Strateji Ayarları" },
  { key: "scan-modes", label: "Tarama Modları" },
  { key: "performance", label: "Performans" },
];

// ── Strategy Settings Tab ──────────────────────────────────────────────────────
function StrategySettingsTab() {
  const [exchange, setExchange] = useState("mexc");
  const [watched, setWatched] = useState<any[]>([]);
  const [symbol, setSymbol] = useState("");
  const refresh = async () => {
    const r = await fetch(`/api/watched-symbols?exchange=${exchange}`).then((r) => r.json());
    if (r.ok) setWatched(r.data);
  };
  useEffect(() => { refresh(); }, [exchange]);

  const add = async () => {
    if (!symbol) return;
    const res = await fetch("/api/watched-symbols", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ exchange, symbol, is_active: true }),
    }).then((r) => r.json());
    if (!res.ok) alert(res.error);
    else { setSymbol(""); refresh(); }
  };
  const remove = async (sym: string) => {
    await fetch(`/api/watched-symbols?exchange=${exchange}&symbol=${encodeURIComponent(sym)}`, { method: "DELETE" });
    refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <select className="input w-32" value={exchange} onChange={(e) => setExchange(e.target.value)}>
          {["mexc", "binance", "okx", "bybit"].map((x) => <option key={x} value={x}>{x.toUpperCase()}</option>)}
        </select>
        <input className="input flex-1" placeholder="Sembol ekle (BTC/USDT)" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
        <button className="btn-primary" onClick={add} disabled={!symbol}>Ekle</button>
      </div>
      <section className="card">
        <h2 className="font-semibold text-sm mb-2">Strategy / Watchlist</h2>
        <table className="t">
          <thead><tr><th>Sym</th><th>Active</th><th>Min Vol</th><th></th></tr></thead>
          <tbody>
            {watched.length === 0 && <tr><td colSpan={4} className="text-muted">izlenen sembol yok — varsayılan: BTC/ETH/SOL/BNB/XRP</td></tr>}
            {watched.map((w) => (
              <tr key={w.id}>
                <td>{w.symbol}</td>
                <td>{w.is_active ? <span className="tag-success">active</span> : <span className="tag-muted">inactive</span>}</td>
                <td>{fmtNum(w.min_volume_usd, 0)}</td>
                <td><button className="btn-ghost text-xs" onClick={() => remove(w.symbol)}>Sil</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="card text-sm text-muted">
        Strateji parametreleri Risk Settings&apos;te tutuluyor; signal engine ek olarak BTC trendi, hacim teyidi,
        spread, funding rate ve volatilite filtrelerini uyguluyor. Sinyal skoru &lt;70 ise işlem açılmaz; 70-79 max 2x,
        80-89 max 3x, 90+ max 5x kaldıraca izin verilir (sistem 5x üst sınırı içinde).
      </div>
    </div>
  );
}

// ── Scan Modes Tab ─────────────────────────────────────────────────────────────
interface SearchResult {
  symbol: string;
  baseAsset: string;
  alreadyAdded: boolean;
}

type SaveState = "idle" | "saving" | "saved" | "error";

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

function ScanModeToggle({
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
        <ScanModeToggle active={active} busy={busy} onToggle={onToggle} />
      </div>
      <div className="text-xs text-muted">
        Durum: {active ? <span className="text-success">AKTİF</span> : <span className="text-warning">PASİF</span>}
      </div>
      {children && <div className="flex-1 flex flex-col">{children}</div>}
    </section>
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

function ScanModesTab() {
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
        <div className="text-muted">Yükleniyor…</div>
        {error && <div className="alert-danger px-3 py-2 text-sm">{error}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Coin seçim mimarisi — 3 bağımsız mod. Bu ayarlar yalnızca
          tarama evrenini etkiler; sinyal eşikleri, risk yönetimi ve canlı
          trading kapısı değişmez.
        </p>
        <SaveBadge state={saveState} />
      </div>

      {error && (
        <div className="card alert-danger text-sm">{error}</div>
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

// ── Performance Tab ─────────────────────────────────────────────────────────────
function PerfKpi({ label, value, accent }: { label: string; value: string; accent?: "success" | "danger" }) {
  const cls = accent === "success" ? "value-positive" : accent === "danger" ? "value-negative" : "";
  return <div className="card"><div className="label">{label}</div><div className={`kpi ${cls}`}>{value}</div></div>;
}

function PerformanceTab() {
  const [perf, setPerf] = useState<any>(null);
  const [closed, setClosed] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const [p, t] = await Promise.all([
        fetch("/api/paper-trades/performance").then((r) => r.json()),
        fetch("/api/paper-trades?limit=200").then((r) => r.json()),
      ]);
      if (p.ok) setPerf(p.data);
      if (t.ok) setClosed(t.data.closed);
    })();
  }, []);

  let equity = 0;
  const points = (closed ?? []).slice().reverse().map((t) => { equity += Number(t.pnl ?? 0); return equity; });

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-4 gap-3">
        <PerfKpi label="Toplam Kâr/Zarar" value={fmtUsd(perf?.totalPnl ?? 0)} accent={(perf?.totalPnl ?? 0) >= 0 ? "success" : "danger"} />
        <PerfKpi label="Kazanma Oranı" value={fmtPct(perf?.winRate ?? 0)} />
        <PerfKpi label="Kâr Faktörü" value={fmtNum(perf?.profitFactor ?? 0)} />
        <PerfKpi label="Maksimum Düşüş" value={fmtUsd(perf?.maxDrawdown ?? 0)} accent="danger" />
      </div>
      <div className="card">
        <h2 className="font-semibold mb-2">Sermaye Eğrisi (paper, kronolojik)</h2>
        {points.length === 0 ? <div className="text-muted text-sm">Veri yok</div> : (
          <svg viewBox={`0 0 ${Math.max(200, points.length * 6)} 120`} className="w-full h-32">
            {(() => {
              const w = Math.max(200, points.length * 6), h = 120, pad = 6;
              const min = Math.min(0, ...points), max = Math.max(0, ...points);
              const range = Math.max(1e-9, max - min);
              const sx = (w - pad * 2) / Math.max(1, points.length - 1);
              const path = points.map((v, i) => {
                const x = pad + i * sx;
                const y = h - pad - ((v - min) / range) * (h - pad * 2);
                return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
              }).join(" ");
              return <path d={path} fill="none" stroke="#22d3ee" strokeWidth={1.6} />;
            })()}
          </svg>
        )}
      </div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────
function StrategyCenterContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeTab = (searchParams.get("tab") as Tab) ?? "strategy";

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Strateji Merkezi</h1>

      <div
        className="inline-flex gap-1 overflow-x-auto rounded-lg border border-border bg-bg-soft p-1 max-w-full"
        role="tablist"
        aria-label="Strateji Merkezi sekmeleri"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={activeTab === t.key}
            onClick={() => router.push(`/strategy-center?tab=${t.key}`, { scroll: false })}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === t.key
                ? "bg-accent text-black"
                : "text-slate-300 hover:bg-bg-card hover:text-slate-100"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {activeTab === "strategy" && <StrategySettingsTab />}
        {activeTab === "scan-modes" && <ScanModesTab />}
        {activeTab === "performance" && <PerformanceTab />}
      </div>
    </div>
  );
}

export default function StrategyCenterPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <h1 className="text-xl font-semibold">Strateji Merkezi</h1>
          <div className="text-muted text-sm">Yükleniyor…</div>
        </div>
      }
    >
      <StrategyCenterContent />
    </Suspense>
  );
}
