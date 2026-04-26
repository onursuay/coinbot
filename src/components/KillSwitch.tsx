"use client";
import { useState } from "react";

export default function KillSwitch() {
  const [busy, setBusy] = useState(false);
  const fire = async () => {
    if (!confirm("Kill switch tetiklensin mi? Bot duracak ve yeni işlem açılmayacak.")) return;
    setBusy(true);
    try {
      await fetch("/api/bot/kill-switch", { method: "POST" });
      alert("Kill switch aktif. Bot duraklatıldı.");
      location.reload();
    } finally { setBusy(false); }
  };
  return (
    <button onClick={fire} disabled={busy} className="btn-danger">
      {busy ? "..." : "KILL SWITCH"}
    </button>
  );
}
