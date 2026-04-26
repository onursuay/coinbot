"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

const DEFAULTS = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT"];

export default function CoinsIndex() {
  const [exchange, setExchange] = useState("mexc");
  const [list, setList] = useState<string[]>(DEFAULTS);
  const [filter, setFilter] = useState("");
  useEffect(() => {
    fetch(`/api/market/symbols?exchange=${exchange}`).then((r) => r.json())
      .then((j) => j.ok && setList((j.data ?? []).slice(0, 200).map((s: any) => s.symbol)))
      .catch(() => setList(DEFAULTS));
  }, [exchange]);
  const filtered = list.filter((s) => s.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Coin Detail</h1>
      <div className="flex gap-2">
        <select className="input w-32" value={exchange} onChange={(e) => setExchange(e.target.value)}>
          {["mexc", "binance", "okx", "bybit"].map((x) => <option key={x} value={x}>{x.toUpperCase()}</option>)}
        </select>
        <input className="input flex-1" placeholder="Sembol ara..." value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="card grid grid-cols-2 md:grid-cols-4 gap-2">
        {filtered.slice(0, 80).map((s) => (
          <Link key={s} href={`/coins/${encodeURIComponent(s)}?exchange=${exchange}`} className="btn-ghost text-sm">{s}</Link>
        ))}
      </div>
    </div>
  );
}
