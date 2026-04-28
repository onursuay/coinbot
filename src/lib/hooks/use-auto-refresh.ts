"use client";
import { useEffect, useRef } from "react";

export const AUTO_REFRESH_INTERVAL_MS = 15_000;

/**
 * Runs `onRefresh` on mount, then every `intervalMs` ms.
 * Pauses when the tab is hidden; resumes (with an immediate call) when visible again.
 * Cleans up the interval and the visibility listener on unmount.
 * Uses a ref for the callback so the latest closure is always invoked without
 * re-running the effect.
 */
export function useAutoRefresh(
  onRefresh: () => void,
  intervalMs = AUTO_REFRESH_INTERVAL_MS,
) {
  const callbackRef = useRef(onRefresh);
  callbackRef.current = onRefresh;

  useEffect(() => {
    callbackRef.current(); // initial load

    let timerId: ReturnType<typeof setInterval> | null = null;

    const startInterval = () => {
      if (timerId !== null) return; // no duplicate intervals
      timerId = setInterval(() => callbackRef.current(), intervalMs);
    };

    const stopInterval = () => {
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        stopInterval();
      } else {
        callbackRef.current(); // immediate refresh on becoming visible
        startInterval();
      }
    };

    if (document.visibilityState !== "hidden") {
      startInterval();
    }

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stopInterval();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [intervalMs]);
}
