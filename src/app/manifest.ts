import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CoinBot",
    short_name: "CoinBot",
    description: "Binance Futures paper-trading karar ve izleme sistemi",
    start_url: "/",
    display: "standalone",
    orientation: "portrait-primary",
    theme_color: "#0b0e13",
    background_color: "#0b0e13",
    categories: ["finance", "productivity", "utilities"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
