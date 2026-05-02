"use client";
import { useEffect, useState } from "react";
import KillSwitch from "./KillSwitch";
import { useSoundPref } from "@/lib/sound-pref";
import {
  PAPER_POSITION_ALERT_SOUND_URL,
  readPaperNotificationPermission,
  requestPaperNotificationPermission,
  type PaperNotificationPermissionState,
} from "@/lib/paper-position-alerts";

interface Status {
  bot: any | null;
  daily: any;
  liveTrading: boolean;
  openPositions: number;
  config: any;
}

// Uniform pill style — all top-bar badges share the same height/padding/font.
const PILL = "h-6 px-2 inline-flex items-center gap-1 text-[11px] font-medium leading-none rounded-md whitespace-nowrap";

export default function TopBar() {
  const [s, setS] = useState<Status | null>(null);
  const [workerOnline, setWorkerOnline] = useState<boolean | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [notificationPermission, setNotificationPermission] =
    useState<PaperNotificationPermissionState>("unsupported");
  const { enabled: soundEnabled, setEnabled: setSoundEnabled } = useSoundPref();

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    if (next && typeof Audio !== "undefined") {
      // Audio unlock — happens inside a user gesture so subsequent
      // programmatic plays from the global notifier are allowed.
      try {
        const a = new Audio(PAPER_POSITION_ALERT_SOUND_URL);
        a.volume = 0.7;
        a.play().then(() => { a.pause(); a.currentTime = 0; }).catch(() => { /* ignore */ });
      } catch { /* ignore */ }
    }
  };

  const requestNotifications = async () => {
    if (notificationPermission !== "default") return;
    setNotificationPermission(await requestPaperNotificationPermission());
  };

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
        setWorkerOnline(heartbeatJson?.data?.online === true || heartbeatJson?.online === true);
        setLastFetch(new Date());
      } catch { /* ignore */ }
    };
    load();
    const t = setInterval(load, 15000);
    return () => { active = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    const syncPermission = () => {
      setNotificationPermission(readPaperNotificationPermission());
    };
    syncPermission();
    window.addEventListener("coinbot:paper-notification-permission", syncPermission);
    return () => {
      window.removeEventListener("coinbot:paper-notification-permission", syncPermission);
    };
  }, []);

  const status = s?.bot?.bot_status ?? "stopped";
  const mode = s?.bot?.trading_mode ?? "paper";
  const exchange = s === null ? "..." : (s?.bot?.active_exchange ?? "binance");

  const statusLabel = status === "running" ? "ÇALIŞIYOR" : status === "stopped" ? "DURDU" : status.toUpperCase().replace(/_/g, " ");
  const modeLabel = mode === "paper" ? "SANAL" : mode === "live" ? "CANLI" : mode.toUpperCase();

  const statusClass = status === "running"
    ? "bg-success/15 text-success"
    : status === "kill_switch"
      ? "bg-danger/15 text-danger"
      : "bg-slate-700/40 text-slate-300";

  const notificationLabel =
    notificationPermission === "granted" ? "AÇIK"
      : notificationPermission === "default" ? "İZİN GEREKLİ"
        : notificationPermission === "denied" ? "KAPALI"
          : "DESTEK YOK";
  const notificationClass =
    notificationPermission === "granted" ? "bg-success/15 text-success"
      : notificationPermission === "default" ? "bg-warning/15 text-warning"
        : "bg-slate-700/40 text-slate-300";
  const notificationTitle =
    notificationPermission === "default"
      ? "Desktop bildirimi açmak için tıkla"
      : notificationPermission === "denied"
        ? "Tarayıcı bildirim izni engellenmiş"
        : notificationPermission === "granted"
          ? "Desktop bildirimleri açık"
          : "Tarayıcı desktop bildirimini desteklemiyor";

  return (
    <header className="flex items-center justify-between gap-3 px-6 py-2 border-b border-border bg-bg-soft/60 backdrop-blur">
      {/* Left: status pills */}
      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
        <span className={`${PILL} ${statusClass}`}>BOT: {statusLabel}</span>
        <span className={`${PILL} bg-accent/15 text-accent`}>MOD: {modeLabel}</span>
        <span className={`${PILL} bg-slate-700/40 text-slate-300`}>BORSA: {String(exchange).toUpperCase()}</span>
        {s?.liveTrading
          ? <span className={`${PILL} bg-warning/15 text-warning`}>CANLI: AÇIK</span>
          : <span className={`${PILL} bg-success/15 text-success`}>CANLI: KAPALI</span>}
        <span className={`${PILL} bg-slate-700/40 text-slate-300`}>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
          YENİLEME: AÇIK
        </span>
        {lastFetch && (
          <span className={`${PILL} bg-slate-700/40 text-slate-300`}>
            SON: {lastFetch.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        )}
        {workerOnline !== null && (
          <span className={`${PILL} ${workerOnline ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}`}>
            SUNUCU: {workerOnline ? "ÇEVRİMİÇİ" : "ÇEVRİMDIŞI"}
          </span>
        )}
      </div>

      {/* Right: sound toggle + P&L + kill switch */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={toggleSound}
          className={`${PILL} ${soundEnabled ? "bg-success/15 text-success" : "bg-slate-700/40 text-slate-300"} cursor-pointer hover:opacity-90`}
          title={soundEnabled ? "Sesli bildirim açık — kapatmak için tıkla" : "Sesli bildirim kapalı — açmak için tıkla"}
          type="button"
        >
          <span aria-hidden>{soundEnabled ? "🔊" : "🔇"}</span>
          SES: {soundEnabled ? "AÇIK" : "KAPALI"}
        </button>
        <button
          onClick={requestNotifications}
          disabled={notificationPermission !== "default"}
          className={`${PILL} ${notificationClass} ${notificationPermission === "default" ? "cursor-pointer hover:opacity-90" : "cursor-default"}`}
          title={notificationTitle}
          type="button"
        >
          BİLDİRİM: {notificationLabel}
        </button>
        {s && (
          <span className={`${PILL} bg-slate-700/40 text-slate-300`}>
            K/Z:&nbsp;
            <span className={s.daily.realizedPnlUsd >= 0 ? "text-success" : "text-danger"}>
              ${s.daily.realizedPnlUsd.toFixed(2)}
            </span>
            <span className="text-muted">&nbsp;/&nbsp;${s.daily.dailyTargetUsd}</span>
          </span>
        )}
        <KillSwitch />
      </div>
    </header>
  );
}
