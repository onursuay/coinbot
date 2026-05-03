// AI Aksiyon Merkezi — Panel özet kartı.
//
// Faz 2: Panelden canlı plan count + en yüksek risk seviyesi gösterilir.
// Detaylı liste ve aksiyon butonları /ai-actions sayfasındadır.
//
// SAFETY:
// - Bu kart yalnızca okuma yapar; ayar değiştirmez.
// - AI çağrısı yoktur; /api/ai-actions deterministic generator kullanır.
// - Tüm aksiyon butonları /ai-actions sayfasındadır ve hiçbiri uygulamaz.

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Sparkles, ArrowRight } from "lucide-react";
import type {
  ActionPlan,
  ActionPlanResult,
  ActionPlanRiskLevel,
} from "@/lib/ai-actions";

const RISK_RANK: Record<ActionPlanRiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const RISK_LABEL: Record<ActionPlanRiskLevel, string> = {
  low: "Düşük",
  medium: "Orta",
  high: "Yüksek",
  critical: "Kritik",
};

const RISK_CLASS: Record<ActionPlanRiskLevel, string> = {
  low: "text-success",
  medium: "text-warning",
  high: "text-danger",
  critical: "text-danger",
};

function topRisk(plans: ActionPlan[]): ActionPlanRiskLevel | null {
  if (!plans.length) return null;
  return plans.reduce<ActionPlanRiskLevel>(
    (acc, p) => (RISK_RANK[p.riskLevel] > RISK_RANK[acc] ? p.riskLevel : acc),
    "low",
  );
}

export function AIActionCenterCard() {
  const [data, setData] = useState<ActionPlanResult | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ai-actions", { cache: "no-store" });
        const json = await res.json();
        if (!cancelled && json.ok) {
          setData(json.data as ActionPlanResult);
        }
      } catch {
        // sessizce geç — kart statik durum bilgilerini gösterir
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const planCount = data?.plans?.length ?? 0;
  const highest = data ? topRisk(data.plans) : null;

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
              Faz 2 · Öneri
            </span>
          </div>
          <p className="mt-1.5 text-xs text-muted">
            {!loaded
              ? "Plan listesi yükleniyor…"
              : planCount === 0
              ? "Şu an aktif öneri yok. Detaylar Merkez sayfasında."
              : `${planCount} aktif öneri hazır. Detaylar Merkez sayfasında.`}
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
        <SummaryTile
          label="Aktif Öneri"
          value={loaded ? String(planCount) : "—"}
          tone="accent"
        />
        <SummaryTile
          label="En Yüksek Risk"
          value={highest ? RISK_LABEL[highest] : "—"}
          customClass={highest ? RISK_CLASS[highest] : "text-slate-200"}
        />
        <SummaryTile label="Yetki Modu" value="Prompt Only" tone="accent" />
        <SummaryTile label="Canlı İşlem" value="Kapalı" tone="success" />
      </div>
    </section>
  );
}

function SummaryTile({
  label,
  value,
  tone,
  customClass,
}: {
  label: string;
  value: string;
  tone?: "success" | "warning" | "accent" | "muted";
  customClass?: string;
}) {
  const cls =
    customClass ??
    (tone === "success"
      ? "text-success"
      : tone === "warning"
      ? "text-warning"
      : tone === "accent"
      ? "text-accent"
      : "text-slate-200");
  return (
    <div className="rounded-md border border-border bg-bg-soft px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted">
        {label}
      </div>
      <div className={`mt-0.5 text-xs font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
