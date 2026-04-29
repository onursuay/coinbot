"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { fmtNum, fmtPct, fmtUsd } from "@/lib/format";

const TFS = ["1m", "5m", "15m", "1h", "4h"] as const;

async function safeJson(url: string, opts?: RequestInit): Promise<any> {
  try {
    const r = await fetch(url, opts);
    const text = await r.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function sanitizeApiError(err: unknown): string {
  if (!err || typeof err !== "string") return "Veri alınamadı.";
  // Never show raw HTTP status codes (451, 403, 429 etc.) to the user.
  if (/^HTTP\s+\d{3}/i.test(err)) return "Veri geçici olarak alınamıyor.";
  if (err.length > 120) return err.slice(0, 120) + "…";
  return err;
}

export default function CoinDetail() {
  const params = useParams<{ symbol: string }>();
  const search = useSearchParams();
  const exchange = search.get("exchange") ?? "mexc";
  const symbol = decodeURIComponent(params.symbol as string);
  const [tf, setTf] = useState<(typeof TFS)[number]>("15m");
  const [klines, setKlines] = useState<any[]>([]);
  const [ticker, setTicker] = useState<any>(null);
  const [funding, setFunding] = useState<any>(null);
  const [signal, setSignal] = useState<any>(null);
  const [signalError, setSignalError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setSignalError(null);
    try {
      const [k, t, f] = await Promise.all([
        safeJson(`/api/market/klines?exchange=${exchange}&symbol=${encodeURIComponent(symbol)}&timeframe=${tf}&limit=200`),
        safeJson(`/api/market/ticker?exchange=${exchange}&symbol=${encodeURIComponent(symbol)}`),
        safeJson(`/api/market/funding-rate?exchange=${exchange}&symbol=${encodeURIComponent(symbol)}`),
      ]);
      if (k.ok) setKlines(k.data);
      if (t.ok) setTicker(t.data);
      if (f.ok) setFunding(f.data);
      const sig = await safeJson("/api/signals/generate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ exchange, symbol, timeframe: tf }),
      });
      if (sig.ok) setSignal(sig.data);
      else setSignalError(sanitizeApiError(sig.error) ?? "Sinyal verisi alınamadı.");
    } catch {
      setSignalError("Sinyal verisi alınamadı.");
    } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [tf, exchange, symbol]);

  const last = klines.at(-1);

  const openPaper = async () => {
    if (!signal || (signal.signalType !== "LONG" && signal.signalType !== "SHORT")) {
      alert("İşlem açılabilir bir sinyal yok.");
      return;
    }
    const res = await fetch("/api/paper-trades/open", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        exchange, symbol, direction: signal.signalType,
        entryPrice: signal.entryPrice, stopLoss: signal.stopLoss, takeProfit: signal.takeProfit,
        signalScore: signal.score, entryReason: (signal.reasons ?? []).join(" • "),
      }),
    }).then((r) => r.json());
    if (!res.ok) alert(res.error ?? "İşlem açılamadı");
    else alert("Paper işlem açıldı");
  };

  const ohlcSparkline = useMemo(() => {
    if (klines.length === 0) return null;
    const w = 600, h = 140, pad = 6;
    const min = Math.min(...klines.map((k) => k.low));
    const max = Math.max(...klines.map((k) => k.high));
    const range = Math.max(1e-9, max - min);
    const stepX = (w - pad * 2) / klines.length;
    return (
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-36">
        {klines.map((k, i) => {
          const x = pad + i * stepX;
          const yHigh = h - pad - ((k.high - min) / range) * (h - pad * 2);
          const yLow = h - pad - ((k.low - min) / range) * (h - pad * 2);
          const yOpen = h - pad - ((k.open - min) / range) * (h - pad * 2);
          const yClose = h - pad - ((k.close - min) / range) * (h - pad * 2);
          const up = k.close >= k.open;
          return (
            <g key={i} stroke={up ? "#22c55e" : "#ef4444"}>
              <line x1={x + stepX / 2} x2={x + stepX / 2} y1={yHigh} y2={yLow} strokeWidth={1} />
              <rect x={x + 1} y={Math.min(yOpen, yClose)} width={Math.max(1, stepX - 2)} height={Math.max(1, Math.abs(yClose - yOpen))} fill={up ? "#22c55e" : "#ef4444"} fillOpacity={0.5} />
            </g>
          );
        })}
      </svg>
    );
  }, [klines]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{symbol} <span className="text-muted text-sm">— {exchange.toUpperCase()}</span></h1>
        <div className="flex gap-2 items-center">
          {TFS.map((t) => (
            <button key={t} className={`btn-ghost text-xs ${tf === t ? "border-accent text-accent" : ""}`} onClick={() => setTf(t)}>{t}</button>
          ))}
          <button className="btn-primary" onClick={refresh} disabled={loading}>{loading ? "..." : "Refresh"}</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Kpi label="Last" value={fmtNum(ticker?.lastPrice, 4)} />
        <Kpi label="24h Change" value={fmtPct(ticker?.changePercent24h ?? 0)} accent={(ticker?.changePercent24h ?? 0) >= 0 ? "success" : "danger"} />
        <Kpi label="24h Quote Volume" value={fmtUsd(ticker?.quoteVolume24h ?? 0, 0)} />
        <Kpi label="Funding" value={funding ? fmtPct(funding.rate * 100, 4) : "—"} />
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">Candles ({tf})</h2>
          <span className="text-xs text-muted">{klines.length} mum • Son: {last ? fmtNum(last.close, 4) : "—"}</span>
        </div>
        {ohlcSparkline}
      </div>

      <div className="card">
        <h2 className="font-semibold mb-2">Latest Signal</h2>
        {loading && !signal ? <div className="text-muted text-sm">hesaplanıyor…</div>
         : signalError ? <div className="text-muted text-sm">{signalError}</div>
         : !signal ? <div className="text-muted text-sm">Bu coin için güncel sinyal verisi yok.</div>
         : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <div className="label">Tip</div>
              <div className={`tag-${signal.signalType === "LONG" ? "success" : signal.signalType === "SHORT" ? "danger" : "muted"} text-base`}>
                {signal.signalType}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Box label="Entry" value={fmtNum(signal.entryPrice, 4)} />
                <Box label="Stop" value={fmtNum(signal.stopLoss, 4)} />
                <Box label="Take" value={fmtNum(signal.takeProfit, 4)} />
                <Box label="R:R" value={signal.riskRewardRatio ? `1:${fmtNum(signal.riskRewardRatio)}` : "—"} />
                <Box label="Skor" value={String(signal.score ?? 0)} />
              </div>
              <button onClick={openPaper} className="btn-primary mt-3" disabled={signal.signalType !== "LONG" && signal.signalType !== "SHORT"}>
                Paper işlem aç (risk engine onayıyla)
              </button>
            </div>
            <div>
              <div className="label">Nedenler</div>
              <ul className="list-disc list-inside text-slate-300 space-y-1">
                {(signal.reasons ?? []).map((r: string, i: number) => <li key={i}>{r}</li>)}
                {signal.rejectedReason && <li className="text-warning">Red: {signal.rejectedReason}</li>}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: "success" | "danger" }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className={`text-xl font-semibold ${accent === "success" ? "text-success" : accent === "danger" ? "text-danger" : ""}`}>{value}</div>
    </div>
  );
}
function Box({ label, value }: { label: string; value: string }) {
  return <div className="bg-bg-soft border border-border rounded-lg px-2 py-1"><div className="label">{label}</div><div>{value}</div></div>;
}
