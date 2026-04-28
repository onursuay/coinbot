"use client";
import { useEffect, useState } from "react";

const KEY = "soundNotifications";
const listeners = new Set<(v: boolean) => void>();

function readEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try { return localStorage.getItem(KEY) === "true"; } catch { return false; }
}

export function setSoundEnabled(v: boolean) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(KEY, String(v)); } catch { /* ignore */ }
  listeners.forEach((fn) => fn(v));
}

export function useSoundPref() {
  const [enabled, setEnabledState] = useState(false);
  useEffect(() => {
    setEnabledState(readEnabled());
    const fn = (v: boolean) => setEnabledState(v);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return { enabled, setEnabled: setSoundEnabled };
}
