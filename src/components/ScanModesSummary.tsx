"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { COIN_SOURCE_LABEL, type ScanModesConfig } from "@/lib/scan-modes/types";

// Phase 1 — küçük "Aktif Tarama Modları" özet kartı.
// Panel ve/veya Piyasa Tarayıcı sayfasında gösterilir. Sadece okuma; mod
// kontrolleri /scan-modes sayfasındadır.

export default function ScanModesSummary({ className = "" }: { className?: string }) {
  const [config, setConfig] = useState<ScanModesConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/scan-modes")
      .then((r) => r.json())
      .then((res) => {
        if (!cancelled && res?.ok) setConfig(res.data);
      })
      .catch(() => { /* non-fatal — summary is informational */ });
    return () => { cancelled = true; };
  }, []);

  if (!config) {
    return (
      <div className={`text-xs text-muted ${className}`}>Tarama modları yükleniyor…</div>
    );
  }

  const items: { key: string; label: string; short: string; active: boolean }[] = [
    { key: "wide", label: "Geniş Market", short: COIN_SOURCE_LABEL.WIDE_MARKET, active: config.wideMarket.active },
    { key: "mom", label: "Momentum", short: COIN_SOURCE_LABEL.MOMENTUM, active: config.momentum.active },
    { key: "man", label: "Manuel", short: COIN_SOURCE_LABEL.MANUAL_LIST, active: config.manualList.active },
  ];

  return (
    <div className={`flex items-center gap-2 flex-wrap text-xs ${className}`}>
      <span className="text-muted">Tarama Modları:</span>
      {items.map((it) => (
        <span
          key={it.key}
          title={`${it.label} — ${it.active ? "AKTİF" : "PASİF"}`}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${
            it.active
              ? "border-success/40 text-success"
              : "border-border text-muted"
          }`}
        >
          <span className="font-mono">{it.short}</span>
          <span>{it.active ? "AKTİF" : "PASİF"}</span>
        </span>
      ))}
      <Link href="/scan-modes" className="text-accent hover:underline ml-1">Yönet →</Link>
    </div>
  );
}
