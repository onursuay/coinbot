"use client";
import { useEffect, useState } from "react";
import { fmtNum, fmtPct } from "@/lib/format";

export default function StrategyPage() {
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
      <h1 className="text-xl font-semibold">Strategy / Watchlist</h1>
      <div className="flex gap-2">
        <select className="input w-32" value={exchange} onChange={(e) => setExchange(e.target.value)}>
          {["mexc", "binance", "okx", "bybit"].map((x) => <option key={x} value={x}>{x.toUpperCase()}</option>)}
        </select>
        <input className="input flex-1" placeholder="Sembol ekle (BTC/USDT)" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
        <button className="btn-primary" onClick={add} disabled={!symbol}>Ekle</button>
      </div>
      <section className="card">
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
        Strateji parametreleri Risk Settings'te tutuluyor; signal engine ek olarak BTC trendi, hacim teyidi,
        spread, funding rate ve volatilite filtrelerini uyguluyor. Sinyal skoru &lt;70 ise işlem açılmaz; 70-79 max 2x,
        80-89 max 3x, 90+ max 5x kaldıraca izin verilir (sistem 5x üst sınırı içinde).
      </div>
    </div>
  );
}
