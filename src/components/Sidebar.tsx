'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  ScanLine,
  CircleDollarSign,
  ReceiptText,
  ShieldAlert,
  KeyRound,
  Zap,
  BarChart3,
  ScrollText,
  PanelLeftClose,
  PanelLeftOpen,
  Bot,
} from 'lucide-react'
import { useState, useEffect, useLayoutEffect } from 'react'

const NAV = [
  { href: '/', label: 'Panel', icon: LayoutDashboard },
  { href: '/scanner', label: 'Piyasa Tarayıcı', icon: ScanLine },
  { href: '/coins', label: 'Coin Detayı', icon: CircleDollarSign },
  { href: '/paper-trades', label: 'Sanal İşlemler', icon: ReceiptText },
  { href: '/risk', label: 'Risk Ayarları', icon: ShieldAlert },
  { href: '/api-settings', label: 'API Ayarları', icon: KeyRound },
  { href: '/strategy', label: 'Strateji', icon: Zap },
  { href: '/performance', label: 'Performans', icon: BarChart3 },
  { href: '/logs', label: 'Loglar', icon: ScrollText },
]

export default function Sidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [animate, setAnimate] = useState(false)
  const [showHintButton, setShowHintButton] = useState(false)

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

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('sidebar_collapsed', JSON.stringify(next))
      document.documentElement.style.setProperty('--sidebar-width', next ? '72px' : '240px')
      return next
    })
  }

  const isActive = (href: string) =>
    href === '/' ? pathname === href : pathname.startsWith(href)

  return (
    <div
      className={`bg-bg-soft border-r border-border h-screen flex flex-col shrink-0 ${animate ? 'transition-[width] duration-300' : ''}`}
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
              className={`flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors border ${
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

      {/* Footer */}
      {!collapsed && (
        <div className="p-4 border-t border-border text-[10px] text-muted leading-relaxed">
          Maks. kaldıraç: <span className="text-warning">5x</span><br />
          Mod: <span className="text-success">PAPER</span><br />
          Canlı: env ile kilitli
        </div>
      )}
    </div>
  )
}
