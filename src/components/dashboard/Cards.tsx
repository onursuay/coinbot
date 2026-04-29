"use client";
// Phase 9 — Dashboard kart bileşenleri.
//
// Bu modül yalnızca presentation içerir. Hesaplama mantığı
// `src/lib/dashboard/` altında saf fonksiyonlar olarak yaşar; bu
// dosya yalnızca onların çıktısını render eder. Hiçbir trade kararı,
// risk engine ayarı veya canlı trading gate'i bu kartlardan etkilenmez.
import Link from "next/link";
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
export function BotStatusCard({ data, actions }: { data: BotStatusInput; actions: BotStatusActions }) {
  const status = (data.bot_status ?? "stopped").toString().toLowerCase();
  const isRunning = status.startsWith("running");
  const isKillSwitch = status === "kill_switch" || data.kill_switch_active === true;
  const exchange = (data.active_exchange ?? "binance").toString().toUpperCase();

  const statusLabel = isKillSwitch
    ? "ACİL DURDURULDU"
    : status === "running" || status === "running_paper" || status === "running_live"
      ? "ÇALIŞIYOR"
      : status === "stopped" ? "DURDU"
      : status.toUpperCase().replace(/_/g, " ");

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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
        <CompactBox label="PİYASA VERİSİ" value={marketLive ? "CANLI" : "BEKLİYOR"}
          tone={marketLive ? "success" : "muted"} />
        <CompactBox label="SUNUCU" value={data.worker_online ? "ÇEVRİMİÇİ" : "ÇEVRİMDIŞI"}
          tone={data.worker_online ? "success" : "danger"} />
        <CompactBox label="WEBSOCKET" value={(data.websocket_status ?? "—").toUpperCase()}
          tone={data.websocket_status === "connected" ? "success" : "muted"} />
        <CompactBox label="SON GÜNCELLEME" value={lastTickLabel} tone="muted" />
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

      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn-primary text-sm px-3 py-1.5" onClick={actions.onStartPaper} disabled={data.busy || isRunning}>
          Başlat
        </button>
        <button className="btn-ghost text-sm px-3 py-1.5" onClick={actions.onStop} disabled={data.busy || !isRunning}>
          Durdur
        </button>
        <button className="btn-ghost text-sm px-3 py-1.5" onClick={actions.onTick} disabled={data.busy}>
          Taramayı Çalıştır
        </button>
        <button
          className="ml-auto text-sm px-3 py-1.5 rounded-lg border border-danger/60 text-danger hover:bg-danger/10 font-medium transition-colors"
          onClick={actions.onKillSwitch}
          disabled={data.busy}
        >
          ACİL DURDUR
        </button>
      </div>
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
  const top = candidates.slice(0, 5);

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold tracking-wide">POZİSYONA EN YAKIN COİNLER</h2>
        <span className="text-[10px] uppercase tracking-wider text-muted">eşik 70</span>
      </div>
      {top.length === 0 ? (
        <p className="text-sm text-muted">Bu periyotta güçlü fırsat yok.</p>
      ) : (
        <ul className="space-y-2">
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
          <span className="text-[10px] uppercase tracking-wider text-muted">BEKLENİYOR</span>
        </div>
        <p className="text-sm text-muted">İlk paper işlem açıldıktan sonra E2E doğrulaması burada raporlanır.</p>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          <CompactBox label="HARD LIVE GATE" value={hardLiveAllowed ? "AÇIK" : "KAPALI"} tone={hardLiveAllowed ? "warning" : "success"} />
          <CompactBox label="MOD" value="PAPER" tone="muted" />
          <CompactBox label="GERÇEK EMİR" value="YOK" tone="success" />
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
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-success/20 text-success">TÜMÜ GEÇTİ</span>
          ) : firstTradeMissing ? (
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-bg-soft text-muted">BEKLENİYOR</span>
          ) : failed.length > 0 ? (
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-danger/20 text-danger">{failed.length} BAŞARISIZ</span>
          ) : null}
          {skipped.length > 0 && (
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-bg-soft text-muted">{skipped.length} ATLANDI</span>
          )}
        </div>
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
        {data.checks!.map((c) => {
          // first_trade_opened için kırmızı yerine gri bekleniyor.
          const pendingFirstTrade = c.name === "first_trade_opened" && !c.ok && !c.skipped;
          const tone =
            c.skipped ? "muted" :
            c.ok ? "success" :
            pendingFirstTrade ? "muted" : "danger";
          return (
            <li key={c.name} className="flex items-start gap-2 text-xs">
              <span className={`mt-0.5 font-bold flex-shrink-0 ${
                tone === "success" ? "text-success" :
                tone === "danger"  ? "text-danger"  : "text-muted"
              }`}>
                {c.skipped ? "—" : c.ok ? "✓" : pendingFirstTrade ? "·" : "×"}
              </span>
              <div className="flex-1 min-w-0">
                <span className={`font-medium ${
                  tone === "success" ? "" :
                  tone === "danger"  ? "text-danger" : "text-muted"
                }`}>{c.label}</span>
                {c.detail && <span className="text-muted ml-2 truncate">{c.detail}</span>}
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
  HEALTHY: "SAĞLIKLI",
  WATCH: "GÖZLEM",
  ATTENTION_NEEDED: "DİKKAT",
  DATA_INSUFFICIENT: "VERİ YETERSİZ",
};

const STATUS_TONE: Record<DecisionStatusPretty, Tone> = {
  HEALTHY: "success",
  WATCH: "warning",
  ATTENTION_NEEDED: "danger",
  DATA_INSUFFICIENT: "muted",
};

const ACTION_LABEL: Record<DecisionActionPretty, string> = {
  NO_ACTION: "AKSİYON YOK",
  OBSERVE: "GÖZLEM",
  REVIEW_THRESHOLD: "EŞİK İNCELEMESİ",
  REVIEW_STOP_LOSS: "STOP-LOSS İNCELEMESİ",
  REVIEW_RISK_SETTINGS: "RİSK AYAR İNCELEMESİ",
  REVIEW_POSITION_LIMITS: "POZİSYON LİMİT İNCELEMESİ",
  REVIEW_SIGNAL_QUALITY: "SİNYAL KALİTE İNCELEMESİ",
  DATA_INSUFFICIENT: "VERİ YETERSİZ",
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
  const tradeModeLabel = data?.tradeMode === "live" ? "CANLI" : "PAPER";
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
            {data!.requiresUserApproval ? " · KULLANICI ONAYI BEKLENİYOR" : ""}
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
  HEALTHY: "SAĞLIKLI",
  WATCH: "GÖZLEM",
  ATTENTION_NEEDED: "DİKKAT",
  DATA_INSUFFICIENT: "VERİ YETERSİZ",
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
  const tradeModeLabel = data?.tradeMode === "live" ? "CANLI" : "PAPER";
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
