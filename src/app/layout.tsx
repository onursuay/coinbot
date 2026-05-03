import "./globals.css";
import type { Metadata, Viewport } from "next";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import MainContent from "@/components/MainContent";
import GlobalTradeSoundNotifier from "@/components/GlobalTradeSoundNotifier";
import NotificationPermissionToast from "@/components/NotificationPermissionToast";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";

export const metadata: Metadata = {
  title: "CoinBot",
  description: "Binance Futures paper-trading karar ve izleme sistemi",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "CoinBot",
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: "/apple-touch-icon.png",
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0e13",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
