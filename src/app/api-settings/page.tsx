"use client";
import { useEffect, useState } from "react";

const EXCHANGES = ["binance", "mexc", "okx", "bybit"] as const;

type ChecklistState = "unknown" | "confirmed" | "failed";
type CredStatus = {
  presence: {
    apiKeyPresent: boolean;
    apiSecretPresent: boolean;
    apiKeyMasked: string | null;
    baseUrl: string;
    usingTestnet: boolean;
    credentialConfigured: boolean;
  };
  futuresAccess: {
    futuresAccessOk: boolean;
    accountReadOk: boolean;
    permissionError: string | null;
    errorCode: string | null;
    errorMessageSafe: string | null;
    lastCheckedAt: string;
  };
  checklist: {
    withdrawPermissionDisabled: ChecklistState;
    ipRestrictionConfigured: ChecklistState;
    futuresPermissionConfirmed: ChecklistState;
    extraPermissionsReviewed: ChecklistState;
    updatedAt: string | null;
  };
  recommendedVpsIp: string;
  liveGateOpen: boolean;
};

const CHECKLIST_LABELS: Record<keyof CredStatus["checklist"], string> = {
  withdrawPermissionDisabled: "Withdraw izni kapalı",
  ipRestrictionConfigured: "IP restriction VPS IP ile sınırlı",
  futuresPermissionConfirmed: "Futures permission doğrulandı",
  extraPermissionsReviewed: "Gereksiz izinler kapalı",
  updatedAt: "",
};

export default function ApiSettings() {
  const [supported, setSupported] = useState<any[]>([]);
  const [connected, setConnected] = useState<any[]>([]);
  const [form, setForm] = useState({ exchange: "binance", apiKey: "", apiSecret: "", apiPassphrase: "" });
  const [busy, setBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [diagChecks, setDiagChecks] = useState<Record<string, string> | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  const [credStatus, setCredStatus] = useState<CredStatus | null>(null);
  const [credBusy, setCredBusy] = useState(false);

  const refreshCredStatus = async () => {
    setCredBusy(true);
    try {
      const r = await fetch(`/api/binance-credentials/status?t=${Date.now()}`, { cache: "no-store" });
      const j = await r.json();
      if (j.ok) setCredStatus(j.data as CredStatus);
    } catch { /* silent */ }
    finally { setCredBusy(false); }
  };

  const setChecklist = async (key: keyof CredStatus["checklist"], value: ChecklistState) => {
    if (key === "updatedAt") return;
    await fetch("/api/binance-credentials/checklist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    });
    await refreshCredStatus();
  };

  const refresh = async () => {
    const t = Date.now();
    const [s, c] = await Promise.all([
      fetch(`/api/exchanges/supported?t=${t}`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/exchanges/connected?t=${t}`, { cache: "no-store" }).then((r) => r.json()),
    ]);
    if (s.ok) setSupported(s.data);
    if (c.ok) setConnected(c.data);
  };
  useEffect(() => { refresh(); refreshCredStatus(); }, []);

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
      if (!res.ok) {
        alert(`Set Active hatası: ${res.error}`);
      } else {
        await refresh();
      }
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
      const r = await fetch(`/api/debug/connect-check?t=${Date.now()}`, { cache: "no-store" });
      const j = await r.json();
      setDiagChecks(j.checks ?? {});
      await refresh();
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

      {/* Faz 17 — Binance Credential / Permission / IP Validation */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Binance Credential Durumu (read-only)</h2>
          <button className="btn-ghost text-xs" onClick={refreshCredStatus} disabled={credBusy}>
            {credBusy ? "Kontrol ediliyor..." : "Yenile"}
          </button>
        </div>
        {!credStatus && <div className="text-sm text-muted">Yükleniyor...</div>}
        {credStatus && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div className="space-y-1">
              <div><span className="text-muted">API Key:</span> {credStatus.presence.apiKeyPresent
                ? <span className="font-mono">{credStatus.presence.apiKeyMasked}</span>
                : <span className="text-warning">tanımlı değil</span>}</div>
              <div><span className="text-muted">API Secret:</span> {credStatus.presence.apiSecretPresent
                ? <span className="text-success">tanımlı (gizli)</span>
                : <span className="text-warning">tanımlı değil</span>}</div>
              <div><span className="text-muted">Base URL:</span> <span className="font-mono">{credStatus.presence.baseUrl}</span></div>
              <div><span className="text-muted">Mod:</span> {credStatus.presence.usingTestnet
                ? <span className="tag-muted">testnet</span>
                : <span className="tag-success">mainnet</span>}</div>
            </div>
            <div className="space-y-1">
              <div><span className="text-muted">Futures public erişim:</span> {credStatus.futuresAccess.futuresAccessOk
                ? <span className="text-success">OK</span>
                : <span className="text-danger">FAIL</span>}</div>
              <div><span className="text-muted">Account read:</span> {credStatus.futuresAccess.accountReadOk
                ? <span className="text-success">OK</span>
                : <span className="text-danger">FAIL</span>}</div>
              {credStatus.futuresAccess.errorMessageSafe && (
                <div className="text-xs text-danger">Hata: {credStatus.futuresAccess.errorMessageSafe}</div>
              )}
              <div className="text-xs text-muted">Son kontrol: {credStatus.futuresAccess.lastCheckedAt}</div>
              <div><span className="text-muted">Live gate:</span> {credStatus.liveGateOpen
                ? <span className="text-warning">açık (env)</span>
                : <span className="tag-success">kapalı</span>}</div>
            </div>
          </div>
        )}
      </section>

      {credStatus && (
        <section className="card space-y-3">
          <h2 className="font-semibold">Güvenlik Checklist (manuel doğrulama)</h2>
          <div className="text-xs text-muted">
            Aşağıdaki kontroller Binance API Management üzerinde manuel olarak yapılır.
            Bu sayfa sadece durumu kayıt altına alır; Binance hesabına müdahale etmez.
          </div>
          <div className="grid grid-cols-1 gap-2">
            {(["withdrawPermissionDisabled", "ipRestrictionConfigured", "futuresPermissionConfirmed", "extraPermissionsReviewed"] as const).map((k) => {
              const v = credStatus.checklist[k];
              return (
                <div key={k} className="flex flex-wrap items-center gap-2 border border-white/5 rounded p-2">
                  <div className="text-sm flex-1 min-w-[140px]">{CHECKLIST_LABELS[k]}</div>
                  <div className="flex flex-wrap gap-1">
                    <button
                      className={v === "confirmed" ? "btn-primary text-xs" : "btn-ghost text-xs"}
                      onClick={() => setChecklist(k, "confirmed")}
                    >Onaylandı</button>
                    <button
                      className={v === "failed" ? "btn-danger text-xs" : "btn-ghost text-xs"}
                      onClick={() => setChecklist(k, "failed")}
                    >Başarısız</button>
                    <button
                      className={v === "unknown" ? "btn-ghost text-xs underline" : "btn-ghost text-xs"}
                      onClick={() => setChecklist(k, "unknown")}
                    >Bilinmiyor</button>
                  </div>
                </div>
              );
            })}
          </div>
          {credStatus.checklist.updatedAt && (
            <div className="text-xs text-muted">Son güncelleme: {credStatus.checklist.updatedAt}</div>
          )}
        </section>
      )}

      {credStatus && (
        <section className="card space-y-1">
          <h2 className="font-semibold">Önerilen VPS IP</h2>
          <div className="text-sm font-mono">{credStatus.recommendedVpsIp}</div>
          <div className="text-xs text-muted">
            Binance API Management tarafında IP restriction alanına yukarıdaki IP girilmelidir.
            Withdraw izni kapalı bırakılmalıdır.
          </div>
        </section>
      )}

      <div className="card text-sm text-warning space-y-1">
        <div>⚠ API key oluştururken <b>Withdrawal</b> iznini AÇMAYIN.</div>
        <div>⚠ Mümkünse <b>IP whitelist</b> kullanın (sunucu IP&apos;leri için Vercel docs&apos;a bakın).</div>
        <div>⚠ Trade izni olan API key&apos;ler risk içerir; live trading varsayılan kapalıdır.</div>
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

      <section className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">Bağlı Borsalar</h2>
        <table className="t min-w-[560px]">
          <thead><tr><th>Exchange</th><th>API Key</th><th>Active</th><th>Last Validated</th><th></th></tr></thead>
          <tbody>
            {connected.length === 0 && <tr><td colSpan={5} className="text-muted">henüz bağlı borsa yok</td></tr>}
            {connected.map((c) => (
              <tr key={c.id}>
                <td>{c.exchange.toUpperCase()}</td>
                <td className="font-mono">{c.masked_api_key}</td>
                <td>{c.is_active ? <span className="tag-success">active</span> : <span className="tag-muted">inactive</span>}</td>
                <td className="text-xs text-muted">{c.last_validated_at ?? "—"}</td>
                <td className="flex gap-2">
                  <button className="btn-ghost text-xs" onClick={() => validate(c.exchange)}>Validate</button>
                  <button className="btn-ghost text-xs" onClick={() => setActive(c.exchange)}>Set Active</button>
                  <button className="btn-danger text-xs" onClick={() => disconnect(c.exchange)}>Disconnect</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
