"use client";
// Global açık-paper-pozisyon ses bildirimi.
//
// Önceden yalnızca Panel sayfası `useTradeOpenSound` çağrıyordu — başka
// bir sayfaya gidildiğinde yeni paper pozisyon açılsa bile ses çalmıyordu.
// Bu bileşen layout seviyesinde mount edilir ve hangi sayfa açık olursa
// olsun yeni paper trade ID görüldüğünde public/sounds/hedef.mp3'i çalar.
//
// Kurallar:
// - Sadece YENİ paper pozisyon açılışında çalar.
// - İlk sync'te (sayfa ilk yüklendiğinde) mevcut açık ID'ler sessizce
//   kaydedilir; ses çalmaz (useTradeOpenSound içindeki firstSync mantığı).
// - Aynı trade ID için bir kere çalar (localStorage history).
// - "SES: KAPALI" ise (useSoundPref) çalmaz; ID'ler yine sessiz kaydedilir.
// - Tarayıcı autoplay engellerse sessizce yutulur — kullanıcı SES toggle
//   ile bir kere etkileşim kurduğu anda gelecek bildirimler çalar.
// - Hiçbir trade kararı/eşik/risk mantığına dokunmaz; sadece okuma yapar.

import { useEffect, useState } from "react";
import { useSoundPref } from "@/lib/sound-pref";
import { useTradeOpenSound } from "@/lib/hooks/use-trade-open-sound";

const POLL_INTERVAL_MS = 8_000;

export default function GlobalTradeSoundNotifier() {
  const { enabled } = useSoundPref();
  const [openIds, setOpenIds] = useState<string[]>([]);

  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const r = await fetch("/api/paper-trades?limit=50&skipEvaluate=1", {
          cache: "no-store",
        }).then((r) => r.json());
        if (!active) return;
        if (r?.ok && Array.isArray(r.data?.open)) {
          const next = (r.data.open as Array<{ id: string | number }>)
            .map((t) => String(t.id))
            .sort();
          setOpenIds((prev) => {
            if (
              prev.length === next.length &&
              prev.every((v, i) => v === next[i])
            ) {
              return prev;
            }
            return next;
          });
        }
      } catch {
        /* ignore — polling will retry */
      }
    };

    poll();
    const t = setInterval(() => {
      if (document.visibilityState !== "hidden") poll();
    }, POLL_INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      active = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useTradeOpenSound({
    enabled,
    paperTradeIds: openIds,
    liveTradeIds: [],
  });

  return null;
}
