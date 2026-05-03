// AI Aksiyon Merkezi — Panel özet kartı.
//
// Mevcut Panel'deki uzun "AI Karar Asistanı" kartının yerini alır.
// Tüm detaylı analiz akışı `/ai-actions` sayfasında gösterilir.
//
// SAFETY:
// - Bu kart yalnızca statik durum + navigasyon sunar.
// - AI çağrısı yapmaz; trade/risk/engine ayarına dokunmaz.

"use client";

import Link from "next/link";
import { Sparkles, ArrowRight } from "lucide-react";

export function AIActionCenterCard() {
  return (
    <section className="card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 text-accent">
              <Sparkles className="h-4 w-4" />
            </span>
            <h3 className="text-sm font-semibold text-accent">
              AI Aksiyon Merkezi
            </h3>
            <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning">
              Hazırlık Aşaması
            </span>
          </div>
          <p className="mt-1.5 text-xs text-muted">
            Faz 2&apos;de aktif analiz sonuçları burada özetlenecek. Detaylı
            mimari ve plan AI Aksiyon Merkezi sayfasındadır.
          </p>
        </div>
        <Link
          href="/ai-actions"
          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition hover:border-accent/70 hover:bg-accent/15"
        >
          Merkeze Git
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryTile label="Durum" value="Hazırlık" tone="warning" />
        <SummaryTile label="Yetki Modu" value="Prompt Only" tone="accent" />
        <SummaryTile label="Ana Kaynak" value="GitHub" tone="accent" />
        <SummaryTile label="Canlı İşlem" value="Kapalı" tone="success" />
      </div>
    </section>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "success" | "warning" | "accent" | "muted";
}) {
  const cls =
    tone === "success"
      ? "text-success"
      : tone === "warning"
      ? "text-warning"
      : tone === "accent"
      ? "text-accent"
      : "text-slate-200";
  return (
    <div className="rounded-md border border-border bg-bg-soft px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted">
        {label}
      </div>
      <div className={`mt-0.5 text-xs font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
