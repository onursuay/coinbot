"use client";
import { useEffect, useState, useCallback } from "react";

type Filter = "last100" | "last500" | "last1000" | "last24h" | "last7d" | "error" | "kill_switch";

interface FilterOption { value: Filter; label: string }
const FILTERS: FilterOption[] = [
  { value: "last100",      label: "Son 100"    },
  { value: "last500",      label: "Son 500"    },
  { value: "last1000",     label: "Son 1000"   },
  { value: "last24h",      label: "Son 24 saat"},
  { value: "last7d",       label: "Son 7 gün"  },
  { value: "error",        label: "Sadece Hata"},
  { value: "kill_switch",  label: "Kill Switch"},
];

interface Meta { filter: Filter; limit: number; total: number }

export default function LogsPage() {
  const [logs, setLogs]         = useState<any[]>([]);
  const [risk, setRisk]         = useState<any[]>([]);
  const [meta, setMeta]         = useState<Meta | null>(null);
  const [filter, setFilter]     = useState<Filter>("last500");
  const [loading, setLoading]   = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [cleanupResult, setCleanupResult] = useState<{ deleted: number; ranAt: string } | null>(null);
  const [cleanupRunning, setCleanupRunning] = useState(false);

  const refresh = useCallback(async (f: Filter = filter) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/logs?filter=${f}`, { cache: "no-store" }).then((res) => res.json());
      if (r.ok) {
        setLogs(r.data.logs);
        setRisk(r.data.riskEvents);
        setMeta(r.data.meta);
        setLastRefresh(new Date());
      }
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { refresh(filter); }, [filter]);

  const handleCleanup = async () => {
    setCleanupRunning(true);
    try {
      const r = await fetch("/api/logs/cleanup", { method: "POST", cache: "no-store" }).then((res) => res.json());
      if (r.ok) {
        setCleanupResult({ deleted: r.data.deleted_total, ranAt: r.data.ran_at });
        await refresh(filter);
      }
    } finally {
      setCleanupRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Logs</h1>
          <p className="text-xs text-muted mt-0.5">
            Eski loglar otomatik temizlenir: debug/info 7g · warn 14g · error 30g · kill_switch 90g
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {meta && (
            <span className="text-xs text-muted">
              {meta.total} kayıt gösteriliyor
            </span>
          )}
          {lastRefresh && (
            <span className="text-xs text-muted">
              {lastRefresh.toLocaleTimeString("tr-TR")}
            </span>
          )}
          <button
            className="btn-primary whitespace-nowrap px-3 text-sm"
            onClick={() => refresh(filter)}
            disabled={loading}
          >
            {loading ? "Yükleniyor..." : "Yenile"}
          </button>
          <button
            className="btn-secondary whitespace-nowrap px-3 text-sm"
            onClick={handleCleanup}
            disabled={cleanupRunning}
            title="Eski log kayıtlarını temizle (trade verileri silinmez)"
          >
            {cleanupRunning ? "Temizleniyor..." : "Temizle"}
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
              filter === f.value
                ? "bg-accent text-white border-accent"
                : "border-border text-muted hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Cleanup result */}
      {cleanupResult && (
        <div className="card text-xs text-muted py-2 px-3">
          Son temizlik: <span className="text-success">{cleanupResult.deleted}</span> kayıt silindi
          &nbsp;·&nbsp;{new Date(cleanupResult.ranAt).toLocaleString("tr-TR")}
          &nbsp;·&nbsp;Sonraki otomatik temizlik 24 saatte çalışır.
        </div>
      )}

      {/* Bot Logs */}
      <section className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">
          Bot Logs
          {logs.length > 0 && <span className="text-muted text-xs font-normal ml-2">({logs.length})</span>}
        </h2>
        <table className="t">
          <thead>
            <tr>
              <th>Zaman</th>
              <th>Lv</th>
              <th>Event</th>
              <th>Exchange</th>
              <th>Mesaj</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr><td colSpan={5} className="text-muted text-center py-4">log yok</td></tr>
            )}
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="text-xs text-muted whitespace-nowrap">
                  {new Date(l.created_at).toLocaleString("tr-TR")}
                </td>
                <td>
                  <span className={`tag-${l.level === "error" ? "danger" : l.level === "warn" ? "warning" : "muted"}`}>
                    {l.level}
                  </span>
                </td>
                <td className="text-xs">{l.event_type}</td>
                <td className="text-xs">{l.exchange_name ?? "—"}</td>
                <td className="text-xs">{l.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Risk Events */}
      <section className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">
          Risk Events
          {risk.length > 0 && <span className="text-muted text-xs font-normal ml-2">({risk.length})</span>}
        </h2>
        <table className="t">
          <thead>
            <tr>
              <th>Zaman</th>
              <th>Severity</th>
              <th>Event</th>
              <th>Symbol</th>
              <th>Mesaj</th>
            </tr>
          </thead>
          <tbody>
            {risk.length === 0 && (
              <tr><td colSpan={5} className="text-muted text-center py-4">risk olayı yok</td></tr>
            )}
            {risk.map((l) => (
              <tr key={l.id}>
                <td className="text-xs text-muted whitespace-nowrap">
                  {new Date(l.created_at).toLocaleString("tr-TR")}
                </td>
                <td>
                  <span className={`tag-${l.severity === "critical" ? "danger" : l.severity === "warning" ? "warning" : "muted"}`}>
                    {l.severity}
                  </span>
                </td>
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
