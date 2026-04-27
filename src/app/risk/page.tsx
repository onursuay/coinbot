"use client";
import { useEffect, useState } from "react";
import { fmtPct, fmtUsd } from "@/lib/format";

export default function RiskPage() {
  const [policy, setPolicy] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [r, s] = await Promise.all([
      fetch("/api/risk/status").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()),
    ]);
    if (r.ok) setPolicy(r.data);
    if (s.ok) { setSettings(s.data); setForm(s.data ?? {}); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        max_leverage: Number(form.max_leverage),
        max_allowed_leverage: Number(form.max_allowed_leverage),
        risk_per_trade_percent: Number(form.risk_per_trade_percent),
        max_daily_loss_percent: Number(form.max_daily_loss_percent),
        max_weekly_loss_percent: Number(form.max_weekly_loss_percent),
        daily_profit_target_usd: Number(form.daily_profit_target_usd),
        max_open_positions: Number(form.max_open_positions),
        min_risk_reward_ratio: Number(form.min_risk_reward_ratio),
        margin_mode: form.margin_mode,
        conservative_mode_enabled: !!form.conservative_mode_enabled,
      };
      if (payload.max_leverage > 5 || payload.max_allowed_leverage > 5) {
        alert("Sistem 5x üstü kaldıraca izin vermez."); setBusy(false); return;
      }
      const res = await fetch("/api/settings/update", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      }).then((r) => r.json());
      if (!res.ok) alert(res.error);
      else { setSettings(res.data); setForm(res.data); alert("Kaydedildi"); }
    } finally { setBusy(false); }
  };

  if (!settings || !policy) return <div className="text-muted">Yükleniyor…</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Risk Settings</h1>

      <div className="grid md:grid-cols-3 gap-3">
        <Kpi label="System Hard Cap" value={`${policy.policy.systemHardLeverageCap}x`} accent="warning" />
        <Kpi label="Daily PnL" value={fmtUsd(policy.daily.realizedPnlUsd)} accent={policy.daily.realizedPnlUsd >= 0 ? "success" : "danger"} />
        <Kpi label="Daily Loss Limit" value={fmtUsd(policy.daily.dailyLossLimitUsd)} accent="danger" />
      </div>

      <section className="card grid md:grid-cols-2 gap-4">
        <Field label="Default Leverage (≤5)" type="number" value={form.max_leverage} onChange={(v) => setForm({ ...form, max_leverage: v })} step={1} min={1} max={5} />
        <Field label="Max Allowed Leverage (≤5)" type="number" value={form.max_allowed_leverage} onChange={(v) => setForm({ ...form, max_allowed_leverage: v })} step={1} min={1} max={5} />
        <Field label="Risk per Trade (%)" type="number" step={0.1} min={0.1} max={2} value={form.risk_per_trade_percent} onChange={(v) => setForm({ ...form, risk_per_trade_percent: v })} />
        <Field label="Min Risk:Reward" type="number" step={0.1} min={1} max={10} value={form.min_risk_reward_ratio} onChange={(v) => setForm({ ...form, min_risk_reward_ratio: v })} />
        <Field label="Daily Loss Limit (%)" type="number" step={0.5} min={1} max={20} value={form.max_daily_loss_percent} onChange={(v) => setForm({ ...form, max_daily_loss_percent: v })} />
        <Field label="Weekly Loss Limit (%)" type="number" step={0.5} min={1} max={40} value={form.max_weekly_loss_percent} onChange={(v) => setForm({ ...form, max_weekly_loss_percent: v })} />
        <Field label="Daily Profit Target (USD, 1-50)" type="number" step={1} min={1} max={50} value={form.daily_profit_target_usd} onChange={(v) => setForm({ ...form, daily_profit_target_usd: v })} />
        <Field label="Max Open Positions" type="number" step={1} min={1} max={5} value={form.max_open_positions} onChange={(v) => setForm({ ...form, max_open_positions: v })} />
        <div>
          <div className="label">Margin Mode</div>
          <select className="input" value={form.margin_mode} onChange={(e) => setForm({ ...form, margin_mode: e.target.value })}>
            <option value="isolated">isolated</option>
            <option value="cross">cross (önerilmez)</option>
          </select>
        </div>
        <div className="flex items-center gap-2 mt-6">
          <input type="checkbox" checked={!!form.conservative_mode_enabled} onChange={(e) => setForm({ ...form, conservative_mode_enabled: e.target.checked })} />
          <span className="text-sm">Conservative Mode (hedef sonrası muhafazakâr)</span>
        </div>
      </section>

      <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Kaydediliyor…" : "Kaydet"}</button>

      <div className="card text-sm text-muted">
        <div>Sistem garantileri:</div>
        <ul className="list-disc list-inside mt-1 space-y-1">
          <li>Maks. kaldıraç {policy.policy.systemHardLeverageCap}x — daha yüksek değer kabul edilmez.</li>
          <li>İşlem başı risk maks. <span className="text-warning">{fmtPct(policy.policy.riskPerTradePercent)}</span> bakiye.</li>
          <li>Stop-loss ve take-profit zorunludur; minimum R:R 1:{policy.policy.minRiskRewardRatio}.</li>
          <li>Likidasyon stop-loss&apos;tan önceyse işlem açılmaz.</li>
          <li>Günlük kâr hedefi (USD): {policy.policy.dailyProfitTargetUsd}, üst limit {policy.policy.maxDailyProfitTargetUsd}.</li>
        </ul>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, ...rest }: { label: string; value: any; onChange: (v: string) => void; [k: string]: any }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" {...rest} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
function Kpi({ label, value, accent }: { label: string; value: string; accent?: "success" | "danger" | "warning" }) {
  const cls = accent === "success" ? "text-success" : accent === "danger" ? "text-danger" : accent === "warning" ? "text-warning" : "";
  return <div className="card"><div className="label">{label}</div><div className={`text-2xl font-semibold ${cls}`}>{value}</div></div>;
}
