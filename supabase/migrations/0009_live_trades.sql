-- Faz 15 — Live Trades Analiz Altyapısı
--
-- AMAÇ: Canlıya geçiş için veri/analiz altyapısı; gerçek canlı emir gönderimi YOK.
-- Bu tablo yalnızca analiz ve görüntüleme içindir. Trade Performance Engine
-- paper/live ortak çalışır; live_trades veri adaptörü (liveTradeRowToNormalizedTrade)
-- aynı NormalizedTrade modeline dönüştürür.
--
-- MUTLAK KURALLAR:
--   • Bu tablo canlı emir açmaz, kapatmaz.
--   • Binance private/order endpoint çağrısı bu tablo üzerinden YAPILAMAZ.
--   • HARD_LIVE_TRADING_ALLOWED=false korunur.
--   • DEFAULT_TRADING_MODE=paper korunur.
--   • enable_live_trading=false korunur.
--   • Bu migration hiçbir openLiveOrder / closeLiveOrder mantığı içermez.

create table if not exists public.live_trades (
  -- ── Kimlik alanları ───────────────────────────────────────────────────────
  id                    uuid        primary key default gen_random_uuid(),
  user_id               uuid        not null,

  -- ── Sembol / yön ─────────────────────────────────────────────────────────
  symbol                text        not null,
  side                  text        not null check (side in ('LONG', 'SHORT')),

  -- ── Durum ────────────────────────────────────────────────────────────────
  status                text        not null default 'open'
                                    check (status in ('open', 'closed', 'cancelled', 'error')),

  -- ── Fiyat ve miktar alanları ──────────────────────────────────────────────
  entry_price           numeric,
  exit_price            numeric,
  quantity              numeric,
  leverage              numeric,
  stop_loss             numeric,
  take_profit           numeric,

  -- ── PnL ──────────────────────────────────────────────────────────────────
  pnl                   numeric,
  pnl_percent           numeric,

  -- ── Zaman damgaları ───────────────────────────────────────────────────────
  opened_at             timestamptz,
  closed_at             timestamptz,

  -- ── Kapanış / giriş sebebi ────────────────────────────────────────────────
  close_reason          text,
  entry_reason          text,
  exit_reason           text,

  -- ── Sinyal ve skor alanları ───────────────────────────────────────────────
  trade_signal_score    numeric,
  setup_score           numeric,
  market_quality_score  numeric,
  source_display        text,
  source_detail         text,

  -- ── Risk/oran alanları ────────────────────────────────────────────────────
  rr_ratio              numeric,
  stop_distance_percent numeric,

  -- ── Emir kimlikleri (gelecekte live execution adapter için hazır) ─────────
  -- NOT: Bu alanlar sadece kayıt amaçlıdır; bu fazda emir açılmaz.
  order_id              text,
  client_order_id       text,
  position_id           text,

  -- ── Borsa ve execution meta ───────────────────────────────────────────────
  exchange              text        not null default 'binance',
  execution_type        text        not null default 'real'
                                    check (execution_type in ('real', 'simulated')),
  trade_mode            text        not null default 'live'
                                    check (trade_mode in ('live', 'paper')),

  -- ── Ham payload (audit trail; yalnızca log amaçlı) ───────────────────────
  -- NOT: Bu alanlar hiçbir zaman canlı emir yürütmek için kullanılmaz.
  raw_entry_payload     jsonb,
  raw_exit_payload      jsonb,

  -- ── Sistem alanları ───────────────────────────────────────────────────────
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ── İndeksler ─────────────────────────────────────────────────────────────
create index if not exists idx_live_trades_user_id
  on public.live_trades (user_id);

create index if not exists idx_live_trades_status
  on public.live_trades (user_id, status);

create index if not exists idx_live_trades_symbol
  on public.live_trades (user_id, symbol);

create index if not exists idx_live_trades_opened_at
  on public.live_trades (user_id, opened_at desc);

-- ── Güvenlik notu ─────────────────────────────────────────────────────────
-- live_trades tablosu READ-ONLY analiz içindir.
-- Binance private/order API endpoint çağrısı bu tablo üzerinden YAPILAMAZ.
-- Trade Performance Engine (src/lib/trade-performance/) aynı NormalizedTrade
-- modeli ile paper/live ortak analiz yapar.
-- openLiveOrder / closeLiveOrder bu fazda eklenmedi.
