"use client";
import { useEffect, useState } from "react";
import { fmtNum, fmtUsd, fmtPct } from "@/lib/format";

interface CloseNotice {
  level: "error" | "warning" | "success";
  text: string;
}

// Backend `code` → human-readable Turkish message. We never surface raw HTTP
// statuses (e.g. "HTTP 451") to the user — those come from the exchange edge
// and only confuse. The structured `code` field in the API response is the
// stable contract.
function closeMessageFor(code: string | undefined, fallback: string): string {
  switch (code) {
    case "BINANCE_451":
      return "Paper pozisyon kapatılamadı: Binance fiyat verisi erişilemedi. Fallback fiyat bulunamadı.";
    case "BINANCE_BLOCKED":
      return "Paper pozisyon kapatılamadı: Binance erişim engellendi (403/429). Fallback fiyat bulunamadı.";
    case "PRICE_UNAVAILABLE":
      return "Güncel veya son bilinen fiyat bulunamadı; paper pozisyon kapatılamadı.";
    case "TRADE_NOT_FOUND":
      return "İşlem bulunamadı (silinmiş olabilir).";
    case "TRADE_ALREADY_CLOSED":
      return "Bu işlem zaten kapatılmış.";
    case "POSITION_UNDER_OBSERVATION":
      return "Pozisyon izleme sürecinde; kapatma devre dışı.";
    case "CLOSE_FAILED":
      return "Paper pozisyon kapatılamadı (sunucu hatası).";
    default:
      return fallback || "Paper pozisyon kapatılamadı.";
  }
}

// Mirrors the server-side bands in src/app/api/paper-trades/close/route.ts.
// netPnl in USDT.
const PROFIT_THRESHOLD = 0.25;
const LOSS_THRESHOLD = -0.25;

type AgeBucket = "fresh" | "monitoring" | "stale";
type PnlBucket = "profit" | "loss" | "break_even" | "unknown";

function ageBucketFor(openedAt: string): AgeBucket {
  const ageH = (Date.now() - new Date(openedAt).getTime()) / 3_600_000;
  if (ageH < 12) return "fresh";
  if (ageH < 24) return "monitoring";
  return "stale";
}

function pnlBucketFor(netPnl: number | null | undefined): PnlBucket {
  if (netPnl == null || !Number.isFinite(Number(netPnl))) return "unknown";
  const v = Number(netPnl);
  if (v >= PROFIT_THRESHOLD) return "profit";
  if (v <= LOSS_THRESHOLD) return "loss";
  return "break_even";
}

function buttonLabelFor(age: AgeBucket): "KAPAT" | "İZLENİYOR" | "SÜRE AŞIMI" {
  if (age === "fresh") return "KAPAT";
  if (age === "monitoring") return "İZLENİYOR";
  return "SÜRE AŞIMI";
}

// Tone classes — map to the existing utility palette. Disabled state lowers
// opacity but keeps the same hue so the colour stays readable.
function buttonClassFor(pnl: PnlBucket, disabled: boolean, priceUnavailable: boolean): string {
  const base = "px-2 py-1 rounded text-xs font-semibold border transition-colors min-w-[88px]";
  if (priceUnavailable) {
    return `${base} bg-slate-800 text-slate-400 border-slate-700 cursor-not-allowed`;
  }
  const palette =
    pnl === "profit"
      ? "bg-success/15 text-success border-success/30 hover:bg-success/25"
      : pnl === "loss"
        ? "bg-danger/15 text-danger border-danger/30 hover:bg-danger/25"
        : pnl === "break_even"
          ? "bg-sky-500/15 text-sky-400 border-sky-500/30 hover:bg-sky-500/25"
          : "bg-slate-800 text-slate-400 border-slate-700";
  if (disabled) {
    return `${base} ${palette} opacity-60 cursor-not-allowed`;
  }
  return `${base} ${palette}`;
}

interface LossModalState {
  trade: any;
  netPnl: number;
  pnlPct: number | null;
  currentPrice: number | null;
  age: AgeBucket;
}

export default function PaperTradesPage() {
  const [open, setOpen] = useState<any[]>([]);
  const [closed, setClosed] = useState<any[]>([]);
  const [perf, setPerf] = useState<{ totalPnl: number; dailyPnl: number; totalTrades: number; closedToday: number } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [closeNotice, setCloseNotice] = useState<CloseNotice | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  // Loss-close modal — only shown after the user clicks a clickable red button
  // (fresh+loss or stale+loss). Per spec, no banner, toast, or always-on
  // warning is shown — the modal is the single user-visible warning.
  const [lossModal, setLossModal] = useState<LossModalState | null>(null);

  const refresh = async () => {
    const [r, p] = await Promise.all([
      fetch("/api/paper-trades?limit=200", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      fetch("/api/paper-trades/performance", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
    ]);
    if (r?.ok) { setOpen(r.data.open); setClosed(r.data.closed); }
    if (p?.ok) {
      setPerf({
        totalPnl: Number(p.data?.totalPnl ?? 0),
        dailyPnl: Number(p.data?.dailyPnl ?? 0),
        totalTrades: Number(p.data?.totalTrades ?? 0),
        closedToday: Number(p.data?.closedToday ?? 0),
      });
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, []);

  // Single send-close helper — used both by the direct "KAPAT/SÜRE AŞIMI"
  // happy path (profit / break_even) and by the modal "Zararı Onayla ve Kapat"
  // path (confirmLossClose=true).
  const sendClose = async (id: string, confirmLossClose: boolean) => {
    setCloseNotice(null);
    setClosingId(id);
    try {
      let res: any = null;
      try {
        const r = await fetch("/api/paper-trades/close", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tradeId: id, reason: "manual", confirmLossClose }),
        });
        res = await r.json().catch(() => ({ ok: false, error: "Sunucu yanıtı okunamadı." }));
      } catch (e: any) {
        res = { ok: false, error: e?.message ?? "Ağ hatası" };
      }

      if (res?.ok) {
        const src = res.closePriceSource as string | undefined;
        if (src && src !== "binance") {
          setCloseNotice({
            level: "warning",
            text: `Pozisyon kapatıldı; Binance ticker erişilemedi, fallback fiyat kullanıldı (kaynak: ${src}).`,
          });
        } else {
          setCloseNotice({ level: "success", text: "Pozisyon kapatıldı." });
        }
      } else if (res?.code === "LOSS_CLOSE_CONFIRMATION_REQUIRED") {
        // Server detected a loss the client didn't yet flag — open the modal
        // with the server's authoritative numbers. (Should be rare: the UI
        // already opens the modal client-side for loss buckets.)
        const trade = open.find((o) => o.id === id);
        if (trade) {
          setLossModal({
            trade,
            netPnl: Number(res.netUnrealizedPnl ?? 0),
            pnlPct: res.netUnrealizedPnlPct == null ? null : Number(res.netUnrealizedPnlPct),
            currentPrice: res.currentPrice == null ? null : Number(res.currentPrice),
            age: (res.ageBucket as AgeBucket) ?? "fresh",
          });
        } else {
          setCloseNotice({ level: "error", text: closeMessageFor(res?.code, res?.error ?? "") });
        }
      } else {
        setCloseNotice({
          level: "error",
          text: closeMessageFor(res?.code, res?.error ?? ""),
        });
      }
      await refresh();
    } finally {
      setClosingId(null);
    }
  };

  const onCloseClick = (t: any) => {
    if (closingId) return;
    const age = ageBucketFor(t.opened_at);
    if (age === "monitoring") return; // disabled — defensive
    const pnl = pnlBucketFor(t.net_unrealized_pnl);
    if (pnl === "loss") {
      setLossModal({
        trade: t,
        netPnl: Number(t.net_unrealized_pnl ?? 0),
        pnlPct: t.net_unrealized_pnl_pct == null ? null : Number(t.net_unrealized_pnl_pct),
        currentPrice: t.current_price == null ? null : Number(t.current_price),
        age,
      });
      return;
    }
    void sendClose(t.id, false);
  };

  const confirmLossModal = async () => {
    if (!lossModal) return;
    const id = lossModal.trade.id;
    setLossModal(null);
    await sendClose(id, true);
  };

  const deleteTrade = async (id: string) => {
    if (!confirm("Bu paper işlem kaydını silmek istiyor musun?")) return;
    setDeleteError(null);
    const res = await fetch(`/api/paper-trades/${id}`, { method: "DELETE" }).then((r) => r.json());
    if (!res.ok) {
      setDeleteError(res.error ?? "Silinemedi");
    } else {
      refresh();
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Pozisyonlar</h1>

      {deleteError && (
        <div className="alert-danger px-3 py-2 text-sm">
          {deleteError}
        </div>
      )}

      {closeNotice && (
        <div
          className={
            closeNotice.level === "error"
              ? "alert-danger px-3 py-2 text-sm flex items-start justify-between gap-3"
              : closeNotice.level === "warning"
                ? "alert-warning px-3 py-2 text-sm flex items-start justify-between gap-3"
                : "alert-success px-3 py-2 text-sm flex items-start justify-between gap-3"
          }
          role="status"
        >
          <span>{closeNotice.text}</span>
          <button
            type="button"
            onClick={() => setCloseNotice(null)}
            className="text-xs opacity-70 hover:opacity-100 underline"
          >
            kapat
          </button>
        </div>
      )}

      <section className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">Açık Pozisyonlar</h2>
        <table className="t">
          <thead><tr>
            <th>Sembol</th><th>Yön</th><th>Kaldıraç</th><th>Marjin</th><th>Boyut</th>
            <th>Giriş</th><th>Zarar Durdur</th><th>Kâr Al</th><th>Tahmini Likidasyon</th><th>Risk/Ödül</th><th>Skor</th><th>Açılış</th><th></th><th></th>
          </tr></thead>
          <tbody>
            {open.length === 0 && <tr><td colSpan={14} className="text-muted">Açık pozisyon yok</td></tr>}
            {open.map((t) => {
              const age = ageBucketFor(t.opened_at);
              const pnl = pnlBucketFor(t.net_unrealized_pnl);
              const priceUnavailable = t.current_price == null;
              const isMonitoring = age === "monitoring";
              const label = closingId === t.id ? "Kapatılıyor…" : buttonLabelFor(age);
              const disabled =
                closingId === t.id ||
                (closingId !== null && closingId !== t.id) ||
                isMonitoring ||
                priceUnavailable;
              const cls = buttonClassFor(pnl, disabled, priceUnavailable);
              const title = priceUnavailable
                ? "Güncel fiyat yok; güvenli kapatma hesaplanamıyor."
                : isMonitoring
                  ? "Pozisyon izleme sürecinde (12-24s); kapatma devre dışı."
                  : undefined;
              return (
                <tr key={t.id}>
                  <td className="font-medium">{t.symbol}</td>
                  <td><span className={`tag-${t.direction === "LONG" ? "success" : "danger"}`}>{t.direction}</span></td>
                  <td>{t.leverage}x</td>
                  <td>{fmtUsd(t.margin_used)}</td>
                  <td>{fmtNum(t.position_size, 4)}</td>
                  <td>{fmtNum(t.entry_price, 4)}</td>
                  <td>{fmtNum(t.stop_loss, 4)}</td>
                  <td>{fmtNum(t.take_profit, 4)}</td>
                  <td>{t.estimated_liquidation_price ? fmtNum(t.estimated_liquidation_price, 4) : "—"}</td>
                  <td>1:{fmtNum(t.risk_reward_ratio)}</td>
                  <td>{fmtNum(t.signal_score, 0)}</td>
                  <td className="text-xs text-muted">{new Date(t.opened_at).toLocaleString()}</td>
                  <td>
                    <button
                      className={cls}
                      onClick={() => onCloseClick(t)}
                      disabled={disabled}
                      aria-busy={closingId === t.id}
                      aria-disabled={disabled}
                      title={title}
                    >
                      {label}
                    </button>
                  </td>
                  <td>
                    <button
                      className="text-muted hover:text-danger transition-colors p-1"
                      title="Kaydı sil"
                      onClick={() => deleteTrade(t.id)}
                      aria-label="Kaydı sil"
                    >
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">Kapanan İşlemler</h2>
        <table className="t">
          <thead><tr>
            <th>Sembol</th><th>Yön</th><th>Kaldıraç</th><th>Giriş</th><th>Çıkış</th><th>Kâr/Zarar</th><th>%</th>
            <th>Ücretler</th><th>Kayma</th><th>Fonlama</th><th>Sebep</th><th>Kapanış</th><th></th>
          </tr></thead>
          {/* Toplam satırı — Panel KPI'ları ile aynı canonical kaynaktan
              (/api/paper-trades/performance → getPaperTradeStats). Burada
              gösterilen değer ile Panel "Toplam Kâr/Zarar" KPI'sı bire bir
              eşit olmalıdır; aksi durumda invariant testi (paper-stats-canonical)
              kırılır. */}
          {perf && (
            <tfoot>
              <tr className="font-medium">
                <td colSpan={5} className="text-right text-muted">
                  Toplam ({perf.totalTrades} kapalı işlem, bugün {perf.closedToday})
                </td>
                <td className={perf.totalPnl >= 0 ? "value-positive" : "value-negative"}>{fmtUsd(perf.totalPnl)}</td>
                <td colSpan={7} className="text-xs text-muted">
                  Günlük: <span className={perf.dailyPnl >= 0 ? "value-positive" : "value-negative"}>{fmtUsd(perf.dailyPnl)}</span> — Panel KPI ile birebir aynıdır (canonical paper-stats helper).
                </td>
              </tr>
            </tfoot>
          )}
          <tbody>
            {closed.length === 0 && <tr><td colSpan={13} className="text-muted">Henüz kapanan işlem yok</td></tr>}
            {closed.map((t) => (
              <tr key={t.id}>
                <td className="font-medium">{t.symbol}</td>
                <td><span className={`tag-${t.direction === "LONG" ? "success" : "danger"}`}>{t.direction}</span></td>
                <td>{t.leverage}x</td>
                <td>{fmtNum(t.entry_price, 4)}</td>
                <td>{fmtNum(t.exit_price, 4)}</td>
                <td className={Number(t.pnl) >= 0 ? "value-positive" : "value-negative"}>{fmtUsd(t.pnl)}</td>
                <td>{fmtPct(t.pnl_percent)}</td>
                <td>{fmtUsd(t.fees_estimated, 4)}</td>
                <td>{fmtUsd(t.slippage_estimated, 4)}</td>
                <td>{fmtUsd(t.funding_estimated, 4)}</td>
                <td>{t.exit_reason}</td>
                <td className="text-xs text-muted">{t.closed_at ? new Date(t.closed_at).toLocaleString() : "—"}</td>
                <td>
                  <button
                    className="text-muted hover:text-danger transition-colors p-1"
                    title="Kaydı sil"
                    onClick={() => deleteTrade(t.id)}
                    aria-label="Kaydı sil"
                  >
                    <TrashIcon />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {lossModal && (
        <LossCloseModal
          state={lossModal}
          busy={closingId !== null}
          onCancel={() => setLossModal(null)}
          onConfirm={confirmLossModal}
        />
      )}
    </div>
  );
}

function LossCloseModal({
  state,
  busy,
  onCancel,
  onConfirm,
}: {
  state: LossModalState;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="loss-close-title"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-bg-card shadow-2xl">
        <div className="px-5 py-4 border-b border-border">
          <h3 id="loss-close-title" className="text-base font-semibold text-danger">
            Zararda kapatma onayı
          </h3>
        </div>
        <div className="px-5 py-4 space-y-3 text-sm">
          <p>
            Bu pozisyon zararda. Kapatırsanız zarar realize edilir. Devam etmek istiyor musunuz?
          </p>
          <div className="rounded-md border border-border bg-bg-soft px-3 py-2 text-xs text-muted space-y-1">
            <div>
              <span className="text-slate-400">Sembol:</span>{" "}
              <span className="text-slate-200 font-medium">{state.trade.symbol}</span>{" "}
              <span className={`tag-${state.trade.direction === "LONG" ? "success" : "danger"} ml-1`}>
                {state.trade.direction}
              </span>
            </div>
            <div>
              <span className="text-slate-400">Tahmini net K/Z:</span>{" "}
              <span className="text-danger font-medium">
                {fmtUsd(state.netPnl)}
                {state.pnlPct != null ? ` (${fmtPct(state.pnlPct)})` : ""}
              </span>
            </div>
            {state.currentPrice != null && (
              <div>
                <span className="text-slate-400">Güncel fiyat:</span>{" "}
                <span className="text-slate-200">{fmtNum(state.currentPrice, 6)}</span>
              </div>
            )}
          </div>
        </div>
        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 text-xs rounded border border-border text-slate-300 hover:bg-bg-soft disabled:opacity-50"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="px-3 py-1.5 text-xs rounded border border-danger/40 bg-danger/15 text-danger font-semibold hover:bg-danger/25 disabled:opacity-50"
          >
            {busy ? "Kapatılıyor…" : "Zararı Onayla ve Kapat"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}
