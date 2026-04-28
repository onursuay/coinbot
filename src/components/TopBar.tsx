"use client";
import { useEffect, useState } from "react";
import KillSwitch from "./KillSwitch";

interface Status {
  bot: any | null;
  daily: any;
  liveTrading: boolean;
  openPositions: number;
  config: any;
}

export default function TopBar() {
  const [s, setS] = useState<Status | null>(null);
  const [workerOnline, setWorkerOnline] = useState<boolean | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [statusRes, heartbeatRes] = await Promise.all([
          fetch("/api/bot/status", { cache: "no-store" }),
          fetch("/api/bot/heartbeat", { cache: "no-store" }),
        ]);
        const [statusJson, heartbeatJson] = await Promise.all([
          statusRes.json(),
          heartbeatRes.json(),
        ]);
        if (!active) return;
        if (statusJson.ok) setS(statusJson.data);
        setWorkerOnline(heartbeatJson?.online === true);
        setLastFetch(new Date());
      } catch { /* ignore */ }
    };
    load();
    const t = setInterval(load, 15000);
    return () => { active = false; clearInterval(t); };
  }, []);

  const status = s?.bot?.bot_status ?? "stopped";
  const mode = s?.bot?.trading_mode ?? "paper";
  const exchange = s === null ? "..." : (s?.bot?.active_exchange ?? "binance");

  const statusLabel = status === "running" ? "ÇALIŞIYOR" : status === "stopped" ? "DURDU" : status.toUpperCase().replace(/_/g, " ");
  const modeLabel = mode === "paper" ? "SANAL MOD" : mode === "live" ? "CANLI MOD" : mode.toUpperCase();

  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-border bg-bg-soft/60 backdrop-blur">
      <div className="flex items-center gap-2 text-sm flex-wrap">
        <span className={`tag ${status === "running" ? "tag-success" : status === "kill_switch" ? "tag-danger" : "tag-muted"}`}>
          {statusLabel}
        </span>
        <span className="tag-accent">{modeLabel}</span>
        <span className="tag-muted">{String(exchange).toUpperCase()}</span>
        {s?.liveTrading
          ? <span className="tag-warning">CANLI İŞLEM AÇIK</span>
          : <span className="tag-success">CANLI İŞLEM KAPALI</span>}
        <span className="flex items-center gap-1 tag-muted">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
          OTOMATİK YENİLEME: AÇIK
        </span>
        {lastFetch && (
          <span className="tag-muted">
            SON GÜNCELLEME: {lastFetch.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        )}
        {workerOnline !== null && (
          <span className={`tag ${workerOnline ? "tag-success" : "tag-danger"}`}>
            {workerOnline ? "SUNUCU BOT ÇEVRİMİÇİ" : "SUNUCU BOT ÇEVRİMDIŞI"}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 text-sm">
        {s && (
          <div className="text-slate-300">
            Günlük K/Z <span className={s.daily.realizedPnlUsd >= 0 ? "text-success" : "text-danger"}>${s.daily.realizedPnlUsd.toFixed(2)}</span>
            <span className="text-muted"> / hedef ${s.daily.dailyTargetUsd}</span>
          </div>
        )}
        <KillSwitch />
      </div>
    </header>
  );
}
