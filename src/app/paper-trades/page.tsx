"use client";
import { useEffect, useState } from "react";
import { fmtNum, fmtUsd, fmtPct } from "@/lib/format";

export default function PaperTradesPage() {
  const [open, setOpen] = useState<any[]>([]);
  const [closed, setClosed] = useState<any[]>([]);
  const refresh = async () => {
    const r = await fetch("/api/paper-trades?limit=200").then((r) => r.json());
    if (r.ok) { setOpen(r.data.open); setClosed(r.data.closed); }
  };
  useEffect(() => { refresh(); const t = setInterval(refresh, 8000); return () => clearInterval(t); }, []);

  const close = async (id: string) => {
    if (!confirm("Pozisyon canlı fiyattan paper olarak kapatılsın mı?")) return;
    const res = await fetch("/api/paper-trades/close", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tradeId: id, reason: "manual" }),
    }).then((r) => r.json());
    if (!res.ok) alert(res.error);
    refresh();
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Sanal İşlemler</h1>

      <section className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">Açık Pozisyonlar</h2>
        <table className="t">
          <thead><tr>
            <th>Sembol</th><th>Yön</th><th>Kaldıraç</th><th>Marjin</th><th>Boyut</th>
            <th>Giriş</th><th>Zarar Durdur</th><th>Kâr Al</th><th>Tahmini Likidasyon</th><th>Risk/Ödül</th><th>Skor</th><th>Açılış</th><th></th>
          </tr></thead>
          <tbody>
            {open.length === 0 && <tr><td colSpan={13} className="text-muted">Açık pozisyon yok</td></tr>}
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
                <td><button className="btn-ghost text-xs" onClick={() => close(t.id)}>Kapat</button></td>
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
            <th>Ücretler</th><th>Kayma</th><th>Fonlama</th><th>Sebep</th><th>Kapanış</th>
          </tr></thead>
          <tbody>
            {closed.length === 0 && <tr><td colSpan={12} className="text-muted">Henüz kapanan işlem yok</td></tr>}
            {closed.map((t) => (
              <tr key={t.id}>
                <td className="font-medium">{t.symbol}</td>
                <td><span className={`tag-${t.direction === "LONG" ? "success" : "danger"}`}>{t.direction}</span></td>
                <td>{t.leverage}x</td>
                <td>{fmtNum(t.entry_price, 4)}</td>
                <td>{fmtNum(t.exit_price, 4)}</td>
                <td className={Number(t.pnl) >= 0 ? "text-success" : "text-danger"}>{fmtUsd(t.pnl)}</td>
                <td>{fmtPct(t.pnl_percent)}</td>
                <td>{fmtUsd(t.fees_estimated, 4)}</td>
                <td>{fmtUsd(t.slippage_estimated, 4)}</td>
                <td>{fmtUsd(t.funding_estimated, 4)}</td>
                <td>{t.exit_reason}</td>
                <td className="text-xs text-muted">{t.closed_at ? new Date(t.closed_at).toLocaleString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
