"use client";
import { useEffect, useState } from "react";

export default function LogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [risk, setRisk] = useState<any[]>([]);
  const refresh = async () => {
    const r = await fetch("/api/logs?limit=300").then((r) => r.json());
    if (r.ok) { setLogs(r.data.logs); setRisk(r.data.riskEvents); }
  };
  useEffect(() => { refresh(); const t = setInterval(refresh, 6000); return () => clearInterval(t); }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Logs</h1>
      <section className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">Bot Logs</h2>
        <table className="t">
          <thead><tr><th>Time</th><th>Lv</th><th>Event</th><th>Exchange</th><th>Mesaj</th></tr></thead>
          <tbody>
            {logs.length === 0 && <tr><td colSpan={5} className="text-muted">log yok</td></tr>}
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="text-xs text-muted whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</td>
                <td><span className={`tag-${l.level === "error" ? "danger" : l.level === "warn" ? "warning" : "muted"}`}>{l.level}</span></td>
                <td className="text-xs">{l.event_type}</td>
                <td className="text-xs">{l.exchange_name ?? "—"}</td>
                <td className="text-xs">{l.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">Risk Events</h2>
        <table className="t">
          <thead><tr><th>Time</th><th>Severity</th><th>Event</th><th>Symbol</th><th>Mesaj</th></tr></thead>
          <tbody>
            {risk.length === 0 && <tr><td colSpan={5} className="text-muted">risk olayı yok</td></tr>}
            {risk.map((l) => (
              <tr key={l.id}>
                <td className="text-xs text-muted whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</td>
                <td><span className={`tag-${l.severity === "critical" ? "danger" : l.severity === "warning" ? "warning" : "muted"}`}>{l.severity}</span></td>
                <td className="text-xs">{l.event_type}</td>
                <td className="text-xs">{l.symbol ?? "—"}</td>
                <td className="text-xs">{l.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
