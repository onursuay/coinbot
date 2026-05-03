'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  ScanLine,
  ReceiptText,
  ShieldAlert,
  KeyRound,
  ScrollText,
  PanelLeftClose,
  PanelLeftOpen,
  Bot,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'
import { useState, useEffect, useLayoutEffect } from 'react'

const NAV = [
  { href: '/', label: 'Genel Bakış', icon: LayoutDashboard },
  { href: '/scanner', label: 'Piyasa Tarayıcı', icon: ScanLine },
  { href: '/paper-trades', label: 'Pozisyonlar', icon: ReceiptText },
  { href: '/ai-actions', label: 'AI Aksiyon Merkezi', icon: Sparkles },
  { href: '/strategy-center', label: 'Strateji Merkezi', icon: SlidersHorizontal },
  { href: '/risk', label: 'Risk Yönetimi', icon: ShieldAlert },
  { href: '/api-settings', label: 'API Key', icon: KeyRound },
  { href: '/logs', label: 'Loglar', icon: ScrollText },
]

export default function Sidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [animate, setAnimate] = useState(false)
  const [showHintButton, setShowHintButton] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useLayoutEffect(() => {
    try {
      const saved = localStorage.getItem('sidebar_collapsed')
      if (saved !== null) setCollapsed(JSON.parse(saved))
    } catch { /* ignore */ }
    requestAnimationFrame(() => requestAnimationFrame(() => setAnimate(true)))
  }, [])

  // Collapsed hint animation: bot icon 5s → expand button 1s → loop
  useEffect(() => {
    if (!collapsed) return
    setShowHintButton(false)
    const loop = () => {
      const t1 = setTimeout(() => setShowHintButton(true), 5000)
      const t2 = setTimeout(() => setShowHintButton(false), 6000)
      const t3 = setTimeout(loop, 6000)
      return [t1, t2, t3]
    }
    const timers = loop()
    return () => timers.forEach(clearTimeout)
  }, [collapsed])

  // Mobile: listen for hamburger toggle from TopBar
  useEffect(() => {
    const toggle = () => setMobileOpen((prev) => !prev)
    window.addEventListener('sidebar:mobile-toggle', toggle)
    return () => window.removeEventListener('sidebar:mobile-toggle', toggle)
  }, [])

  // Mobile: close on ESC
  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mobileOpen])

  // Mobile: lock body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('sidebar_collapsed', JSON.stringify(next))
      document.documentElement.style.setProperty('--sidebar-width', next ? '72px' : '240px')
      return next
    })
  }

  const isActive = (href: string) => {
    if (href === '/') return pathname === href
    if (href === '/strategy-center') {
      return (
        pathname.startsWith('/strategy-center') ||
        pathname === '/strategy' ||
        pathname === '/performance' ||
        pathname === '/scan-modes'
      )
    }
    return pathname.startsWith(href)
  }

  // Close mobile drawer when a nav link is clicked
  const handleNavClick = () => setMobileOpen(false)

  return (
    <>
      {/* Mobile backdrop — only rendered when drawer is open on mobile */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <div
        className={[
          'bg-bg-soft border-r border-border h-screen flex flex-col shrink-0',
          // Mobile: fixed overlay drawer; desktop: normal flex flow
          'fixed inset-y-0 left-0 z-40',
          'md:relative md:inset-auto md:z-auto',
          // Mobile open/close via translate; always visible on desktop
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          'md:translate-x-0',
          animate ? 'transition-[width,transform] duration-300' : '',
        ].join(' ')}
        style={{ width: collapsed ? '72px' : '240px' }}
      >
        {/* Header */}
        <div className="border-b border-border flex items-center justify-between min-h-[56px] px-4">
          {collapsed ? (
            <div className="group relative flex items-center justify-center w-full h-10 rounded-lg overflow-hidden">
              {/* Cyan glow particles — shown during hint */}
              <div
                className={`absolute inset-0 transition-opacity duration-500 pointer-events-none ${showHintButton ? 'opacity-100' : 'opacity-0'}`}
                aria-hidden="true"
              >
                <span className="absolute top-1 left-1 w-1.5 h-1.5 rounded-full bg-accent animate-ping" style={{ animationDuration: '1.5s' }} />
                <span className="absolute top-0 right-2 w-1 h-1 rounded-full bg-accent/70 animate-ping" style={{ animationDuration: '2s', animationDelay: '0.3s' }} />
                <span className="absolute bottom-1 left-3 w-1 h-1 rounded-full bg-accent animate-ping" style={{ animationDuration: '1.8s', animationDelay: '0.5s' }} />
                <span className="absolute bottom-0 right-1 w-1.5 h-1.5 rounded-full bg-accent/80 animate-ping" style={{ animationDuration: '1.6s', animationDelay: '0.2s' }} />
                <span className="absolute top-1/2 left-0 w-1 h-1 rounded-full bg-accent/60 animate-ping" style={{ animationDuration: '2.2s', animationDelay: '0.7s' }} />
                <span className="absolute top-1/2 right-0 w-1 h-1 rounded-full bg-accent animate-ping" style={{ animationDuration: '1.4s', animationDelay: '0.4s' }} />
                <div className="absolute inset-0 rounded-lg ring-1 ring-accent/40 shadow-[0_0_8px_rgba(34,211,238,0.3)]" />
              </div>
              {/* Bot icon (logo) */}
              <div
                className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 group-hover:opacity-0 ${showHintButton ? 'opacity-0' : 'opacity-100'}`}
              >
                <Bot className="w-7 h-7 text-accent" />
              </div>
              {/* Expand button */}
              <button
                onClick={toggleCollapse}
                className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 group-hover:opacity-100 rounded-lg ${showHintButton ? 'opacity-100' : 'opacity-0'}`}
                aria-label="Expand sidebar"
              >
                <PanelLeftOpen className="w-6 h-6 text-accent" />
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 min-w-0">
                <Bot className="w-6 h-6 text-accent shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-accent leading-tight truncate">CoinBot</div>
                  <div className="text-[10px] text-muted leading-tight">Vadeli İşlem Botu</div>
                </div>
              </div>
              <button
                onClick={toggleCollapse}
                className="p-2 hover:bg-bg-card rounded-lg transition-colors ml-2 shrink-0"
                aria-label="Collapse sidebar"
              >
                <PanelLeftClose className="w-5 h-5 text-slate-400" />
              </button>
            </>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {NAV.map((item) => {
            const active = isActive(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                onClick={handleNavClick}
                className={`flex items-center gap-3 px-3 py-2.5 md:py-2 text-sm font-medium rounded-lg transition-colors border ${
                  active
                    ? 'bg-accent/15 text-accent border-accent/20'
                    : 'text-slate-300 hover:bg-bg-card hover:text-slate-100 border-transparent'
                }`}
              >
                <item.icon className="w-5 h-5 shrink-0" />
                <span className={collapsed ? 'hidden' : ''}>{item.label}</span>
              </Link>
            )
          })}
        </nav>
      </div>
    </>
  )
}
