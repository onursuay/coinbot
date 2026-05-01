"use client";
// Phase 9 — Dashboard kart bileşenleri.
//
// Bu modül yalnızca presentation içerir. Hesaplama mantığı
// `src/lib/dashboard/` altında saf fonksiyonlar olarak yaşar; bu
// dosya yalnızca onların çıktısını render eder. Hiçbir trade kararı,
// risk engine ayarı veya canlı trading gate'i bu kartlardan etkilenmez.
import Link from "next/link";
import { useState } from "react";
import { Copy, Eye, MessageSquare, RefreshCw } from "lucide-react";
import { fmtNum, fmtUsd } from "@/lib/format";
import {
  mapDirectionLabel,
  mapDecisionLabel,
  decisionClass,
  mapSourceLabel,
  buildReasonText,
  buildTickRuntimeNotice,
  distanceToThreshold,
  SIGNAL_THRESHOLD,
  type DecisionLabel,
} from "@/lib/dashboard/labels";
import { computeMarketPulse, type MarketPulseInputRow } from "@/lib/dashboard/market-pulse";
import { computeRadarCounts, type RadarRow } from "@/lib/dashboard/opportunity-radar";
import { computeBlockingReasons, type BlockingReasonRow } from "@/lib/dashboard/blocking-reasons";

// ── 1. BOT DURUMU ─────────────────────────────────────────────────────
//
// Operasyonel durum bilgisini gösterir. **Asla** "MOD: SANAL", "PAPER
// MODE", "YAKINDA CANLI", "SANAL İŞLEM MODU" gibi etiketler bu kartta
// gösterilmez (Faz 9 ürün kuralı). Mod / paper-validation için ayrı
// kart vardır.
export interface BotStatusInput {
  bot_status?: string | null;
  active_exchange?: string | null;
  worker_online?: boolean | null;
  binance_api_status?: string | null;
  websocket_status?: string | null;
  last_tick_at?: string | null;
  tickSkipped?: boolean | null;
  skipReason?: string | null;
  tickError?: string | null;
  kill_switch_active?: boolean;
  kill_switch_reason?: string | null;
  busy?: boolean;
}
export interface BotStatusActions {
  onStartPaper: () => void;
  onStop: () => void;
  onKillSwitch: () => void;
  onTick: () => void;
}

function titleCaseStatusValue(value: string) {
  return value
    .replace(/_/g, " ")
    .toLocaleLowerCase("tr-TR")
    .replace(/(^|\s)\S/g, (m) => m.toLocaleUpperCase("tr-TR"));
}

export function BotStatusCard({ data, actions }: { data: BotStatusInput; actions: BotStatusActions }) {
  const status = (data.bot_status ?? "stopped").toString().toLowerCase();
  const isRunning = status.startsWith("running");
  const isKillSwitch = status === "kill_switch" || data.kill_switch_active === true;
  const exchange = titleCaseStatusValue((data.active_exchange ?? "binance").toString());

  const statusLabel = isKillSwitch
    ? "Acil Durduruldu"
    : status === "running" || status === "running_paper" || status === "running_live"
      ? "Çalışıyor"
      : status === "stopped" ? "Durdu"
      : titleCaseStatusValue(status);

  const statusTone = isKillSwitch ? "danger" : isRunning ? "success" : "muted";

  // Piyasa verisi: Binance API status "ok" + websocket "connected" → CANLI
  const marketLive =
    data.binance_api_status === "ok" || data.websocket_status === "connected";
  const lastTickLabel = data.last_tick_at
    ? `${Math.max(0, Math.round((Date.now() - new Date(data.last_tick_at).getTime()) / 1000))}s önce`
    : "—";
  const tickRuntimeNotice = buildTickRuntimeNotice({
    tickSkipped: data.tickSkipped,
    skipReason: data.skipReason,
    tickError: data.tickError,
  });

  return (
    <div className={`card border ${
      isKillSwitch ? "border-danger/50" :
      isRunning ? "border-success/30" : "border-border"
    }`}>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="font-semibold tracking-wide">BOT DURUMU</h2>
        <div className="flex items-center gap-2">
          <Pill tone={statusTone}>BOT: {statusLabel}</Pill>
          <Pill tone="muted">BORSA: {exchange} FUTURES</Pill>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-stretch">
        <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
          <CompactBox label="PİYASA VERİSİ" value={marketLive ? "Canlı" : "Bekliyor"}
            tone={marketLive ? "success" : "muted"} />
          <CompactBox label="SUNUCU" value={data.worker_online ? "Çevrimiçi" : "Çevrimdışı"}
            tone={data.worker_online ? "success" : "danger"} />
          <CompactBox label="WEBSOCKET" value={data.websocket_status ? titleCaseStatusValue(data.websocket_status) : "—"}
            tone={data.websocket_status === "connected" ? "success" : "muted"} />
        </div>
        <div className="rounded-lg border border-border bg-bg-soft px-3 py-2 lg:min-w-[560px]">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="min-w-[118px]">
              <div className="text-[10px] uppercase tracking-wider text-muted">SON GÜNCELLEME</div>
              <div className="text-sm font-semibold text-slate-200">{lastTickLabel}</div>
            </div>
            <div className="flex flex-wrap gap-1.5 sm:ml-auto lg:flex-nowrap">
              <button className="btn-primary h-8 whitespace-nowrap px-2.5 text-xs" onClick={actions.onStartPaper} disabled={data.busy || isRunning}>
                Başlat
              </button>
              <button className="btn-ghost h-8 whitespace-nowrap px-2.5 text-xs" onClick={actions.onStop} disabled={data.busy || !isRunning}>
                Durdur
              </button>
              <button className="btn-ghost h-8 whitespace-nowrap px-2.5 text-xs" onClick={actions.onTick} disabled={data.busy}>
                Taramayı Çalıştır
              </button>
              <button
                className="h-8 whitespace-nowrap rounded-lg border border-danger/60 px-2.5 text-xs font-medium text-danger transition-colors hover:bg-danger/10"
                onClick={actions.onKillSwitch}
                disabled={data.busy}
                aria-label="ACİL DURDUR"
              >
                Acil Durdur
              </button>
            </div>
          </div>
        </div>
      </div>

      {isKillSwitch && data.kill_switch_reason && (
        <div className="mt-3 rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-xs text-danger">
          Kill switch sebebi: {data.kill_switch_reason}
        </div>
      )}

      {tickRuntimeNotice && (
        <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${
          tickRuntimeNotice.tone === "danger"
            ? "border border-danger/40 bg-danger/10 text-danger"
            : "border border-warning/30 bg-warning/10 text-warning"
        }`}>
          {tickRuntimeNotice.message}
        </div>
      )}
    </div>
  );
}

// ── 2. PİYASA NABZI ───────────────────────────────────────────────────
export function MarketPulseCard({ rows, scanned, signals, rejected, btcVeto }: {
  rows: MarketPulseInputRow[];
  scanned?: number;
  signals?: number;
  rejected?: number;
  btcVeto?: number;
}) {
  const pulse = computeMarketPulse({
    rows,
    scanned,
    signals,
    rejected,
    btcTrendRejected: btcVeto,
  });
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold tracking-wide">PİYASA NABZI</h2>
        <span className="text-[10px] uppercase tracking-wider text-muted">
          {pulse.sampleSize > 0 ? `${pulse.sampleSize} coin` : "veri bekleniyor"}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Gauge label="RİSK İŞTAHI" value={pulse.riskAppetite} hint="Yüksek = pozisyon almaya elverişli" tone="success" />
        <Gauge label="FOMO DÜZEYİ" value={pulse.fomoLevel} hint="Yüksek = balon riski artıyor" tone="warning" />
        <Gauge label="PİYASA RİSKİ" value={pulse.marketRisk} hint="Yüksek = spread/ATR/BTC veto baskın" tone="danger" />
      </div>
      <p className="mt-3 text-xs text-slate-300">{pulse.comment}</p>
      <p className="mt-1 text-[10px] text-muted">
        Bilgilendirme/karar destek — trade kararı veya signal-engine eşiği bu kart tarafından değiştirilmez.
      </p>
    </div>
  );
}

// ── 3. FIRSAT RADARI ──────────────────────────────────────────────────
export function OpportunityRadarCard({ rows }: { rows: RadarRow[] }) {
  const counts = computeRadarCounts(rows);
  const items: { label: string; value: number; tone: "success" | "warning" | "muted" | "danger" }[] = [
    { label: "GÜÇLÜ FIRSAT", value: counts.strongOpportunity, tone: "success" },
    { label: "EŞİĞE YAKIN",  value: counts.nearThreshold,    tone: "warning" },
    { label: "YÖN BEKLEYEN", value: counts.awaitingDirection, tone: "muted" },
    { label: "RİSKTEN ELENEN", value: counts.rejectedByRisk,  tone: "danger" },
  ];
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold tracking-wide">FIRSAT RADARI</h2>
        <span className="text-[10px] uppercase tracking-wider text-muted">
          toplam {counts.total}
        </span>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        {/* Sade radar görseli — pulse animasyonlu daire, oyuncak değil */}
        <div className="relative h-28 w-28 shrink-0 hidden sm:block" aria-hidden>
          <span className="absolute inset-0 rounded-full border border-accent/30" />
          <span className="absolute inset-2 rounded-full border border-accent/20" />
          <span className="absolute inset-4 rounded-full border border-accent/10" />
          <span className="absolute inset-0 rounded-full border-t-2 border-accent/60 animate-[spin_6s_linear_infinite]" />
          <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" />
        </div>

        <div className="flex-1 grid grid-cols-2 gap-2 min-w-[220px]">
          {items.map((it) => (
            <div key={it.label} className="rounded-lg border border-border bg-bg-soft px-3 py-2">
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] uppercase tracking-wider text-muted">{it.label}</span>
                <span className={`text-lg font-semibold tabular-nums ${
                  it.tone === "success" ? "text-success" :
                  it.tone === "warning" ? "text-warning" :
                  it.tone === "danger"  ? "text-danger"  : "text-slate-200"
                }`}>{it.value}</span>
              </div>
              <div className="mt-1 h-1 w-full rounded-full bg-bg-soft overflow-hidden border border-border/60">
                <div
                  className={`h-1 rounded-full ${
                    it.tone === "success" ? "bg-success" :
                    it.tone === "warning" ? "bg-warning" :
                    it.tone === "danger"  ? "bg-danger"  : "bg-slate-500"
                  }`}
                  style={{ width: `${Math.round((it.value / max) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {counts.total === 0 && (
        <p className="mt-2 text-xs text-muted">Tarama verisi gelince radar dolar.</p>
      )}
    </div>
  );
}

// ── 4. POZİSYON KARAR MERKEZİ ─────────────────────────────────────────
export interface DecisionRow extends RadarRow, BlockingReasonRow {
  symbol: string;
  setupScore?: number;
  marketQualityScore?: number;
  marketQualityPreScore?: number;
  scoreReason?: string;
  sourceDisplay?: string | null;
  candidateSources?: string[];
  coinClass?: "CORE" | "DYNAMIC";
}

export function DecisionCenterCard({ rows, exchange, max = 8 }: {
  rows: DecisionRow[];
  exchange: string;
  max?: number;
}) {
  // Sıralama: önce açılanlar, sonra tradeSignalScore desc, sonra setupScore desc.
  const sorted = [...rows].sort((a, b) => {
    if ((b.opened ? 1 : 0) - (a.opened ? 1 : 0) !== 0) return (b.opened ? 1 : 0) - (a.opened ? 1 : 0);
    const at = a.tradeSignalScore ?? a.signalScore ?? 0;
    const bt = b.tradeSignalScore ?? b.signalScore ?? 0;
    if (bt !== at) return bt - at;
    return (b.setupScore ?? 0) - (a.setupScore ?? 0);
  });
  const top = sorted.slice(0, max);

  return (
    <div className="card overflow-x-auto">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold tracking-wide">POZİSYON KARAR MERKEZİ</h2>
        <Link href="/scanner" className="text-xs text-accent">Piyasa Tarayıcı →</Link>
      </div>
      {top.length === 0 ? (
        <p className="text-sm text-muted">Tarama verisi gelince karar listesi oluşur.</p>
      ) : (
        <table className="t t-centered">
          <thead>
            <tr>
              <th>COIN</th>
              <th>KAYNAK</th>
              <th>YÖN</th>
              <th>KALİTE</th>
              <th>FIRSAT</th>
              <th>İŞLEM SKORU</th>
              <th>KARAR</th>
              <th className="text-left">SEBEP</th>
            </tr>
          </thead>
          <tbody>
            {top.map((r) => {
              const direction = mapDirectionLabel(r);
              const decision = mapDecisionLabel(r);
              const opened = r.opened === true;
              const quality = r.marketQualityScore ?? r.marketQualityPreScore ?? 0;
              const setup = r.setupScore ?? 0;
              const trade = r.tradeSignalScore ?? r.signalScore ?? 0;
              const reason = buildReasonText(r);
              return (
                <tr key={r.symbol} className={opened ? "font-semibold bg-success/5" : ""}>
                  <td className={opened ? "font-bold" : "font-medium"}>
                    <Link className="text-accent" href={`/coins/${encodeURIComponent(r.symbol)}?exchange=${exchange}`}>
                      {r.symbol}
                    </Link>
                  </td>
                  <td title={(r.candidateSources ?? []).join(", ") || undefined}>
                    <span className="text-xs font-medium text-slate-200">{mapSourceLabel(r)}</span>
                  </td>
                  <td>
                    <span className={`text-xs font-medium ${decisionClass(direction, opened)}`}>{direction}</span>
                  </td>
                  <td>{quality > 0
                    ? <span className={`text-xs font-medium ${quality >= 70 ? "text-success" : quality >= 50 ? "text-warning" : "text-muted"}`}>{quality}</span>
                    : <span className="text-muted text-xs">—</span>}
                  </td>
                  <td title={r.scoreReason ?? ""}>{setup > 0
                    ? <span className={`font-semibold ${setup >= 70 ? "text-success" : setup >= 50 ? "text-warning" : ""}`}>{setup}</span>
                    : <span className="text-muted">—</span>}
                  </td>
                  <td>{trade > 0
                    ? <span className={`text-xs font-medium ${trade >= 70 ? "text-success" : trade >= 50 ? "text-warning" : "text-muted"}`}>{trade}</span>
                    : <span className="text-muted text-xs">—</span>}
                  </td>
                  <td>
                    <span className={`text-xs ${opened ? "font-bold" : "font-medium"} ${decisionClass(decision, opened)}`}>
                      {decision}
                    </span>
                  </td>
                  <td className="text-left max-w-[260px]">
                    <span className="text-xs text-slate-400 truncate inline-block max-w-[260px] align-middle" title={reason}>
                      {reason}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── 5. POZİSYONA EN YAKIN COINLER ─────────────────────────────────────
export function NearThresholdCoinsCard({ rows }: { rows: DecisionRow[] }) {
  // Açılmamış ama anlamlı skoru olan satırlar.
  const candidates = rows.filter((r) => {
    const t = r.tradeSignalScore ?? r.signalScore ?? 0;
    const s = r.setupScore ?? 0;
    return !r.opened && (t > 0 || s > 0);
  });
  candidates.sort((a, b) => {
    const at = a.tradeSignalScore ?? a.signalScore ?? 0;
    const bt = b.tradeSignalScore ?? b.signalScore ?? 0;
    if (bt !== at) return bt - at;
    return (b.setupScore ?? 0) - (a.setupScore ?? 0);
  });
  const top = candidates.slice(0, 10);

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold tracking-wide">POZİSYONA EN YAKIN COİNLER</h2>
        <span className="text-[10px] uppercase tracking-wider text-muted">eşik 70</span>
      </div>
      {top.length === 0 ? (
        <p className="text-sm text-muted">Bu periyotta güçlü fırsat yok.</p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {top.map((r) => {
            const dist = distanceToThreshold(r);
            const direction = mapDirectionLabel(r);
            const reason = buildReasonText(r);
            const trade = r.tradeSignalScore ?? r.signalScore ?? 0;
            return (
              <li key={r.symbol} className="flex items-start gap-3 rounded-lg border border-border bg-bg-soft px-3 py-2">
                <div className="min-w-[80px]">
                  <div className="text-sm font-semibold">{r.symbol}</div>
                  <div className={`text-[10px] uppercase tracking-wider ${decisionClass(direction, false)}`}>{direction}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted">İŞLEM</span>
                    <span className={`font-semibold ${trade >= SIGNAL_THRESHOLD ? "text-success" : trade >= 50 ? "text-warning" : "text-muted"}`}>
                      {trade > 0 ? `${trade}/${SIGNAL_THRESHOLD}` : "—"}
                    </span>
                    {dist !== null && dist > 0 && (
                      <span className="text-muted">· EŞİĞE {dist}p</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-300 mt-0.5 truncate" title={reason}>
                    Eksik: {reason}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── 6. AÇIK POZİSYONLAR ───────────────────────────────────────────────
export interface OpenPositionRow {
  id: string | number;
  symbol: string;
  direction: "LONG" | "SHORT";
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  leverage?: number;
  unrealized_pnl?: number | null;
  // Faz 21 — position management advisory badge (display-only, no real orders)
  pm_action?: string | null;
  pm_explanation?: string | null;
}

/** Faz 21: small badge for position management advisory hints. */
function PmBadge({ action, explanation }: { action?: string | null; explanation?: string | null }) {
  if (!action || action === "HOLD" || action === "NO_ACTION" || action === "BLOCK_SCALE_IN_LOSING_POSITION") return null;
  const label: Record<string, string> = {
    MOVE_SL_TO_BREAKEVEN: "SL Breakeven",
    PARTIAL_TAKE_PROFIT: "Kısmi Kâr",
    ENABLE_TRAILING_STOP: "Trailing",
    TIGHTEN_TRAILING_STOP: "Trailing Sıkılaştır",
    CONSIDER_PROFIT_SCALE_IN: "Kârda Büyüt?",
    EXIT_FULL: "Çıkış",
    EXIT_PARTIAL: "Kısmi Çıkış",
  };
  const text = label[action] ?? action;
  return (
    <span className="text-xs text-accent opacity-80 font-normal" title={explanation ?? text}>
      {" "}▸ {text}
    </span>
  );
}

export function OpenPositionsCard({ rows }: { rows: OpenPositionRow[] }) {
  return (
    <div className="card overflow-x-auto">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold tracking-wide">AÇIK POZİSYONLAR ({rows.length})</h2>
        <Link href="/paper-trades" className="text-xs text-accent">Tüm işlemler →</Link>
      </div>
      <table className="t t-centered">
        <thead>
          <tr>
            <th>COIN</th>
            <th>YÖN</th>
            <th>GİRİŞ</th>
            <th>SL</th>
            <th>TP</th>
            <th>PNL</th>
            <th>DURUM</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={7} className="text-muted text-sm py-3">Açık pozisyon yok.</td></tr>
          )}
          {rows.map((t) => (
            <tr key={t.id} className="font-semibold bg-success/5">
              <td className="font-bold">{t.symbol}</td>
              <td>
                <span className={`text-xs font-medium ${t.direction === "LONG" ? "text-success" : "text-blue-300"}`}>
                  {t.direction === "LONG" ? "LONG AÇILDI" : "SHORT AÇILDI"}
                </span>
              </td>
              <td className="tabular-nums">{fmtNum(t.entry_price, 4)}</td>
              <td className="tabular-nums">{fmtNum(t.stop_loss, 4)}</td>
              <td className="tabular-nums">{fmtNum(t.take_profit, 4)}</td>
              <td className={`tabular-nums ${t.unrealized_pnl != null && t.unrealized_pnl < 0 ? "text-danger" : "text-success"}`}>
                {t.unrealized_pnl != null ? fmtUsd(t.unrealized_pnl) : "—"}
              </td>
              <td>
                <span className="text-success text-xs font-bold">AÇIK</span>
                <PmBadge action={t.pm_action} explanation={t.pm_explanation} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── 7. EN ÇOK ENGELLEYEN SEBEPLER ─────────────────────────────────────
export function BlockingReasonsCard({ rows }: { rows: BlockingReasonRow[] }) {
  const top = computeBlockingReasons(rows, 6);
  const hasData = top.length > 0;
  const max = Math.max(1, ...top.map((t) => t.count));
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold tracking-wide">EN ÇOK ENGELLEYEN SEBEPLER</h2>
        {hasData && <span className="text-[10px] uppercase tracking-wider text-muted">son tick</span>}
      </div>
      {!hasData ? (
        <p className="text-sm text-muted">Yeterli karar verisi oluşmadı.</p>
      ) : (
        <ul className="space-y-1.5">
          {top.map((t) => (
            <li key={t.label} className="flex items-center gap-3">
              <span className="min-w-[140px] text-xs font-medium text-slate-200">{t.label}</span>
              <div className="flex-1 h-2 rounded-full bg-bg-soft border border-border/60 overflow-hidden">
                <div
                  className="h-2 rounded-full bg-accent/70"
                  style={{ width: `${Math.round((t.count / max) * 100)}%` }}
                />
              </div>
              <span className="min-w-[28px] text-right text-xs tabular-nums text-slate-200">{t.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── 8. BUGÜNKÜ ÖZET ───────────────────────────────────────────────────
export interface TodaysSummaryInput {
  scanned?: number;
  candidatePool?: number;
  nearThreshold?: number;
  openedToday?: number;
  closedToday?: number;
  realizedPnlUsd?: number;
}
export function TodaysSummaryCard({ data }: { data: TodaysSummaryInput }) {
  const allMissing =
    [data.scanned, data.candidatePool, data.nearThreshold, data.openedToday, data.closedToday]
      .every((v) => v == null);
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold tracking-wide">BUGÜNKÜ ÖZET</h2>
      </div>
      {allMissing ? (
        <p className="text-sm text-muted">Veri bekleniyor — bot çalıştığında özet doldurulur.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
          <CompactBox label="ANALİZ EDİLEN" value={String(data.scanned ?? "—")} tone="muted" />
          <CompactBox label="ADAY HAVUZU" value={String(data.candidatePool ?? "—")} tone="muted" />
          <CompactBox label="EŞİĞE YAKIN" value={String(data.nearThreshold ?? "—")} tone="warning" />
          <CompactBox label="AÇILAN" value={String(data.openedToday ?? "—")} tone="success" />
          <CompactBox label="KAPANAN" value={String(data.closedToday ?? "—")} tone="muted" />
          <CompactBox
            label="TOPLAM PNL"
            value={typeof data.realizedPnlUsd === "number" ? fmtUsd(data.realizedPnlUsd) : "—"}
            tone={typeof data.realizedPnlUsd === "number" && data.realizedPnlUsd < 0 ? "danger" : "success"}
          />
        </div>
      )}
    </div>
  );
}

// ── 9. PAPER İŞLEM DOĞRULAMASI ────────────────────────────────────────
//
// E2E payload'ı modern karta uyarlanır. Henüz paper trade açılmadıysa
// kırmızı hata değil, "BEKLENİYOR" gri durumu gösterilir.
export interface PaperE2EInput {
  allPassed?: boolean;
  checks?: Array<{ name: string; label: string; ok: boolean; detail?: string; skipped?: boolean }>;
  summary?: string;
  lastCheckedAt?: string;
}
export function PaperValidationCard({ data, hardLiveAllowed }: {
  data: PaperE2EInput | null;
  hardLiveAllowed: boolean;
}) {
  // E2E henüz veri döndürmediyse: gri, "bekleniyor" durumu.
  if (!data || !data.checks) {
    return (
      <div className="card border border-border">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold tracking-wide">PAPER İŞLEM DOĞRULAMASI</h2>
          <span className="text-[10px] tracking-wider text-muted">Bekleniyor</span>
        </div>
        <p className="text-sm text-muted">İlk paper işlem açıldıktan sonra E2E doğrulaması burada raporlanır.</p>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          <CompactBox label="HARD LIVE GATE" value={hardLiveAllowed ? "Açık" : "Kapalı"} tone={hardLiveAllowed ? "warning" : "success"} />
          <CompactBox label="MOD" value="Paper" tone="muted" />
          <CompactBox label="GERÇEK EMİR" value="Yok" tone="success" />
        </div>
      </div>
    );
  }

  const allPassed = data.allPassed ?? false;
  const failed = (data.checks ?? []).filter((c) => !c.ok && !c.skipped);
  const skipped = (data.checks ?? []).filter((c) => c.skipped);
  // İlk paper trade henüz açılmadıysa "first_trade_opened" check'i skipped/false olur — bu durumda
  // **kırmızı hata** yerine gri/bekleniyor tonu kullanılır.
  const firstTradeMissing = (data.checks ?? []).some(
    (c) => c.name === "first_trade_opened" && !c.ok,
  );

  return (
    <div className={`card border ${
      allPassed ? "border-success/30" :
      firstTradeMissing ? "border-border" :
      failed.length > 0 ? "border-danger/40" : "border-border"
    }`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold tracking-wide">PAPER İŞLEM DOĞRULAMASI</h2>
        <div className="flex items-center gap-2">
          {allPassed ? (
            <span className="text-[10px] tracking-wider px-2 py-0.5 rounded-full bg-success/20 text-success">Tümü Geçti</span>
          ) : firstTradeMissing ? (
            <span className="text-[10px] tracking-wider px-2 py-0.5 rounded-full bg-bg-soft text-muted">Bekleniyor</span>
          ) : failed.length > 0 ? (
            <span className="text-[10px] tracking-wider px-2 py-0.5 rounded-full bg-danger/20 text-danger">{failed.length} Başarısız</span>
          ) : null}
          {skipped.length > 0 && (
            <span className="text-[10px] tracking-wider px-2 py-0.5 rounded-full bg-bg-soft text-muted">{skipped.length} Atlandı</span>
          )}
        </div>
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
        {data.checks!.map((c) => {
          // first_trade_opened için kırmızı yerine gri bekleniyor.
          const pendingFirstTrade = c.name === "first_trade_opened" && !c.ok && !c.skipped;
          const tone =
            c.skipped ? "muted" :
            c.ok ? "success" :
            pendingFirstTrade ? "muted" : "danger";
          return (
            <li key={c.name} className="flex items-start gap-2 text-xs min-w-0">
              <span className={`mt-0.5 font-bold flex-shrink-0 w-3 text-center ${
                tone === "success" ? "text-success" :
                tone === "danger"  ? "text-danger"  : "text-muted"
              }`}>
                {c.skipped ? "—" : c.ok ? "✓" : pendingFirstTrade ? "·" : "×"}
              </span>
              <div className="flex-1 min-w-0 overflow-hidden">
                <div className={`font-medium leading-tight break-words ${
                  tone === "success" ? "" :
                  tone === "danger"  ? "text-danger" : "text-muted"
                }`}>{c.label}</div>
                {c.detail && (
                  <div className="text-muted text-[10px] leading-snug break-words mt-0.5">{c.detail}</div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {data.summary && (
        <p className={`text-xs mt-3 ${allPassed ? "text-success" : firstTradeMissing ? "text-muted" : "text-slate-300"}`}>
          {data.summary}
        </p>
      )}
    </div>
  );
}

// ── Ortak küçük yapı taşları ───────────────────────────────────────────
type Tone = "success" | "warning" | "danger" | "muted" | "accent";

function pillTone(tone: Tone): string {
  switch (tone) {
    case "success": return "bg-success/15 text-success";
    case "warning": return "bg-warning/15 text-warning";
    case "danger":  return "bg-danger/15 text-danger";
    case "accent":  return "bg-accent/15 text-accent";
    default:         return "bg-bg-soft text-slate-300";
  }
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`text-[10px] font-medium uppercase tracking-wider px-2 py-1 rounded-md ${pillTone(tone)}`}>
      {children}
    </span>
  );
}

function CompactBox({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  const cls =
    tone === "success" ? "text-success" :
    tone === "warning" ? "text-warning" :
    tone === "danger"  ? "text-danger"  :
    tone === "accent"  ? "text-accent"  : "text-slate-200";
  return (
    <div className="bg-bg-soft border border-border rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`text-sm font-semibold ${cls}`}>{value}</div>
    </div>
  );
}

// ── Phase 13 — Performans Karar Özeti Kartı ───────────────────────────
//
// Trade Performance Decision Engine'in ürettiği `decision` payload'ını
// 5 mini bölüm halinde gösterir. Düz yazı/rapor formatı kullanılmaz;
// kompakt kutular + status pill kullanılır. Paper/live ayrımı için
// `tradeMode` rozeti gösterilir; canlıya geçişte aynı kart live verisini
// de bu sözleşmeyle besler.
//
// SAFETY: Bu kart hiçbir trade engine ayarını, eşik değerini veya canlı
// trading gate'ini değiştirmez. ActionFooter butonları yalnızca callback
// üretir; gerçek ayar değişikliğine bağlı DEĞİLDİR.
type DecisionStatusPretty = "HEALTHY" | "WATCH" | "ATTENTION_NEEDED" | "DATA_INSUFFICIENT";
type DecisionActionPretty =
  | "NO_ACTION" | "OBSERVE" | "REVIEW_THRESHOLD" | "REVIEW_STOP_LOSS"
  | "REVIEW_RISK_SETTINGS" | "REVIEW_POSITION_LIMITS" | "REVIEW_SIGNAL_QUALITY"
  | "DATA_INSUFFICIENT";

export interface PerformanceDecisionInput {
  status: DecisionStatusPretty;
  /** "paper" veya "live" — kart başında rozet olarak gösterilir. */
  tradeMode: "paper" | "live";
  mainFinding: string;
  systemInterpretation: string;
  recommendation: string;
  actionType: DecisionActionPretty;
  confidence: number;
  requiresUserApproval: boolean;
  observeDays: number;
  /** Decision summary execution path'ine bağlı DEĞİLDİR — true beklenmez. */
  appliedToTradeEngine: false;
}

const STATUS_LABEL: Record<DecisionStatusPretty, string> = {
  HEALTHY: "Sağlıklı",
  WATCH: "Gözlem",
  ATTENTION_NEEDED: "Dikkat",
  DATA_INSUFFICIENT: "Veri Yetersiz",
};

const STATUS_TONE: Record<DecisionStatusPretty, Tone> = {
  HEALTHY: "success",
  WATCH: "warning",
  ATTENTION_NEEDED: "danger",
  DATA_INSUFFICIENT: "muted",
};

const ACTION_LABEL: Record<DecisionActionPretty, string> = {
  NO_ACTION: "Aksiyon Yok",
  OBSERVE: "Gözlem",
  REVIEW_THRESHOLD: "Eşik İncelemesi",
  REVIEW_STOP_LOSS: "Stop-Loss İncelemesi",
  REVIEW_RISK_SETTINGS: "Risk Ayar İncelemesi",
  REVIEW_POSITION_LIMITS: "Pozisyon Limit İncelemesi",
  REVIEW_SIGNAL_QUALITY: "Sinyal Kalite İncelemesi",
  DATA_INSUFFICIENT: "Veri Yetersiz",
};

export function PerformanceDecisionCard({
  data,
  onAction,
}: {
  data: PerformanceDecisionInput | null;
  onAction?: (action: "APPROVE" | "REJECT" | "OBSERVE" | "PROMPT", actionId: string) => void;
}) {
  const empty = !data;
  const status = data?.status ?? "DATA_INSUFFICIENT";
  const action = data?.actionType ?? "DATA_INSUFFICIENT";
  const tradeModeLabel = data?.tradeMode === "live" ? "Canlı" : "Paper";
  const isActionable = !empty && data!.actionType !== "NO_ACTION" && data!.actionType !== "DATA_INSUFFICIENT";

  return (
    <div className="card">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="font-semibold tracking-wide">PERFORMANS KARAR ÖZETİ</h2>
        <div className="flex items-center gap-2">
          <Pill tone="muted">MOD: {tradeModeLabel}</Pill>
          <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>
          {!empty && (
            <Pill tone="accent">GÜVEN: %{Math.round(data!.confidence)}</Pill>
          )}
        </div>
      </div>

      {empty ? (
        <p className="text-sm text-muted">
          Yeterli paper veri oluşmadı. Gözlem devam ediyor.
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <MiniSection label="MEVCUT DURUM" tone={STATUS_TONE[status]}>
            {STATUS_LABEL[status]}
          </MiniSection>
          <MiniSection label="ANA BULGU" tone="muted">
            {data!.mainFinding}
          </MiniSection>
          <MiniSection label="SİSTEM YORUMU" tone="muted">
            {data!.systemInterpretation}
          </MiniSection>
          <MiniSection label="ÖNERİ" tone={STATUS_TONE[status]}>
            {data!.recommendation}
          </MiniSection>
          <MiniSection label="AKSİYON DURUMU" tone={isActionable ? "warning" : "muted"}>
            {ACTION_LABEL[action]}
            {data!.observeDays > 0 ? ` · ${data!.observeDays} gün gözlem` : ""}
            {data!.requiresUserApproval ? " · Kullanıcı Onayı Bekleniyor" : ""}
          </MiniSection>
          <MiniSection label="UYGULAMA" tone="muted">
            Bu öneri trade engine&apos;e otomatik uygulanmaz
            ({data!.appliedToTradeEngine ? "uygulandı?!" : "uygulanmadı"}).
          </MiniSection>
        </div>
      )}

      {isActionable && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/60 pt-3">
          {(["APPROVE", "REJECT", "OBSERVE", "PROMPT"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onAction?.(k, `performance-decision-${data!.actionType}`)}
              className="text-[11px] font-medium px-3 py-1.5 rounded-md border border-border bg-bg-soft text-slate-300 hover:border-accent hover:text-accent"
              data-action-kind={k}
            >
              {k === "APPROVE" ? "ONAYLA" : k === "REJECT" ? "REDDET" : k === "OBSERVE" ? `GÖZLEM (${data!.observeDays || 7}g)` : "PROMPT"}
            </button>
          ))}
          <span className="ml-auto text-[10px] uppercase tracking-wider text-muted">
            Butonlar yalnızca öneri kaydeder; ayar değiştirmez.
          </span>
        </div>
      )}
    </div>
  );
}

function MiniSection({ label, tone, children }: { label: string; tone: Tone; children: React.ReactNode }) {
  const titleCls =
    tone === "success" ? "text-success" :
    tone === "warning" ? "text-warning" :
    tone === "danger"  ? "text-danger"  :
    tone === "accent"  ? "text-accent"  : "text-slate-300";
  return (
    <div className="rounded-lg border border-border bg-bg-soft px-3 py-2">
      <div className={`text-[10px] uppercase tracking-wider ${titleCls}`}>{label}</div>
      <div className="mt-1 text-sm text-slate-200">{children}</div>
    </div>
  );
}

function Gauge({ label, value, hint, tone }: {
  label: string;
  value: number | null;
  hint: string;
  tone: Tone;
}) {
  const v = value === null ? null : Math.max(0, Math.min(100, Math.round(value)));
  const cls =
    tone === "success" ? "text-success" :
    tone === "warning" ? "text-warning" :
    tone === "danger"  ? "text-danger"  : "text-slate-200";
  const barCls =
    tone === "success" ? "bg-success" :
    tone === "warning" ? "bg-warning" :
    tone === "danger"  ? "bg-danger"  : "bg-slate-500";
  return (
    <div className="rounded-lg border border-border bg-bg-soft px-3 py-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted">{label}</span>
        <span className={`text-xl font-semibold tabular-nums ${cls}`}>
          {v === null ? "—" : `%${v}`}
        </span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-bg-soft border border-border/60 overflow-hidden">
        <div
          className={`h-1.5 rounded-full transition-[width] duration-500 ${barCls}`}
          style={{ width: `${v ?? 0}%` }}
        />
      </div>
      <p className="mt-1 text-[10px] text-muted">{hint}</p>
    </div>
  );
}

export type { Tone };

// ── Faz 22 — TRADE DENETİMİ VE RİSK KALİBRASYONU ────────────────────────────
//
// Altı bölüm: RİSK · STOP-LOSS · POZİSYON BÜYÜKLÜĞÜ · EŞİK · KAÇAN FIRSAT · KALDIRAÇ
// Aksiyon butonları bu fazda gerçek ayar değiştirmez; sadece callback üretir.
// appliedToTradeEngine daima false.

export interface TradeAuditSectionData {
  tag: string;
  mainFinding: string;
  recommendation: string;
  severity: "info" | "warning" | "critical";
}

export interface TradeAuditCardInput {
  status: "HEALTHY" | "WATCH" | "ATTENTION_NEEDED" | "DATA_INSUFFICIENT";
  tradeMode: "paper" | "live";
  actionType: string;
  confidence: number;
  requiresUserApproval: boolean;
  observeDays: number;
  riskSection: TradeAuditSectionData;
  stopLossSection: TradeAuditSectionData;
  positionSizingSection: TradeAuditSectionData;
  thresholdSection: TradeAuditSectionData;
  missedOpportunitySection: TradeAuditSectionData;
  leverageSection: TradeAuditSectionData;
}

const AUDIT_STATUS_LABEL: Record<string, string> = {
  HEALTHY: "Sağlıklı",
  WATCH: "Gözlem",
  ATTENTION_NEEDED: "Dikkat",
  DATA_INSUFFICIENT: "Veri Yetersiz",
};

const AUDIT_STATUS_TONE: Record<string, Tone> = {
  HEALTHY: "success",
  WATCH: "warning",
  ATTENTION_NEEDED: "danger",
  DATA_INSUFFICIENT: "muted",
};

const SEVERITY_TONE: Record<string, Tone> = {
  info: "muted",
  warning: "warning",
  critical: "danger",
};

const SECTION_LABEL: Record<string, string> = {
  risk: "RİSK",
  stopLoss: "STOP-LOSS",
  positionSizing: "POZİSYON BÜYÜKLÜĞÜ",
  threshold: "EŞİK",
  missedOpportunity: "KAÇAN FIRSAT",
  leverage: "KALDIRAÇ",
};

function AuditSection({ id, data }: { id: string; data: TradeAuditSectionData }) {
  const tone = SEVERITY_TONE[data.severity] ?? "muted";
  return (
    <div className="rounded-lg border border-border bg-bg-soft px-3 py-2">
      <div className={`text-[10px] uppercase tracking-wider ${
        tone === "warning" ? "text-warning" : tone === "danger" ? "text-danger" : "text-muted"
      }`}>{SECTION_LABEL[id] ?? id}</div>
      <div className="mt-0.5 text-xs font-medium text-slate-200 leading-snug">{data.mainFinding}</div>
      <div className="mt-0.5 text-[10px] text-muted leading-snug">{data.recommendation}</div>
      {data.tag && (
        <span className={`mt-1 inline-block text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded ${
          tone === "danger" ? "bg-danger/10 text-danger" :
          tone === "warning" ? "bg-warning/10 text-warning" : "bg-bg-soft text-muted"
        }`}>{data.tag}</span>
      )}
    </div>
  );
}

export function TradeAuditCard({
  data,
  onAction,
}: {
  data: TradeAuditCardInput | null;
  onAction?: (action: "APPROVE" | "REJECT" | "OBSERVE" | "PROMPT", actionId: string) => void;
}) {
  const empty = !data;
  const status = data?.status ?? "DATA_INSUFFICIENT";
  const statusTone = AUDIT_STATUS_TONE[status] ?? "muted";
  const tradeModeLabel = data?.tradeMode === "live" ? "Canlı" : "Paper";
  const isActionable =
    !empty &&
    data!.actionType !== "NO_ACTION" &&
    data!.actionType !== "DATA_INSUFFICIENT";

  return (
    <div className="card">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="font-semibold tracking-wide">TRADE DENETİMİ VE RİSK KALİBRASYONU</h2>
        <div className="flex items-center gap-2">
          <Pill tone="muted">MOD: {tradeModeLabel}</Pill>
          <Pill tone={statusTone}>{AUDIT_STATUS_LABEL[status]}</Pill>
          {!empty && data!.confidence > 0 && (
            <Pill tone="accent">GÜVEN: %{Math.round(data!.confidence)}</Pill>
          )}
        </div>
      </div>

      {empty ? (
        <p className="text-sm text-muted">
          Yeterli işlem verisi oluşmadı. Gözlem devam ediyor.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          <AuditSection id="risk" data={data!.riskSection} />
          <AuditSection id="stopLoss" data={data!.stopLossSection} />
          <AuditSection id="positionSizing" data={data!.positionSizingSection} />
          <AuditSection id="threshold" data={data!.thresholdSection} />
          <AuditSection id="missedOpportunity" data={data!.missedOpportunitySection} />
          <AuditSection id="leverage" data={data!.leverageSection} />
        </div>
      )}

      {isActionable && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/60 pt-3">
          {(["APPROVE", "REJECT", "OBSERVE", "PROMPT"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onAction?.(k, `trade-audit-${data!.actionType}`)}
              className="text-[11px] font-medium px-3 py-1.5 rounded-md border border-border bg-bg-soft text-slate-300 hover:border-accent hover:text-accent"
              data-action-kind={k}
            >
              {k === "APPROVE" ? "ONAYLA"
                : k === "REJECT" ? "REDDET"
                : k === "OBSERVE" ? `GÖZLEM (${data!.observeDays || 7}g)`
                : "PROMPT"}
            </button>
          ))}
          <span className="ml-auto text-[10px] uppercase tracking-wider text-muted self-center">
            Butonlar yalnızca öneri kaydeder; ayar değiştirmez.
          </span>
        </div>
      )}

      <p className="mt-2 text-[10px] text-muted">
        Bilgilendirme/karar destek — trade engine ayarı, sinyal eşiği veya risk ayarı bu kart tarafından değiştirilmez.
      </p>
    </div>
  );
}

// ── Faz 23 — CANLIYA GEÇİŞ KONTROLÜ ──────────────────────────────────────────
//
// Live Readiness checklist kartı. Bu kart canlıyı AÇMAZ; ONAYLA butonu bu fazda
// gösterilmez (canlı gate manuel final aktivasyon gerektirir). Aksiyon
// butonları yalnızca callback üretir; ayar değiştirmez.

export interface LiveReadinessCardSection {
  category:
    | "PAPER_PERFORMANCE"
    | "RISK_CALIBRATION"
    | "TRADE_AUDIT"
    | "BINANCE_CREDENTIALS"
    | "API_SECURITY"
    | "EXECUTION_SAFETY"
    | "WEBSOCKET_RECONCILIATION"
    | "SYSTEM_HEALTH"
    | "USER_APPROVAL";
  title: string;
  passCount: number;
  totalCount: number;
  blockingCount: number;
  topMessage: string;
}

export interface LiveReadinessCardInput {
  readinessStatus: "READY" | "NOT_READY" | "OBSERVE";
  readinessScore: number;
  blockingIssuesCount: number;
  warningIssuesCount: number;
  mainBlockingReason: string;
  nextRequiredAction: string;
  paperPerformance: LiveReadinessCardSection;
  riskCalibration: LiveReadinessCardSection;
  apiSecurity: LiveReadinessCardSection;
  executionSafety: LiveReadinessCardSection;
  systemHealth: LiveReadinessCardSection;
  websocketReconciliation: LiveReadinessCardSection;
}

const READINESS_STATUS_LABEL: Record<string, string> = {
  READY: "Hazır",
  NOT_READY: "Hazır Değil",
  OBSERVE: "Gözlem Gerekli",
};

const READINESS_STATUS_TONE: Record<string, Tone> = {
  READY: "success",
  NOT_READY: "danger",
  OBSERVE: "warning",
};

const NEXT_ACTION_LABEL: Record<string, string> = {
  COMPLETE_PAPER_TRADES: "100 paper trade tamamla",
  FIX_API_SECURITY: "API güvenlik checklist'ini tamamla",
  FIX_RISK_CALIBRATION: "Risk kalibrasyonunu düzelt",
  FIX_SYSTEM_HEALTH: "Sistem sağlığını düzelt",
  FIX_WEBSOCKET: "WebSocket bağlantısını sağla",
  AWAIT_USER_APPROVAL: "Kullanıcı onayı bekleniyor",
  OBSERVE_MORE_DAYS: "Gözlem gün sayısını uzat",
  MANUAL_FINAL_ACTIVATION: "Manuel final aktivasyon (kullanıcı sorumluluğunda)",
  DATA_INSUFFICIENT: "Veri bekleniyor",
};

function ReadinessSection({ section }: { section: LiveReadinessCardSection }) {
  const tone: Tone =
    section.blockingCount > 0 ? "danger"
    : section.passCount === section.totalCount && section.totalCount > 0 ? "success"
    : "warning";
  return (
    <div className="rounded-lg border border-border bg-bg-soft px-3 py-2">
      <div className={`text-[10px] uppercase tracking-wider ${
        tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-warning"
      }`}>{section.title}</div>
      <div className="mt-0.5 flex items-baseline justify-between">
        <span className="text-xs text-slate-200 truncate" title={section.topMessage}>
          {section.topMessage}
        </span>
        <span className={`text-xs font-semibold tabular-nums ml-2 ${
          tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-warning"
        }`}>
          {section.passCount}/{section.totalCount}
        </span>
      </div>
      {section.blockingCount > 0 && (
        <div className="mt-0.5 text-[10px] text-danger">
          {section.blockingCount} bloklayıcı
        </div>
      )}
    </div>
  );
}

export function LiveReadinessCard({
  data,
  onAction,
}: {
  data: LiveReadinessCardInput | null;
  onAction?: (action: "OBSERVE" | "PROMPT" | "REFRESH", actionId: string) => void;
}) {
  const empty = !data;
  const status = data?.readinessStatus ?? "NOT_READY";
  const statusTone = READINESS_STATUS_TONE[status] ?? "muted";
  const score = data?.readinessScore ?? 0;
  const isNotReady = status === "NOT_READY";

  return (
    <div className={`card border ${
      status === "READY" ? "border-success/40" :
      status === "OBSERVE" ? "border-warning/30" : "border-danger/40"
    }`}>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="font-semibold tracking-wide">CANLIYA GEÇİŞ KONTROLÜ</h2>
        <div className="flex items-center gap-2">
          <Pill tone={statusTone}>{READINESS_STATUS_LABEL[status]}</Pill>
          {!empty && (
            <Pill tone="accent">SKOR: {score}/100</Pill>
          )}
        </div>
      </div>

      {empty ? (
        <p className="text-sm text-muted">Canlıya geçiş kontrolü yükleniyor…</p>
      ) : (
        <>
          {isNotReady && (
            <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              <div className="font-semibold mb-0.5">Canlıya geçiş için hazır değil.</div>
              <div className="text-[11px]">{data!.mainBlockingReason}</div>
            </div>
          )}

          {data!.paperPerformance.totalCount > 0 && data!.paperPerformance.passCount === 0 && (
            <div className="mb-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              100 kapanmış paper trade tamamlanmadan canlıya geçilmez.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            <ReadinessSection section={data!.paperPerformance} />
            <ReadinessSection section={data!.riskCalibration} />
            <ReadinessSection section={data!.apiSecurity} />
            <ReadinessSection section={data!.executionSafety} />
            <ReadinessSection section={data!.systemHealth} />
            <ReadinessSection section={data!.websocketReconciliation} />
          </div>

          <div className="mt-3 rounded-lg border border-border bg-bg-soft px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-muted">SONRAKİ AKSİYON</div>
            <div className="mt-0.5 text-sm font-medium text-slate-200">
              {NEXT_ACTION_LABEL[data!.nextRequiredAction] ?? data!.nextRequiredAction}
            </div>
            <div className="mt-1 text-[10px] text-muted">
              {data!.blockingIssuesCount} bloklayıcı · {data!.warningIssuesCount} uyarı
            </div>
          </div>
        </>
      )}

      {/* Aksiyon butonları — ONAYLA butonu YOK; canlıyı açan buton bu kartta gösterilmez */}
      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/60 pt-3">
        {(["OBSERVE", "PROMPT", "REFRESH"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onAction?.(k, `live-readiness-${data?.readinessStatus ?? "unknown"}`)}
            className="text-[11px] font-medium px-3 py-1.5 rounded-md border border-border bg-bg-soft text-slate-300 hover:border-accent hover:text-accent"
            data-action-kind={k}
            disabled={empty && k !== "REFRESH"}
          >
            {k === "OBSERVE" ? "GÖZLEM"
              : k === "PROMPT" ? "PROMPT"
              : "RAPORU YENİLE"}
          </button>
        ))}
        <span className="ml-auto text-[10px] uppercase tracking-wider text-muted self-center">
          Bu kart canlı trading açmaz; live gate değerlerini değiştirmez.
        </span>
      </div>

      <p className="mt-2 text-[10px] text-muted">
        Final canlı aktivasyon manuel ve ayrı bir adımdır. Bu kart yalnızca durum raporu üretir.
      </p>
    </div>
  );
}

// ── AI KARAR ASİSTANI ─────────────────────────────────────────────────────────
//
// AI Decision Assistant kartı. ChatGPT API'nın ürettiği yorum/öneri içeriğini
// gösterir. Bu kart canlıyı AÇMAZ, ayar DEĞİŞTİRMEZ; ONAYLA butonu yoktur.
// Aksiyonlar: GÖZLEM, PROMPT, RAPORU YENİLE.

export interface AIDecisionCardInput {
  status:
    | "NO_ACTION"
    | "OBSERVE"
    | "REVIEW_REQUIRED"
    | "CRITICAL_BLOCKER"
    | "DATA_INSUFFICIENT";
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  mainFinding: string;
  systemInterpretation: string;
  recommendation: string;
  actionType: string;
  confidence: number;
  requiresUserApproval: boolean;
  observeDays: number;
  blockedBy: string[];
  suggestedPrompt: string | null;
  safetyNotes: string[];
  /** Daima false — AI çıktıları otomatik uygulanmaz. */
  appliedToTradeEngine: false;
  fallbackReason?: string | null;
  /** Observability alanları — opsiyonel; durum çubuğunda gösterilir. */
  hasOpenAiKey?: boolean;
  model?: string | null;
  lastCallAt?: string | null;
  aiCallSucceeded?: boolean | null;
}

const AI_STATUS_LABEL: Record<string, string> = {
  NO_ACTION: "Aksiyon Yok",
  OBSERVE: "Gözlem",
  REVIEW_REQUIRED: "İnceleme Gerekli",
  CRITICAL_BLOCKER: "Kritik Bloker",
  DATA_INSUFFICIENT: "Veri Yetersiz",
};

const AI_STATUS_TONE: Record<string, Tone> = {
  NO_ACTION: "success",
  OBSERVE: "warning",
  REVIEW_REQUIRED: "warning",
  CRITICAL_BLOCKER: "danger",
  DATA_INSUFFICIENT: "muted",
};

const AI_RISK_TONE: Record<string, Tone> = {
  LOW: "success",
  MEDIUM: "warning",
  HIGH: "danger",
  CRITICAL: "danger",
};

const AI_RISK_LABEL: Record<string, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

const AI_ACTION_LABEL: Record<string, string> = {
  NO_ACTION: "Aksiyon Yok",
  OBSERVE: "Gözlem",
  PROMPT: "Prompt Hazırla",
  REVIEW_RISK: "Risk İncelemesi",
  REVIEW_STOP_LOSS: "Stop İncelemesi",
  REVIEW_POSITION_SIZE: "Boyut İncelemesi",
  REVIEW_LIMITS: "Limit İncelemesi",
  REVIEW_LEVERAGE: "Kaldıraç İncelemesi",
  REVIEW_THRESHOLD: "Eşik İncelemesi",
  LIVE_READINESS_BLOCKED: "Live Readiness Blocked",
  DATA_INSUFFICIENT: "Veri Yetersiz",
};

const AI_FALLBACK_PROMPT =
  "CoinBot mevcut durumda canlı işlem için hazır değil. En az 100 kapanmış paper trade, websocket sağlığı ve Binance API durumu doğrulanana kadar live readiness blocked durumunu koru. Sadece gözlem ve paper trade veri toplama sürecini sürdür.";

type AIDecisionActionKind = "OBSERVE" | "PROMPT" | "REFRESH" | "COPY_PROMPT";
type AIDecisionActionResult = { ok?: boolean; message?: string } | void;

function textTone(tone: Tone): string {
  switch (tone) {
    case "success": return "text-success";
    case "warning": return "text-warning";
    case "danger": return "text-danger";
    case "accent": return "text-accent";
    default: return "text-slate-200";
  }
}

function AIDecisionMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: Tone;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border/70 bg-bg-soft/70 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-0.5 truncate text-xs font-semibold ${textTone(tone)}`}>{value}</div>
    </div>
  );
}

function AIDecisionPanel({
  title,
  children,
  tone = "muted",
}: {
  title: string;
  children: React.ReactNode;
  tone?: Tone;
}) {
  return (
    <section className="h-full rounded-lg border border-border bg-bg-soft px-3 py-2.5">
      <div className={`text-[10px] uppercase tracking-wider ${textTone(tone)}`}>{title}</div>
      <div className="mt-1.5 text-sm leading-relaxed text-slate-200">{children}</div>
    </section>
  );
}

export function AIDecisionAssistantCard({
  data,
  onAction,
}: {
  data: AIDecisionCardInput | null;
  onAction?: (
    action: AIDecisionActionKind,
    actionId: string,
  ) => AIDecisionActionResult | Promise<AIDecisionActionResult>;
}) {
  const empty = !data;
  const status = data?.status ?? "DATA_INSUFFICIENT";
  const statusTone = AI_STATUS_TONE[status] ?? "muted";
  const riskLevel = data?.riskLevel ?? "LOW";
  const riskTone = AI_RISK_TONE[riskLevel] ?? "muted";
  const actionLabel = AI_ACTION_LABEL[data?.actionType ?? "DATA_INSUFFICIENT"] ?? (data?.actionType ?? "Veri yok");
  const riskLabel = AI_RISK_LABEL[riskLevel] ?? riskLevel;
  const promptText = data?.suggestedPrompt?.trim() || AI_FALLBACK_PROMPT;
  const [observeSelected, setObserveSelected] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [copyDone, setCopyDone] = useState(false);
  const [actionNotice, setActionNotice] = useState<{ tone: Tone; text: string } | null>(null);

  // AI durum çubuğu hesabı
  const aiStatusInfo = (() => {
    if (!data) return { label: "Yükleniyor", tone: "muted" as Tone };
    if (data.fallbackReason === "AI_UNCONFIGURED" || data.hasOpenAiKey === false)
      return { label: "API Key Yok", tone: "warning" as Tone };
    if (data.fallbackReason) return { label: "Fallback", tone: "warning" as Tone };
    if (data.aiCallSucceeded === false) return { label: "Hata", tone: "danger" as Tone };
    return { label: "Aktif", tone: "success" as Tone };
  })();

  const actionId = `ai-decision-${data?.actionType ?? status}`;
  const observeDays = data?.observeDays && data.observeDays > 0 ? data.observeDays : 7;

  const runAction = async (action: AIDecisionActionKind) => {
    const result = await onAction?.(action, actionId);
    if (result && typeof result === "object" && result.ok === false) {
      throw new Error(result.message || "İşlem tamamlanamadı");
    }
    return result && typeof result === "object" ? result.message : undefined;
  };

  const handleObserve = async () => {
    setObserveSelected(true);
    setActionNotice({ tone: "success", text: `${observeDays} gün gözlem kararı kaydedildi.` });
    try {
      await runAction("OBSERVE");
    } catch (e: any) {
      setActionNotice({ tone: "warning", text: e?.message ?? "Gözlem seçimi yerel olarak kaydedildi." });
    }
  };

  const handlePrompt = async () => {
    setPromptOpen((v) => !v);
    setActionNotice({ tone: "accent", text: "Prompt hazırlandı; otomatik uygulanmaz." });
    try {
      await runAction("PROMPT");
    } catch {
      // Prompt alanı yerel olarak çalışmaya devam eder.
    }
  };

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopyDone(true);
      setActionNotice({ tone: "success", text: "Prompt kopyalandı." });
      await runAction("COPY_PROMPT");
      window.setTimeout(() => setCopyDone(false), 1800);
    } catch {
      setActionNotice({ tone: "warning", text: "Kopyalama başarısız; prompt metnini manuel seçebilirsiniz." });
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setActionNotice(null);
    try {
      const message = await runAction("REFRESH");
      setActionNotice({ tone: "success", text: message || "AI raporu güncellendi." });
    } catch (e: any) {
      setActionNotice({ tone: "danger", text: e?.message ?? "AI raporu yenilenemedi." });
    } finally {
      setRefreshing(false);
    }
  };

  const actionButtonCls =
    "inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border px-3 text-[11px] font-semibold uppercase tracking-wider transition sm:w-auto";

  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold tracking-wide">AI KARAR ASİSTANI</h2>
          <p className="mt-0.5 text-[11px] text-muted">
            Yorumlayıcı karar desteği; ayar değiştirmez, emir açmaz.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={statusTone}>{AI_STATUS_LABEL[status]}</Pill>
          <Pill tone={aiStatusInfo.tone}>AI: {aiStatusInfo.label}</Pill>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <AIDecisionMetric label="Risk Seviyesi" value={riskLabel} tone={riskTone} />
        <AIDecisionMetric
          label="Güven"
          value={data && data.confidence > 0 ? `%${Math.round(data.confidence)}` : "—"}
          tone={data && data.confidence >= 70 ? "success" : data && data.confidence >= 45 ? "warning" : "muted"}
        />
        <AIDecisionMetric label="Veri Durumu" value={aiStatusInfo.label} tone={aiStatusInfo.tone} />
        <AIDecisionMetric label="Aksiyon" value={actionLabel} tone={statusTone} />
      </div>

      {empty ? (
        <div className="rounded-lg border border-border bg-bg-soft px-3 py-3 text-sm text-muted">
          AI yorumu yükleniyor...
        </div>
      ) : (
        <>
          {data!.fallbackReason && (
            <div className="mb-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              AI değerlendirmesi şu an alınamadı: {data!.fallbackReason}.
              CoinBot mevcut karar destek kartlarıyla çalışmaya devam ediyor.
            </div>
          )}

          <div className="mb-3 rounded-md border border-border/70 bg-bg-soft/60 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-muted">Ana Bulgu</div>
            <p className="mt-1 text-sm text-slate-200">{data!.mainFinding || "—"}</p>
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <AIDecisionPanel title="Sistem Yorumu" tone="muted">
              {data!.systemInterpretation || "—"}
            </AIDecisionPanel>
            <AIDecisionPanel title="Önerilen Aksiyon" tone={statusTone}>
              <div>{data!.recommendation || "—"}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Pill tone={statusTone}>{actionLabel}</Pill>
                {data!.observeDays > 0 && <Pill tone="muted">{data!.observeDays} gün gözlem</Pill>}
                {data!.requiresUserApproval && <Pill tone="warning">Kullanıcı onayı gerekli</Pill>}
              </div>
            </AIDecisionPanel>
          </div>

          {data!.blockedBy.length > 0 && (
            <div className="mt-3 rounded-md border border-border/70 bg-bg-soft/60 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-muted">BLOKER ETİKETLERİ</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {data!.blockedBy.map((b) => (
                  <span key={b} className="rounded-md border border-border bg-bg px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-300">
                    {b}
                  </span>
                ))}
              </div>
            </div>
          )}

          {promptOpen && (
            <div className="mt-3 rounded-md border border-accent/40 bg-accent/5 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[10px] uppercase tracking-wider text-accent">ÖNERİLEN PROMPT</div>
                {!data!.suggestedPrompt && <span className="text-[10px] text-muted">Fallback prompt</span>}
              </div>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-bg/70 p-2 text-[11px] leading-relaxed text-slate-200">{promptText}</pre>
              <button
                type="button"
                onClick={handleCopyPrompt}
                className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-soft px-3 py-1.5 text-[11px] font-medium text-slate-300 hover:border-accent hover:text-accent"
              >
                <Copy className="h-3.5 w-3.5" />
                {copyDone ? "KOPYALANDI" : "PROMPT'U KOPYALA"}
              </button>
              <p className="mt-1 text-[10px] text-muted">
                Bu prompt otomatik çalıştırılmaz; manuel olarak Claude Code/Codex&apos;e yapıştırabilirsiniz.
              </p>
            </div>
          )}

          {data!.safetyNotes.length > 0 && (
            <div className="mt-3 rounded-md border border-border/70 bg-bg-soft/60 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-muted">GÜVENLİK NOTLARI</div>
              <ul className="mt-1 grid gap-1 text-[11px] leading-snug text-slate-300 sm:grid-cols-2">
                {data!.safetyNotes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </div>
          )}
        </>
      )}

      {actionNotice && (
        <div className={`mt-3 rounded-md border px-3 py-2 text-xs ${
          actionNotice.tone === "success" ? "border-success/30 bg-success/10 text-success" :
          actionNotice.tone === "warning" ? "border-warning/30 bg-warning/10 text-warning" :
          actionNotice.tone === "danger" ? "border-danger/30 bg-danger/10 text-danger" :
          "border-accent/30 bg-accent/10 text-accent"
        }`}>
          {actionNotice.text}
        </div>
      )}

      {/* Aksiyon butonları — ONAYLA YOK; AI canlıyı açan UI içermez */}
      <div className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-3 lg:flex-row lg:items-center">
        <div className="flex flex-col gap-1.5 sm:flex-row">
          <button
            type="button"
            onClick={handleObserve}
            className={`${actionButtonCls} ${
              observeSelected
                ? "border-success/50 bg-success/10 text-success"
                : "border-border bg-bg-soft text-slate-300 hover:border-accent hover:text-accent"
            } disabled:opacity-50`}
            data-action-kind="OBSERVE"
            disabled={empty}
          >
            <Eye className="h-3.5 w-3.5" />
            {observeSelected ? "GÖZLEM KAYDEDİLDİ" : `GÖZLEM (${observeDays}g)`}
          </button>
          <button
            type="button"
            onClick={handlePrompt}
            className={`${actionButtonCls} ${
              promptOpen
                ? "border-accent/50 bg-accent/10 text-accent"
                : "border-border bg-bg-soft text-slate-300 hover:border-accent hover:text-accent"
            } disabled:opacity-50`}
            data-action-kind="PROMPT"
            aria-expanded={promptOpen}
            disabled={empty}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            PROMPT
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            className={`${actionButtonCls} border-border bg-bg-soft text-slate-300 hover:border-accent hover:text-accent disabled:opacity-50`}
            data-action-kind="REFRESH"
            disabled={refreshing}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "YENİLENİYOR" : "RAPORU YENİLE"}
          </button>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-muted lg:ml-auto lg:text-right">
          AI yorumlayıcıdır; ayar değiştirmez, emir açmaz.
        </span>
      </div>
    </div>
  );
}
