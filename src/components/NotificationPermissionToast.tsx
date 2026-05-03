'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, BellOff } from 'lucide-react'
import {
  readPaperNotificationPermission,
  requestPaperNotificationPermission,
  type PaperNotificationPermissionState,
} from '@/lib/paper-position-alerts'

type ToastState =
  | { kind: 'prompt'; message: string; permission: PaperNotificationPermissionState }
  | { kind: 'success' | 'blocked' | 'neutral'; message: string; permission: PaperNotificationPermissionState }

const AUTO_HIDE_MS = 3200

function messageForPermission(permission: PaperNotificationPermissionState): ToastState {
  if (permission === 'granted') {
    return { kind: 'success', message: 'Bildirimler açık.', permission }
  }
  if (permission === 'denied') {
    return { kind: 'blocked', message: 'Bildirimler engellendi. Tarayıcı ayarlarından izin verin.', permission }
  }
  if (permission === 'default') {
    return { kind: 'prompt', message: 'Bildirim izni gerekli.', permission }
  }
  return { kind: 'neutral', message: 'Bildirim durumu güncellendi.', permission }
}

export default function NotificationPermissionToast() {
  const [toast, setToast] = useState<ToastState | null>(null)
  const [requesting, setRequesting] = useState(false)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  const showTransient = useCallback((next: ToastState) => {
    clearHideTimer()
    setToast(next)
    hideTimerRef.current = setTimeout(() => {
      setToast(null)
      hideTimerRef.current = null
    }, AUTO_HIDE_MS)
  }, [clearHideTimer])

  useEffect(() => {
    const permission = readPaperNotificationPermission()
    if (permission === 'default') {
      setToast(messageForPermission(permission))
    }

    const syncPermission = () => {
      const next = readPaperNotificationPermission()
      showTransient(messageForPermission(next))
    }

    window.addEventListener('coinbot:paper-notification-permission', syncPermission)
    return () => {
      clearHideTimer()
      window.removeEventListener('coinbot:paper-notification-permission', syncPermission)
    }
  }, [clearHideTimer, showTransient])

  const requestPermission = async () => {
    setRequesting(true)
    try {
      const permission = await requestPaperNotificationPermission()
      showTransient(messageForPermission(permission))
    } finally {
      setRequesting(false)
    }
  }

  if (!toast) return null

  const isPrompt = toast.kind === 'prompt'
  const Icon = toast.kind === 'blocked' ? BellOff : Bell
  const toneClass =
    toast.kind === 'success' ? 'border-emerald-400/25 text-success' :
    toast.kind === 'blocked' ? 'border-rose-500/30 text-red-400' :
    toast.kind === 'prompt' ? 'border-amber-500/30 text-warning' :
    'border-border text-slate-300'

  return (
    <div
      className="pointer-events-none fixed top-[68px] right-0 z-50 flex justify-center px-4"
      style={{ left: 'var(--sidebar-width, 240px)' }}
      aria-live="polite"
    >
      <div className={`pointer-events-auto flex max-w-[min(92vw,420px)] items-center gap-3 rounded-lg border bg-bg-card/95 px-3 py-2 text-sm shadow-lg shadow-black/25 backdrop-blur ${toneClass}`}>
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 leading-snug">{toast.message}</span>
        {isPrompt && (
          <button
            type="button"
            onClick={requestPermission}
            disabled={requesting}
            className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-black transition-colors hover:bg-accent-strong disabled:opacity-60"
          >
            {requesting ? 'Bekleyin' : 'Bildirimleri Aç'}
          </button>
        )}
      </div>
    </div>
  )
}
