import "./globals.css";
import type { Metadata } from "next";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";

export const metadata: Metadata = {
  title: "Multi-Exchange Futures Trading Bot",
  description: "Futures-first paper trading dashboard with strict risk management",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className="dark">
      <body className="min-h-screen bg-bg text-slate-100">
        <div className="flex">
          <Sidebar />
          <div className="flex-1 min-h-screen">
            <TopBar />
            <main className="p-6">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
