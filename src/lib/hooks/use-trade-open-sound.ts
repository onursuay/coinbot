"use client";
import { useEffect, useRef } from "react";

const SOUND_URL = "/sounds/hedef.mp3";
const MAX_HISTORY = 500;

type Kind = "paper" | "live";
const storageKey = (kind: Kind) => `notifiedTradeIds:${kind}`;

function loadNotified(kind: Kind): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(storageKey(kind));
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch { return new Set(); }
}

function saveNotified(kind: Kind, set: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    const arr = Array.from(set).slice(-MAX_HISTORY);
    localStorage.setItem(storageKey(kind), JSON.stringify(arr));
  } catch { /* ignore */ }
}

/**
 * Plays a notification sound when a new trade ID appears in the supplied arrays.
 *
 * - Tracks paper and live IDs separately.
 * - Persists notified IDs in localStorage so a page refresh on the same open
 *   position does not retrigger the sound.
 * - First sync after mount is silent: any IDs already present at that moment
 *   are recorded but not announced (the user has presumably already seen them).
 * - When `enabled` is false, IDs are still recorded silently so toggling on
 *   later does not blast a backlog.
 *
 * Live infra is pre-wired: callers pass `liveTradeIds` once a live trades
 * fetcher exists. Until then, leave undefined / [].
 */
export function useTradeOpenSound(opts: {
  enabled: boolean;
  paperTradeIds: string[];
  liveTradeIds?: string[];
}) {
  const { enabled, paperTradeIds, liveTradeIds = [] } = opts;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const notifiedPaperRef = useRef<Set<string>>(new Set());
  const notifiedLiveRef = useRef<Set<string>>(new Set());
  const firstSyncRef = useRef(true);

  // Init: load persisted notified sets + create audio element
  useEffect(() => {
    notifiedPaperRef.current = loadNotified("paper");
    notifiedLiveRef.current = loadNotified("live");
    if (typeof Audio !== "undefined") {
      const a = new Audio(SOUND_URL);
      a.preload = "auto";
      a.volume = 0.7;
      audioRef.current = a;
    }
  }, []);

  const paperKey = paperTradeIds.join(",");
  const liveKey = liveTradeIds.join(",");

  useEffect(() => {
    const detectNew = (ids: string[], ref: React.MutableRefObject<Set<string>>, kind: Kind) => {
      let added = false;
      let hasNew = false;
      for (const id of ids) {
        if (!ref.current.has(id)) {
          if (!firstSyncRef.current) hasNew = true;
          ref.current.add(id);
          added = true;
        }
      }
      if (added) saveNotified(kind, ref.current);
      return hasNew;
    };

    const newPaper = detectNew(paperTradeIds, notifiedPaperRef, "paper");
    const newLive = detectNew(liveTradeIds, notifiedLiveRef, "live");

    if (firstSyncRef.current) {
      firstSyncRef.current = false;
      return;
    }

    if ((newPaper || newLive) && enabled && audioRef.current) {
      try {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => { /* autoplay blocked — user must toggle once */ });
      } catch { /* ignore */ }
    }
  }, [enabled, paperKey, liveKey]); // eslint-disable-line react-hooks/exhaustive-deps
}
