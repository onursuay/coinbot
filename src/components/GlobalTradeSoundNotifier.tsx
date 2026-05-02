"use client";

import { useEffect, useRef, useState } from "react";
import { useSoundPref } from "@/lib/sound-pref";
import {
  detectNewPaperPositionAlerts,
  PAPER_POSITION_ALERT_SOUND_URL,
  readNotifiedPaperPositionIds,
  readPaperNotificationPermission,
  requestPaperNotificationPermission,
  saveNotifiedPaperPositionIds,
  shouldPlayPaperPositionSound,
  showPaperPositionDesktopNotification,
  type PaperNotificationPermissionState,
} from "@/lib/paper-position-alerts";

const POLL_INTERVAL_MS = 8_000;
const AUDIO_BLOCKED_NOTICE =
  "Tarayıcı sesi engelledi. Sesli uyarı için CoinBot sekmesinde bir kez tıklayın.";

export default function GlobalTradeSoundNotifier() {
  const { enabled } = useSoundPref();
  const enabledRef = useRef(enabled);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const firstSyncRef = useRef(true);
  const notifiedIdsRef = useRef<Set<string>>(new Set());
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [notificationPermission, setNotificationPermission] =
    useState<PaperNotificationPermissionState>("unsupported");

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    notifiedIdsRef.current = readNotifiedPaperPositionIds();
    setNotificationPermission(readPaperNotificationPermission());

    if (typeof Audio !== "undefined") {
      const audio = new Audio(PAPER_POSITION_ALERT_SOUND_URL);
      audio.preload = "auto";
      audio.volume = 0.7;
      audioRef.current = audio;
    }
  }, []);

  useEffect(() => {
    const onPermissionChange = () => {
      setNotificationPermission(readPaperNotificationPermission());
    };
    window.addEventListener(
      "coinbot:paper-notification-permission",
      onPermissionChange,
    );
    return () => {
      window.removeEventListener(
        "coinbot:paper-notification-permission",
        onPermissionChange,
      );
    };
  }, []);

  useEffect(() => {
    const unlockAudio = () => {
      if (!enabledRef.current || !audioRef.current) return;
      try {
        const audio = audioRef.current;
        const previousVolume = audio.volume;
        audio.volume = 0;
        void audio.play()
          .then(() => {
            audio.pause();
            audio.currentTime = 0;
            audio.volume = previousVolume;
            setAudioBlocked(false);
          })
          .catch(() => {
            audio.volume = previousVolume;
          });
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("pointerdown", unlockAudio, true);
    window.addEventListener("keydown", unlockAudio, true);
    return () => {
      window.removeEventListener("pointerdown", unlockAudio, true);
      window.removeEventListener("keydown", unlockAudio, true);
    };
  }, []);

  useEffect(() => {
    let active = true;

    const playSound = () => {
      if (!audioRef.current) return;
      try {
        audioRef.current.currentTime = 0;
        void audioRef.current.play().catch(() => {
          setAudioBlocked(true);
        });
      } catch {
        setAudioBlocked(true);
      }
    };

    const poll = async () => {
      try {
        const response = await fetch("/api/paper-trades?limit=50&skipEvaluate=1", {
          cache: "no-store",
        });
        const payload = await response.json();
        if (!active || !payload?.ok || !Array.isArray(payload.data?.open)) {
          return;
        }

        const detection = detectNewPaperPositionAlerts({
          openTrades: payload.data.open,
          notifiedIds: notifiedIdsRef.current,
          firstSync: firstSyncRef.current,
        });
        firstSyncRef.current = false;

        notifiedIdsRef.current = detection.nextNotifiedIds;
        saveNotifiedPaperPositionIds(notifiedIdsRef.current);

        if (detection.newTrades.length === 0) return;

        for (const trade of detection.newTrades) {
          showPaperPositionDesktopNotification(trade);
        }

        if (
          shouldPlayPaperPositionSound({
            soundEnabled: enabledRef.current,
            newTradeCount: detection.newTrades.length,
          })
        ) {
          playSound();
        }
      } catch {
        /* polling retries */
      }
    };

    void poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <>
      {audioBlocked && (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning shadow-lg"
        >
          <div className="flex items-start justify-between gap-3">
            <span>{AUDIO_BLOCKED_NOTICE}</span>
            <button
              type="button"
              onClick={() => setAudioBlocked(false)}
              className="text-xs opacity-70 hover:opacity-100 underline"
            >
              kapat
            </button>
          </div>
        </div>
      )}

      {notificationPermission === "default" && (
        <div
          role="status"
          className="fixed bottom-4 left-4 z-50 rounded-lg border border-accent/30 bg-bg-soft px-3 py-2 text-sm text-slate-100 shadow-lg"
        >
          <div className="flex items-center gap-3">
            <span>Desktop bildirimi kapalı.</span>
            <button
              type="button"
              onClick={async () => {
                setNotificationPermission(
                  await requestPaperNotificationPermission(),
                );
              }}
              className="btn-primary text-xs"
            >
              Bildirimleri Aç
            </button>
          </div>
        </div>
      )}
    </>
  );
}
