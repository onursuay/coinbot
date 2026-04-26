"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const NAV: { href: string; label: string }[] = [
  { href: "/", label: "Dashboard" },
  { href: "/scanner", label: "Market Scanner" },
  { href: "/coins", label: "Coin Detail" },
  { href: "/paper-trades", label: "Paper Trades" },
  { href: "/risk", label: "Risk Settings" },
  { href: "/api-settings", label: "API Settings" },
  { href: "/strategy", label: "Strategy" },
  { href: "/performance", label: "Performance" },
  { href: "/logs", label: "Logs" },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-60 shrink-0 min-h-screen bg-bg-soft border-r border-border p-4 flex flex-col gap-2">
      <div className="px-2 py-3 mb-2 border-b border-border">
        <div className="text-sm font-semibold text-accent">FUTURES BOT</div>
        <div className="text-xs text-muted">Multi-Exchange • Paper-first</div>
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
        Live trading: gated by env
      </div>
    </aside>
  );
}
