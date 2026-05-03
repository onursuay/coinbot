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
    case "CLOSE_FAILED":
      return "Paper pozisyon kapatılamadı (sunucu hatası).";
    default:
      return fallback || "Paper pozisyon kapatılamadı.";
  }
}

export default function PaperTradesPage() {
  const [open, setOpen] = useState<any[]>([]);
  const [closed, setClosed] = useState<any[]>([]);
  // Canonical aggregate — Panel KPI ile aynı kaynaktan (paper-stats helper).
  // Tablo altındaki "Toplam" satırı bu değerlerden render edilir, böylece
  // kullanıcı Panel KPI ile satır toplamının birebir eşit olduğunu ekrandan
  // doğrulayabilir.
  const [perf, setPerf] = useState<{ totalPnl: number; dailyPnl: number; totalTrades: number; closedToday: number } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [closeNotice, setCloseNotice] = useState<CloseNotice | null>(null);
  // Per-trade loading flag — prevents double-clicks from sending a second
  // close request while the first is in flight.
  const [closingId, setClosingId] = useState<string | null>(null);

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

  const close = async (id: string) => {
    if (closingId) return; // ignore second click while a close is pending
    if (!confirm("Pozisyon canlı fiyattan paper olarak kapatılsın mı?")) return;
    setCloseNotice(null);
    setClosingId(id);
    try {
      let res: any = null;
      try {
        const r = await fetch("/api/paper-trades/close", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tradeId: id, reason: "manual" }),
        });
        res = await r.json().catch(() => ({ ok: false, error: "Sunucu yanıtı okunamadı." }));
      } catch (e: any) {
        res = { ok: false, error: e?.message ?? "Ağ hatası" };
      }

      if (res?.ok) {
        if (res.closePriceSource === "fallback_signal") {
          setCloseNotice({
            level: "warning",
            text: "Pozisyon kapatıldı; ancak Binance ticker erişilemedi, son bilinen fiyat (signals.entry_price) kullanıldı.",
          });
        } else {
          setCloseNotice({ level: "success", text: "Pozisyon kapatıldı." });
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
            {open.map((t) => (
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
                    className="btn-ghost text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => close(t.id)}
                    disabled={closingId === t.id || (closingId !== null && closingId !== t.id)}
                    aria-busy={closingId === t.id}
                  >
                    {closingId === t.id ? "Kapatılıyor…" : "Kapat"}
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
            ))}
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
