"use client";
import { useState } from "react";

export default function KillSwitch() {
  const [busy, setBusy] = useState(false);
  const fire = async () => {
    if (!confirm("Acil durdur tetiklensin mi? Bot duracak ve yeni işlem açılmayacak.")) return;
    setBusy(true);
    try {
      await fetch("/api/bot/kill-switch", { method: "POST" });
      alert("Acil durdur aktif. Bot duraklatıldı.");
      location.reload();
    } finally { setBusy(false); }
  };
  return (
    <button
      onClick={fire}
      disabled={busy}
      className="h-6 px-2.5 inline-flex items-center text-[11px] font-semibold leading-none rounded-md whitespace-nowrap bg-danger text-white hover:opacity-90 disabled:opacity-60 transition-opacity"
      title="Bot'u acil olarak durdurur (Kill Switch)"
    >
      {busy ? "..." : "ACİL DURDUR"}
    </button>
  );
}
