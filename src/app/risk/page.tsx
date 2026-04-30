"use client";
// Phase 10 — Risk Yönetimi sayfası.
//
// Tasarım: dashboard ile uyumlu kart bazlı modern UI. Bu sayfa sadece
// config altyapısı içindir; trade engine, signal engine, risk engine
// execution veya canlı trading gate üzerinde HİÇBİR etkisi YOKTUR.
// `appliedToTradeEngine = false` invariant'i korunur.
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtUsd } from "@/lib/format";
import {
  POLICY,
  RISK_PROFILE_LABEL,
  type RiskProfileKey,
  type RiskSettings,
  type StopLossMode,
  type WarningEntry,
  computeWarnings,
  profileDefaults,
} from "@/lib/risk-settings";

const PROFILES: RiskProfileKey[] = ["LOW", "STANDARD", "AGGRESSIVE", "CUSTOM"];
const STOP_LOSS_OPTIONS: { value: StopLossMode; label: string }[] = [
  { value: "SYSTEM",   label: "SİSTEM BELİRLESİN" },
  { value: "TIGHT",    label: "SIKI" },
  { value: "STANDARD", label: "STANDART" },
  { value: "WIDE",     label: "GENİŞ" },
];

// Read replica lag workaround: after a successful save the RETURNING value is
// stored in localStorage. On page load, if the local cache has a newer
// updatedAt than what the (potentially stale) replica returned, the cache wins.
const RS_CACHE_KEY = "coinbot:risk_settings_cache";
function readLocalCache(): { settings: RiskSettings; updatedAt: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(RS_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { settings: RiskSettings; updatedAt: number };
  } catch { return null; }
}
function writeLocalCache(s: RiskSettings): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(RS_CACHE_KEY, JSON.stringify({ settings: s, updatedAt: s.updatedAt ?? Date.now() }));
  } catch { /* quota exceeded — silently ignore */ }
}

type SaveState = "idle" | "saving" | "saved" | "error";

export default function RiskPage() {
  const [settings, setSettings] = useState<RiskSettings | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [persistenceStatus, setPersistenceStatus] = useState<"ok" | "fallback" | null>(null);
  const [persistenceErrorSafe, setPersistenceErrorSafe] = useState<string | undefined>(undefined);

  const busy = saveState === "saving";

  const load = async () => {
    const res = await fetch("/api/risk-settings", { cache: "no-store" }).then((r) => r.json());
    if (res.ok) {
      const dbSettings = res.data.settings as RiskSettings;
      const cache = readLocalCache();
      // Prefer local cache if it has a newer updatedAt (replica lag bridge).
      const effective =
        cache && (cache.updatedAt ?? 0) > (dbSettings.updatedAt ?? 0)
          ? cache.settings
          : dbSettings;
      setSettings(effective);
      setPersistenceStatus(res.data.persistenceStatus === "ok" ? "ok" : "fallback");
      setPersistenceErrorSafe(res.data.persistenceErrorSafe);
    }
  };
  useEffect(() => { load(); }, []);

  const warnings = useMemo<WarningEntry[]>(() => {
    return settings ? computeWarnings(settings) : [];
  }, [settings]);

  const persist = async (next: RiskSettings) => {
    setSaveState("saving");
    setErrors([]);
    try {
      const res = await fetch("/api/risk-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      }).then((r) => r.json());
      if (!res.ok) {
        const detail = res.persistenceErrorSafe ? ` (${res.persistenceErrorSafe})` : "";
        setErrors(res.errors ?? [(res.error ?? "Kaydedilemedi.") + detail]);
        setSaveState("error");
        return;
      }
      writeLocalCache(res.data.settings);
      setSettings(res.data.settings);
      setSavedAt(new Date());
      setSaveState("saved");
      setPersistenceStatus("ok");
      setPersistenceErrorSafe(undefined);
    } catch (e) {
      setErrors([e instanceof Error ? e.message : "Ağ hatası"]);
      setSaveState("error");
    }
  };

  if (!settings) {
    return <div className="card text-muted text-sm">Yükleniyor…</div>;
  }

  // ── Yardımcılar ───────────────────────────────────────────────────────
  type Patch = {
    profile?: RiskProfileKey;
    capital?: Partial<RiskSettings["capital"]>;
    positions?: Partial<RiskSettings["positions"]>;
    leverage?: {
      CC?: Partial<RiskSettings["leverage"]["CC"]>;
      GNMR?: Partial<RiskSettings["leverage"]["GNMR"]>;
      MNLST?: Partial<RiskSettings["leverage"]["MNLST"]>;
    };
    direction?: Partial<RiskSettings["direction"]>;
    stopLoss?: Partial<RiskSettings["stopLoss"]>;
    tiered?: { scaleInProfitEnabled?: boolean };
  };
  const update = (patch: Patch) => {
    // Profil değişiyorsa (CUSTOM hariç), kullanıcının görsel olarak yeni
    // profilin defaultlarını anında görmesi için capital/positions/leverage
    // alanları profile defaultlarına resetlenir. totalCapitalUsdt korunur
    // çünkü kullanıcının manuel girdiği sermaye profile bağlı değildir.
    // API tarafı (applyPatch) zaten aynı reset'i uygular; bu client-side
    // reset, sadece UX tutarlılığı içindir — kullanıcı butona basar basmaz
    // değerlerin değiştiğini görür.
    const profileChanged =
      patch.profile && patch.profile !== settings.profile && patch.profile !== "CUSTOM";
    const def = profileChanged ? profileDefaults(patch.profile!) : null;

    const next: RiskSettings = {
      profile: patch.profile ?? settings.profile,
      capital: def
        ? { ...def.capital, totalCapitalUsdt: settings.capital.totalCapitalUsdt, ...(patch.capital ?? {}) }
        : { ...settings.capital, ...(patch.capital ?? {}) },
      positions: def
        ? { ...def.positions, ...(patch.positions ?? {}) }
        : { ...settings.positions, ...(patch.positions ?? {}) },
      leverage: def
        ? {
            CC: { ...def.leverage.CC, ...(patch.leverage?.CC ?? {}) },
            GNMR: { ...def.leverage.GNMR, ...(patch.leverage?.GNMR ?? {}) },
            MNLST: { ...def.leverage.MNLST, ...(patch.leverage?.MNLST ?? {}) },
          }
        : {
            CC: { ...settings.leverage.CC, ...(patch.leverage?.CC ?? {}) },
            GNMR: { ...settings.leverage.GNMR, ...(patch.leverage?.GNMR ?? {}) },
            MNLST: { ...settings.leverage.MNLST, ...(patch.leverage?.MNLST ?? {}) },
          },
      direction: { ...settings.direction, ...(patch.direction ?? {}) },
      stopLoss: { ...settings.stopLoss, ...(patch.stopLoss ?? {}) },
      tiered: {
        scaleInProfitEnabled:
          patch.tiered?.scaleInProfitEnabled ?? settings.tiered.scaleInProfitEnabled,
        averageDownEnabled: false,
      },
      appliedToTradeEngine: false,
      updatedAt: settings.updatedAt,
    };
    setSettings(next);
  };

  const exampleLossAtRisk = settings.capital.totalCapitalUsdt > 0
    ? (settings.capital.totalCapitalUsdt * settings.capital.riskPerTradePercent) / 100
    : null;
  const exampleDailyLoss = settings.capital.totalCapitalUsdt > 0
    ? (settings.capital.totalCapitalUsdt * settings.capital.maxDailyLossPercent) / 100
    : null;

  return (
    <div className="space-y-4">
      {/* Header — başlık + global durum chip'leri */}
      <div className="card">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-lg font-semibold tracking-wide">RİSK YÖNETİMİ</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <Chip tone="success">CONFIG OKUNUYOR</Chip>
            <Chip tone="muted">PAPER MODE</Chip>
            {savedAt && (
              <span className="text-[11px] text-muted">
                Kaydedildi: {savedAt.toLocaleTimeString("tr-TR")}
              </span>
            )}
          </div>
        </div>
        <p className="mt-2 text-xs text-muted">
          Bu sayfa risk ayarlarının canlı mimariye uygun config altyapısını
          yönetir. Bu fazda kayıtlar trade engine&apos;e uygulanmaz; paper mode
          güvenli test katmanıdır.
        </p>
      </div>

      {/* Persistence fallback uyarısı — DB okunamadıysa kullanıcı bilsin */}
      {persistenceStatus === "fallback" && (
        <div className="card border border-warning/40 bg-warning/10 text-warning">
          <div className="text-xs font-semibold uppercase tracking-wider mb-1">RİSK AYARLARI KALICI KAYITTAN OKUNAMADI</div>
          <div className="text-xs">
            Varsayılan değerler gösteriliyor; kaydetme yine denenecek.
            {persistenceErrorSafe && <span className="ml-1 opacity-80">({persistenceErrorSafe})</span>}
          </div>
        </div>
      )}

      {/* Faz 19 — Risk execution binding status */}
      <BindingStatus />

      {/* Kritik uyarılar — sayfanın üstünde özet */}
      {warnings.length > 0 && (
        <div className="card border border-danger/40 bg-danger/5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-danger">YÜKSEK RİSK UYARILARI</span>
            <span className="text-[10px] uppercase text-muted">{warnings.length} uyarı</span>
          </div>
          <ul className="space-y-1">
            {warnings.map((w) => (
              <li key={w.code + w.message} className="text-xs text-danger flex items-start gap-2">
                <span className="font-bold mt-0.5">!</span>
                <span>{w.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 1. Risk Profili */}
      <section className="card">
        <h2 className="font-semibold tracking-wide mb-3">1. RİSK PROFİLİ</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {PROFILES.map((p) => {
            const active = settings.profile === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => update({ profile: p })}
                className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                  active
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border bg-bg-soft text-slate-300 hover:border-accent"
                }`}
              >
                <div className="text-[10px] uppercase tracking-wider text-muted">PROFİL</div>
                <div className="text-base font-semibold">{RISK_PROFILE_LABEL[p]}</div>
                <div className="mt-1 text-[10px] text-muted">
                  {p === "LOW" && "Düşük risk · küçük pozisyon · az işlem"}
                  {p === "STANDARD" && "Varsayılan · dengeli kontrol"}
                  {p === "AGGRESSIVE" && "Agresif · daha çok pozisyon"}
                  {p === "CUSTOM" && "Özel · 30x'e kadar yapılandırma"}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* 2. Sermaye ve Zarar Limitleri */}
      <section className="card">
        <h2 className="font-semibold tracking-wide mb-3">2. SERMAYE VE ZARAR LİMİTLERİ</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <NumberField
            label="TOPLAM BOT SERMAYESİ (USDT)"
            value={settings.capital.totalCapitalUsdt}
            min={0}
            step={1}
            onChange={(v) => update({ capital: { totalCapitalUsdt: v } })}
            hint="Botun referans ana sermayesi"
          />
          <NumberField
            label="İŞLEM BAŞI RİSK (%)"
            value={settings.capital.riskPerTradePercent}
            min={0}
            max={100}
            step={0.1}
            onChange={(v) => update({ capital: { riskPerTradePercent: v } })}
            hint={exampleLossAtRisk !== null ? `~ ${fmtUsd(exampleLossAtRisk)} kayıp/işlem` : "Sermaye girilince kayıp tutarı hesaplanır"}
            danger={settings.capital.riskPerTradePercent > POLICY.warnings.riskPerTradePercent}
          />
          <NumberField
            label="GÜNLÜK MAKSİMUM ZARAR (%)"
            value={settings.capital.maxDailyLossPercent}
            min={0.1}
            max={100}
            step={0.5}
            onChange={(v) => update({ capital: { maxDailyLossPercent: v } })}
            hint={exampleDailyLoss !== null ? `~ ${fmtUsd(exampleDailyLoss)} günlük kayıp tavanı` : "% tabanlı; sermaye girilince tutar gösterilir"}
            danger={settings.capital.maxDailyLossPercent > POLICY.warnings.maxDailyLossPercent}
          />
        </div>
      </section>

      {/* 3. Pozisyon Limitleri */}
      <section className="card">
        <h2 className="font-semibold tracking-wide mb-3">3. POZİSYON LİMİTLERİ</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <NumberField
            label="VARSAYILAN AÇIK POZİSYON"
            value={settings.positions.defaultMaxOpenPositions}
            min={1}
            max={50}
            step={1}
            onChange={(v) => {
              const def = Math.round(v);
              const cap = settings.positions.dynamicMaxOpenPositionsCap;
              update({
                positions: cap < def
                  ? { defaultMaxOpenPositions: def, dynamicMaxOpenPositionsCap: def }
                  : { defaultMaxOpenPositions: def },
              });
            }}
            hint="Aynı anda hedeflenen pozisyon sayısı"
          />
          <NumberField
            label="DİNAMİK ÜST SINIR"
            value={settings.positions.dynamicMaxOpenPositionsCap}
            min={settings.positions.defaultMaxOpenPositions}
            max={50}
            step={1}
            onChange={(v) => {
              const cap = Math.max(Math.round(v), settings.positions.defaultMaxOpenPositions);
              update({ positions: { dynamicMaxOpenPositionsCap: cap } });
            }}
            hint={`Tetiklenebilecek mutlak üst sınır (≥ ${settings.positions.defaultMaxOpenPositions})`}
            danger={settings.positions.dynamicMaxOpenPositionsCap > POLICY.warnings.dynamicMaxOpenPositionsCap}
          />
          <NumberField
            label="MAKSİMUM GÜNLÜK İŞLEM"
            value={settings.positions.maxDailyTrades}
            min={1}
            max={200}
            step={1}
            onChange={(v) => update({ positions: { maxDailyTrades: Math.round(v) } })}
            danger={settings.positions.maxDailyTrades > POLICY.warnings.maxDailyTrades}
          />
        </div>
      </section>

      {/* 4. Kaldıraç Aralıkları */}
      <section className="card">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="font-semibold tracking-wide">4. KALDIRAÇ ARALIKLARI</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <Chip tone="muted">VARSAYILAN ÜST {POLICY.defaultLeverageCap}x</Chip>
            <Chip tone="warning">MAKS {POLICY.hardLeverageCap}x</Chip>
            <Chip tone={settings.profile === "CUSTOM" ? "accent" : "muted"}>
              {settings.profile === "CUSTOM" ? "ÖZEL: 30x SEÇİLEBİLİR" : "30x YALNIZCA ÖZEL'DE"}
            </Chip>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <LeverageBox
            label="CORE COIN"
            codeMin="CCMNKL" codeMax="CCMXKL"
            range={settings.leverage.CC}
            profile={settings.profile}
            onChange={(min, max) => update({ leverage: { CC: { min, max } } })}
          />
          <LeverageBox
            label="GENEL MARKET"
            codeMin="GNMRMNKL" codeMax="GNMRMXKL"
            range={settings.leverage.GNMR}
            profile={settings.profile}
            onChange={(min, max) => update({ leverage: { GNMR: { min, max } } })}
          />
          <LeverageBox
            label="MANUEL LİSTE"
            codeMin="MNLSTMNKL" codeMax="MNLSTMXKL"
            range={settings.leverage.MNLST}
            profile={settings.profile}
            onChange={(min, max) => update({ leverage: { MNLST: { min, max } } })}
          />
        </div>

        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <ToggleBox
            label="LONG"
            on={settings.direction.longEnabled}
            onToggle={(v) => update({ direction: { longEnabled: v } })}
          />
          <ToggleBox
            label="SHORT"
            on={settings.direction.shortEnabled}
            onToggle={(v) => update({ direction: { shortEnabled: v } })}
          />
        </div>
      </section>

      {/* 5. Stop-Loss ve Pozisyon Yönetimi */}
      <section className="card">
        <h2 className="font-semibold tracking-wide mb-3">5. STOP-LOSS VE POZİSYON YÖNETİMİ</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="rounded-lg border border-border bg-bg-soft px-3 py-3">
            <div className="text-[10px] uppercase tracking-wider text-muted mb-2">STOP-LOSS MODU</div>
            <div className="grid grid-cols-2 gap-1.5">
              {STOP_LOSS_OPTIONS.map((o) => {
                const active = settings.stopLoss.mode === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => update({ stopLoss: { mode: o.value } })}
                    className={`text-xs px-2 py-1.5 rounded-md border transition-colors ${
                      active
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border bg-bg-card text-slate-300 hover:border-accent"
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[10px] text-muted">
              Varsayılan: SİSTEM BELİRLESİN. Bot stop-loss seviyesini kendi
              kuralına göre koymaya devam eder.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-bg-soft px-3 py-3">
            <div className="text-[10px] uppercase tracking-wider text-muted mb-2">POZİSYON YÖNETİMİ</div>
            <div className="space-y-2">
              <ToggleRow
                label="KÂRDA KADEMELİ YÖNETİM"
                on={settings.tiered.scaleInProfitEnabled}
                onToggle={(v) => update({ tiered: { scaleInProfitEnabled: v } })}
                hint="UI/config altyapısı; bu fazda execution'a bağlı değil."
              />
              <ToggleRow
                label="ZARARDA POZİSYON ARTIRMA"
                on={false}
                locked
                hint="KİLİTLİ — zarardaki pozisyon büyütülemez."
              />
            </div>
          </div>
        </div>
      </section>

      {/* 6. Güvenlik Uyarıları */}
      <section className="card">
        <h2 className="font-semibold tracking-wide mb-3">6. GÜVENLİK UYARILARI</h2>
        {warnings.length === 0 ? (
          <p className="text-xs text-muted">Tüm değerler güvenlik eşikleri içinde.</p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {warnings.map((w) => (
              <li key={w.code + w.message}
                className={`rounded-lg border px-3 py-2 text-xs ${
                  w.severity === "critical"
                    ? "border-danger/40 bg-danger/5 text-danger"
                    : "border-warning/40 bg-warning/5 text-warning"
                }`}>
                <div className="text-[10px] uppercase tracking-wider opacity-80">{w.code}</div>
                <div className="font-medium">{w.message}</div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11px] text-muted">
          Risk config bot tarafından okunuyor. Canlı execution kapalı.
          Kaldıraç execution kapalı.
        </p>
      </section>

      {/* Save bar */}
      <div className="card flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs text-muted">
          Profil: <span className="font-medium text-slate-200">{RISK_PROFILE_LABEL[settings.profile]}</span>
          {settings.updatedAt > 0 && (
            <span className="ml-3">Son güncelleme: {new Date(settings.updatedAt).toLocaleString("tr-TR")}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-ghost text-sm px-3 py-1.5"
            onClick={load}
            disabled={busy}
          >
            Geri Al
          </button>
          <button
            className="btn-primary text-sm px-4 py-1.5"
            onClick={() => persist(settings)}
            disabled={busy}
          >
            {saveState === "saving" ? "Kaydediliyor…"
              : saveState === "saved"  ? "Kaydedildi"
              : saveState === "error"  ? "Kaydetme başarısız"
              : "Kaydet"}
          </button>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="card border border-danger/50 bg-danger/10 text-danger">
          <div className="text-xs font-semibold uppercase tracking-wider mb-1">Doğrulama Hataları</div>
          <ul className="space-y-1">
            {errors.map((e, i) => (
              <li key={i} className="text-xs">• {e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Yapı taşları ─────────────────────────────────────────────────────────
type Tone = "success" | "warning" | "danger" | "muted" | "accent";

function Chip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const cls =
    tone === "success" ? "bg-success/15 text-success" :
    tone === "warning" ? "bg-warning/15 text-warning" :
    tone === "danger"  ? "bg-danger/15 text-danger" :
    tone === "accent"  ? "bg-accent/15 text-accent" :
                         "bg-bg-soft text-slate-300";
  return (
    <span className={`text-[10px] font-medium uppercase tracking-wider px-2 py-1 rounded-md ${cls}`}>
      {children}
    </span>
  );
}

function NumberField({
  label, value, onChange, hint, danger, min, max, step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
  danger?: boolean;
  min?: number; max?: number; step?: number;
}) {
  const safeNum = Number.isFinite(value) && value >= 0 ? value : 0;
  const [raw, setRaw] = useState(String(safeNum));
  const prevValue = useRef(safeNum);

  // Sync when the value changes externally (load / reset).
  useEffect(() => {
    const n = Number.isFinite(value) && value >= 0 ? value : 0;
    if (n !== prevValue.current) {
      prevValue.current = n;
      setRaw(String(n));
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const s = e.target.value;
    // Remove any leading zeros (e.g. "01000" → "1000"), but keep "0" alone.
    const normalized = s.replace(/^0+(\d)/, "$1");
    setRaw(normalized);
    const n = parseFloat(normalized);
    if (Number.isFinite(n) && n >= 0) {
      prevValue.current = n;
      onChange(n);
    }
  };

  const handleBlur = () => {
    const n = parseFloat(raw);
    const fallback = min !== undefined && min > 0 ? min : 0;
    const safe = Number.isFinite(n) && n >= 0 ? n : fallback;
    prevValue.current = safe;
    setRaw(String(safe));
    onChange(safe);
  };

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${danger ? "border-danger/50 bg-danger/5" : "border-border bg-bg-soft"}`}>
      <label className="text-[10px] uppercase tracking-wider text-muted">{label}</label>
      <input
        type="text"
        inputMode="decimal"
        className="mt-1 w-full bg-transparent border-b border-border focus:border-accent outline-none text-sm tabular-nums"
        value={raw}
        min={min} max={max} step={step}
        onChange={handleChange}
        onFocus={(e) => e.target.select()}
        onBlur={handleBlur}
      />
      {hint && <div className={`mt-1 text-[10px] ${danger ? "text-danger" : "text-muted"}`}>{hint}</div>}
    </div>
  );
}

function LeverageInput({ value, min, max, onChange }: {
  value: number; min: number; max: number; onChange: (v: number) => void;
}) {
  const [raw, setRaw] = useState(String(value));
  const prevVal = useRef(value);
  useEffect(() => {
    if (value !== prevVal.current) { prevVal.current = value; setRaw(String(value)); }
  }, [value]);
  return (
    <input
      type="text" inputMode="numeric"
      className="mt-1 w-full bg-transparent border-b border-border focus:border-accent outline-none text-sm tabular-nums"
      value={raw}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        const s = e.target.value.replace(/^0+(\d)/, "$1");
        setRaw(s);
        const n = Math.round(Number(s));
        if (Number.isFinite(n) && n >= 0) { prevVal.current = n; onChange(n); }
      }}
      onBlur={() => {
        const n = Math.round(Number(raw));
        const safe = Number.isFinite(n) && n >= min ? Math.min(n, max) : min;
        prevVal.current = safe; setRaw(String(safe)); onChange(safe);
      }}
    />
  );
}

function LeverageBox({
  label, codeMin, codeMax, range, profile, onChange,
}: {
  label: string;
  codeMin: string;
  codeMax: string;
  range: { min: number; max: number };
  profile: RiskProfileKey;
  onChange: (min: number, max: number) => void;
}) {
  const cap = profile === "CUSTOM" ? POLICY.hardLeverageCap : POLICY.defaultLeverageCap;
  const danger =
    range.max >= POLICY.warnings.leverageMaxCritical ||
    range.max > POLICY.warnings.leverageMaxWarn;
  const reachedExtreme = range.max >= POLICY.warnings.leverageMaxCritical;
  return (
    <div className={`rounded-lg border px-3 py-3 ${danger ? "border-danger/50 bg-danger/5" : "border-border bg-bg-soft"}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold">{label}</span>
        {reachedExtreme && <Chip tone="danger">30x — YÜKSEK RİSK</Chip>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted">{codeMin} (MIN)</label>
          <LeverageInput
            value={range.min} min={POLICY.minLeverage} max={cap}
            onChange={(v) => onChange(v, range.max)}
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted">{codeMax} (MAX)</label>
          <LeverageInput
            value={range.max} min={POLICY.minLeverage} max={cap}
            onChange={(v) => onChange(range.min, v)}
          />
        </div>
      </div>
      <div className="mt-2 text-[10px] text-muted">
        Aralık {POLICY.minLeverage}-{cap}x {profile !== "CUSTOM" ? `· 30x için ÖZEL profil gerekli` : ""}
      </div>
    </div>
  );
}

function ToggleBox({ label, on, onToggle }: {
  label: string;
  on: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!on)}
      className={`rounded-lg border px-3 py-2 text-left transition-colors ${
        on
          ? "border-success/50 bg-success/10 text-success"
          : "border-border bg-bg-soft text-slate-300"
      }`}
    >
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className="text-sm font-semibold">{on ? "AKTİF" : "PASİF"}</div>
    </button>
  );
}

function ToggleRow({ label, on, onToggle, hint, locked }: {
  label: string;
  on: boolean;
  onToggle?: (v: boolean) => void;
  hint?: string;
  locked?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex-1">
        <div className="text-xs font-medium text-slate-200">{label}</div>
        {hint && <div className="text-[10px] text-muted">{hint}</div>}
      </div>
      <button
        type="button"
        disabled={locked}
        onClick={() => onToggle?.(!on)}
        className={`text-[10px] font-semibold uppercase tracking-wider px-3 py-1 rounded-md border transition-colors ${
          locked
            ? "border-danger/40 bg-danger/10 text-danger cursor-not-allowed"
            : on
              ? "border-success/40 bg-success/10 text-success"
              : "border-border bg-bg-soft text-slate-300 hover:border-accent"
        }`}
        aria-label={locked ? `${label} kilitli` : `${label} ${on ? "aktif" : "pasif"}`}
      >
        {locked ? "KİLİTLİ" : on ? "AKTİF" : "PASİF"}
      </button>
    </div>
  );
}

// Faz 19 — küçük durum göstergesi
function BindingStatus() {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    fetch("/api/risk-settings/effective", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j.ok) setData(j.data); })
      .catch(() => undefined);
  }, []);
  if (!data) return null;
  return (
    <div className="card">
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className="font-semibold uppercase tracking-wider text-muted">RİSK BAĞLAMA DURUMU</span>
        <Chip tone="success">CONFIG OKUNUYOR</Chip>
        <Chip tone="muted">CANLI EXECUTION KAPALI</Chip>
        <Chip tone="muted">KALDIRAÇ EXECUTION KAPALI</Chip>
        <Chip tone="danger">ZARARDA BÜYÜTME KİLİTLİ</Chip>
      </div>
      <div className="mt-2 text-[10px] text-muted">
        Risk Yönetimi config&apos;i paper/live ortak risk lifecycle&apos;a okunabilir durumda.
        Canlı emir, kaldıraç set ve zararda büyütme bu fazda kapalıdır.
      </div>
    </div>
  );
}
