import "./globals.css";
import type { Metadata } from "next";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import MainContent from "@/components/MainContent";
import GlobalTradeSoundNotifier from "@/components/GlobalTradeSoundNotifier";
import NotificationPermissionToast from "@/components/NotificationPermissionToast";

export const metadata: Metadata = {
  title: "Multi-Exchange Futures Trading Bot",
  description: "Futures-first paper trading dashboard with strict risk management",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className="dark">
      <body className="bg-bg text-slate-100">
        {/* Prevents flash of wrong sidebar width on page load */}
        <script dangerouslySetInnerHTML={{ __html: `try{var s=localStorage.getItem('sidebar_collapsed');var w=s==='true'?'72px':'240px';document.documentElement.style.setProperty('--sidebar-width',w)}catch(e){}` }} />
        <div className="flex h-screen">
          <Sidebar />
          <MainContent>
            <TopBar />
            <NotificationPermissionToast />
            <main className="flex-1 overflow-y-auto p-3 sm:p-6">{children}</main>
          </MainContent>
        </div>
        {/* Yeni paper pozisyon açıldığında ses bildirimi — hangi sayfa
            açık olursa olsun çalışır (panel, scanner, paper-trades, risk, ...) */}
        <GlobalTradeSoundNotifier />
      </body>
    </html>
  );
}
