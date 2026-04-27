"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const NAV: { href: string; label: string }[] = [
  { href: "/", label: "Panel" },
  { href: "/scanner", label: "Piyasa Tarayıcı" },
  { href: "/coins", label: "Coin Detayı" },
  { href: "/paper-trades", label: "Sanal İşlemler" },
  { href: "/risk", label: "Risk Ayarları" },
  { href: "/api-settings", label: "API Ayarları" },
  { href: "/strategy", label: "Strateji" },
  { href: "/performance", label: "Performans" },
  { href: "/logs", label: "Loglar" },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-60 shrink-0 min-h-screen bg-bg-soft border-r border-border p-4 flex flex-col gap-2">
      <div className="px-2 py-3 mb-2 border-b border-border">
        <div className="text-sm font-semibold text-accent">VADELİ İŞLEM BOTU</div>
        <div className="text-xs text-muted">Çoklu Borsa • Önce Sanal Test</div>
      </div>
      {NAV.map((n) => {
        const active = pathname === n.href || (n.href !== "/" && pathname.startsWith(n.href));
        return (
          <Link
            key={n.href}
            href={n.href}
            className={clsx(
              "px-3 py-2 rounded-lg text-sm transition-colors",
              active ? "bg-accent/15 text-accent border border-accent/30"
                     : "text-slate-300 hover:bg-bg-card hover:text-slate-100 border border-transparent",
            )}
          >
            {n.label}
          </Link>
        );
      })}
      <div className="mt-auto px-2 py-3 text-[11px] text-muted leading-relaxed">
        Sistem maks. kaldıraç: <span className="text-warning">5x</span><br />
        Default mod: <span className="text-success">PAPER</span><br />
        Canlı işlem: env ile kilitli
      </div>
    </aside>
  );
}
