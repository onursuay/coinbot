"use client";
import { useEffect, useState } from "react";

const EXCHANGES = ["mexc", "binance", "okx", "bybit"] as const;

export default function ApiSettings() {
  const [supported, setSupported] = useState<any[]>([]);
  const [connected, setConnected] = useState<any[]>([]);
  const [form, setForm] = useState({ exchange: "mexc", apiKey: "", apiSecret: "", apiPassphrase: "" });
  const [busy, setBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [diagChecks, setDiagChecks] = useState<Record<string, string> | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);

  const refresh = async () => {
    const [s, c] = await Promise.all([
      fetch("/api/exchanges/supported").then((r) => r.json()),
      fetch("/api/exchanges/connected").then((r) => r.json()),
    ]);
    if (s.ok) setSupported(s.data);
    if (c.ok) setConnected(c.data);
  };
  useEffect(() => { refresh(); }, []);

  const connect = async () => {
    setBusy(true);
    setConnectError(null);
    try {
      const r = await fetch("/api/exchanges/connect", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form),
      });
      const res = await r.json().catch(() => ({ ok: false, error: `Sunucu hatası (HTTP ${r.status})` }));
      if (!res.ok) {
        setConnectError(res.error ?? "Bilinmeyen hata");
      } else {
        setForm({ exchange: form.exchange, apiKey: "", apiSecret: "", apiPassphrase: "" });
        await refresh();
      }
    } catch (e: any) {
      setConnectError(e?.message ?? "Bağlantı hatası");
    } finally {
      setBusy(false);
    }
  };
  const validate = async (exchange: string) => {
    const res = await fetch("/api/exchanges/validate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ exchange }) }).then((r) => r.json());
    alert(res.ok ? `${exchange} erişilebilir.` : `Doğrulama hatası: ${res.error}`);
    refresh();
  };
  const setActive = async (exchange: string) => {
    try {
      const r = await fetch("/api/exchanges/set-active", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ exchange }) });
      const res = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
      if (!res.ok) alert(`Set Active hatası: ${res.error}`); else refresh();
    } catch (e: any) { alert(`Set Active hatası: ${e?.message}`); }
  };
  const disconnect = async (exchange: string) => {
    if (!confirm(`${exchange} bağlantısı silinsin mi?`)) return;
    const res = await fetch(`/api/exchanges/disconnect?exchange=${exchange}`, { method: "DELETE" }).then((r) => r.json());
    if (!res.ok) alert(res.error); else refresh();
  };

  const runDiag = async () => {
    setDiagBusy(true);
    setDiagChecks(null);
    try {
      const r = await fetch("/api/debug/connect-check");
      const j = await r.json();
      setDiagChecks(j.checks ?? {});
    } catch (e: any) {
      setDiagChecks({ hata: e?.message ?? "ulaşılamadı" });
    } finally {
      setDiagBusy(false);
    }
  };

  const sel = supported.find((x) => x.slug === form.exchange);
  const requiresPassphrase = sel?.requires_passphrase || form.exchange === "okx";

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">API Settings</h1>

      <div className="card text-sm text-warning space-y-1">
        <div>⚠ API key oluştururken <b>Withdrawal</b> iznini AÇMAYIN.</div>
        <div>⚠ Mümkünse <b>IP whitelist</b> kullanın (sunucu IP'leri için Vercel docs'a bakın).</div>
        <div>⚠ Trade izni olan API key'ler risk içerir; live trading varsayılan kapalıdır.</div>
      </div>

      {/* Diagnostics */}
      <div className="card space-y-2">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted">Bağlantı çalışmıyor mu?</span>
          <button className="btn-ghost text-xs" onClick={runDiag} disabled={diagBusy}>
            {diagBusy ? "Kontrol ediliyor..." : "Tanı Çalıştır"}
          </button>
        </div>
        {diagChecks && (
          <div className="grid grid-cols-1 gap-1 text-sm font-mono">
            {Object.entries(diagChecks).map(([k, v]) => (
              <div key={k} className={v.startsWith("✓") ? "text-success" : "text-danger"}>
                <span className="text-muted mr-2">{k}:</span>{v}
              </div>
            ))}
          </div>
        )}
      </div>

      <section className="card space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <div className="label">Exchange</div>
            <select className="input" value={form.exchange} onChange={(e) => setForm({ ...form, exchange: e.target.value })}>
              {EXCHANGES.map((e) => <option key={e} value={e}>{e.toUpperCase()}</option>)}
            </select>
          </div>
          <div>
            <div className="label">API Key</div>
            <input className="input" autoComplete="off" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
          </div>
          <div>
            <div className="label">API Secret</div>
            <input className="input" type="password" autoComplete="off" value={form.apiSecret} onChange={(e) => setForm({ ...form, apiSecret: e.target.value })} />
          </div>
        </div>
        {requiresPassphrase && (
          <div>
            <div className="label">API Passphrase (OKX)</div>
            <input className="input" type="password" autoComplete="off" value={form.apiPassphrase} onChange={(e) => setForm({ ...form, apiPassphrase: e.target.value })} />
          </div>
        )}
        <div className="flex items-center gap-3">
          <button className="btn-primary" onClick={connect} disabled={busy || !form.apiKey || !form.apiSecret}>
            {busy ? "Bağlanıyor..." : "Bağlan"}
          </button>
          {connectError && <span className="text-sm text-danger">{connectError}</span>}
        </div>
      </section>

      <section className="card">
        <h2 className="font-semibold mb-2">Bağlı Borsalar</h2>
        <table className="t">
          <thead><tr><th>Exchange</th><th>API Key</th><th>Active</th><th>Last Validated</th><th></th></tr></thead>
          <tbody>
            {connected.length === 0 && <tr><td colSpan={5} className="text-muted">henüz bağlı borsa yok</td></tr>}
            {connected.map((c) => (
              <tr key={c.id}>
                <td>{c.exchange_name.toUpperCase()}</td>
                <td className="font-mono">{c.masked_key}</td>
                <td>{c.is_active ? <span className="tag-success">active</span> : <span className="tag-muted">inactive</span>}</td>
                <td className="text-xs text-muted">{c.last_validated_at ?? "—"}</td>
                <td className="flex gap-2">
                  <button className="btn-ghost text-xs" onClick={() => validate(c.exchange_name)}>Validate</button>
                  <button className="btn-ghost text-xs" onClick={() => setActive(c.exchange_name)}>Set Active</button>
                  <button className="btn-danger text-xs" onClick={() => disconnect(c.exchange_name)}>Disconnect</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
