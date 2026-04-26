# Multi-Exchange Futures Trading Bot

Next.js + Supabase tabanlı, **futures-first**, **paper-trading varsayılanı** çalışan, çok-borsa destekli profesyonel trading bot dashboard'u.

> **Bu sistem garanti kâr iddiası taşımaz.** Amaç: sermayeyi koruyan, kötü işlemleri filtreleyen, kaliteli fırsatları analiz eden ve günlük küçük/sürdürülebilir kâr potansiyeli arayan, risk-disiplinli bir bot altyapısıdır. Default'ta **gerçek emir göndermez**.

---

## Özellikler

- **Futures-first mimari** — LONG / SHORT / WAIT / EXIT_LONG / EXIT_SHORT / NO_TRADE sinyalleri.
- **Multi-exchange adapter** — MEXC, Binance, OKX, Bybit. Signal/risk engine borsa-agnostik.
- **Strict risk engine** — sistem kaldıraç tavanı **5x**, default 3x; per-trade risk ≤ %1; günlük/haftalık zarar limiti; min R:R 1:2; izole margin; likidasyon-stop güvenlik kontrolü; full-balance/martingale/revenge yasak.
- **Daily profit target** — varsayılan $20, üst limit $50; hedef tamamlanınca yeni işlem açmaz.
- **Paper trading engine** — kaldıraç, margin used, fees, slippage, funding, mark-to-market simülasyonu; SL/TP/trailing/break-even altyapısı.
- **Live trading guard** — `LIVE_TRADING=true` + risk allowed + credential validation + kill-switch off + likidasyon güvenli + ISOLATED + leverage ≤ 5x kontrollerini geçmeden emir gönderilmez. Default kapalı.
- **Kill switch** — tek tıkla bot durur, açık paper pozisyonlar değerlendirilir.
- **API credential yönetimi** — AES-256-GCM ile server-side şifrelenmiş, UI'da maskeli; secret asla istemciye dönmez.
- **Dashboard UI** — Dashboard, Market Scanner, Coin Detail, Paper Trades, Risk Settings, API Settings, Strategy/Watchlist, Performance, Logs.
- **Bot logları** — her karar (sinyal nedeni, red sebebi, risk engellemesi) Supabase'e yazılır.

---

## Desteklenen Borsalar

| Exchange | Futures Public | Live Trading | Notlar |
|---|---|---|---|
| MEXC | ✅ | guarded | Birincil entegrasyon (kline, ticker, depth, funding). |
| Binance | ✅ | guarded | USDT-M perpetual public market data. |
| OKX | ✅ | guarded | SWAP perpetual public market data. Passphrase gerekir. |
| Bybit | ✅ | guarded | V5 linear perpetual public market data. |

> "guarded" = Live trading endpoint'leri adapter seviyesinde dahi `LIVE_TRADING` ve risk engine geçmedikçe hata fırlatır.

---

## Kurulum

```bash
npm install
cp .env.example .env.local
# CREDENTIAL_ENCRYPTION_KEY üretmek için (örnek):
# node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
npm run dev
```

### Env değişkenleri (özet)
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `CREDENTIAL_ENCRYPTION_KEY` — 32+ karakterlik server-side secret.
- `LIVE_TRADING=false` (default). Açmadıkça gerçek emir gitmez.
- Risk policy: `MAX_LEVERAGE`, `MAX_ALLOWED_LEVERAGE`, `MAX_RISK_PER_TRADE_PERCENT`, `MAX_DAILY_LOSS_PERCENT`, `MAX_WEEKLY_LOSS_PERCENT`, `DAILY_PROFIT_TARGET_USD`, `MAX_OPEN_POSITIONS`, `MIN_RISK_REWARD_RATIO`.
- Borsa key'leri (opsiyonel, server-only): `MEXC_API_KEY`, `MEXC_API_SECRET`, `BINANCE_API_KEY` ...

Tüm liste için `.env.example` dosyasına bakın.

---

## Supabase Migration

```bash
# Supabase CLI ile:
supabase db push   # supabase/migrations/0001_init.sql
# veya panelden SQL Editor'a 0001_init.sql içeriğini yapıştırın.
```

`supported_exchanges` tablosuna MEXC, Binance, OKX, Bybit kayıtları otomatik eklenir.

---

## Vercel Deploy

1. Repo'yu GitHub'a push edin.
2. Vercel'de yeni proje, framework Next.js.
3. Aşağıdaki "Vercel Environment Variables" bölümündeki tüm değişkenleri **Production** environment'ında ekleyin.
4. Deploy.

> Edge runtime kullanılmaz; tüm API route'ları `runtime = "nodejs"` ile çalışır (Node `crypto` ve fetch için gerekli).

### Vercel Environment Variables

Aşağıdaki değişkenleri Vercel → Project Settings → Environment Variables altında **Production** (ve istenirse Preview) environment'ına ekleyin:

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | — | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | — | anon public API key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | — | service_role secret (sensitive) |
| `CREDENTIAL_ENCRYPTION_KEY` | ✅ | — | 32+ char random secret for AES-256-GCM |
| `LIVE_TRADING` | recommended | `false` | Hard gate; never enable without auditing |
| `DEFAULT_TRADING_MODE` | optional | `paper` | `paper` \| `live` |
| `DEFAULT_MARKET_TYPE` | optional | `futures` | `futures` \| `spot` |
| `DEFAULT_MARGIN_MODE` | optional | `isolated` | `isolated` \| `cross` |
| `DEFAULT_ACTIVE_EXCHANGE` | optional | `mexc` | `mexc` \| `binance` \| `okx` \| `bybit` |
| `MAX_LEVERAGE` | recommended | `3` | Clamped to `MAX_ALLOWED_LEVERAGE` |
| `MAX_ALLOWED_LEVERAGE` | recommended | `5` | Hard-clamped to system cap (5x) |
| `MAX_RISK_PER_TRADE_PERCENT` | optional | `1` | |
| `MAX_DAILY_LOSS_PERCENT` | optional | `5` | |
| `MAX_WEEKLY_LOSS_PERCENT` | optional | `10` | |
| `DAILY_PROFIT_TARGET_USD` | optional | `20` | |
| `MAX_DAILY_PROFIT_TARGET_USD` | optional | `50` | Upper bound |
| `MAX_OPEN_POSITIONS` | optional | `2` | |
| `MIN_RISK_REWARD_RATIO` | optional | `2` | |

> **After changing environment variables in Vercel, redeploy the project.** Mevcut deployment yeni env değerlerini otomatik almaz — Deployments → `...` → Redeploy.

Runtime kontrolü: `GET /api/system/env-check` eksik/boş değişkenleri ve effective config'i döner. Dashboard'da "System Config Status" kartı bu sonucu görsel olarak gösterir.

---

## Futures Paper Trading Kullanımı

1. Dashboard → **Start** veya **Run Tick**: bot izlenen sembolleri tarar, sinyal üretir, risk engine onaylarsa paper pozisyon açar.
2. **Paper Trades** sayfasından açık pozisyonları görüntüleyin/kapatın. Sistem ayrıca SL/TP'yi mark-to-market sweep ile otomatik kapatır.
3. **Coin Detail** sayfasından elle sinyal üretip risk engine süzgecinden geçirerek paper işlem açabilirsiniz.

---

## Live Trading Neden Default Kapalı?

Bu altyapı sermaye koruması üzerine kuruludur. Live trading açık olsa bile:
- API credentials AES-256-GCM ile şifreli saklanır, secret hiçbir zaman frontend'e dönmez.
- Adapter `placeFuturesOrder`, `cancelOrder`, `closePosition` çağrıları ek bir guard katmanı arkasında çalıştırılmalıdır (`live-trading-guard.ts`).
- Her emir öncesi: API key & secret var mı, validate edildi mi, withdrawal izni KAPALI mı, futures destekli mi, risk engine onayı, ISOLATED margin, kill-switch off, günlük zarar limiti, max açık pozisyon, leverage ≤ 5x, likidasyon güvenli mi… kontrolleri yapılır.
- Bunlardan biri başarısızsa emir gönderilmez.

---

## API Key Güvenlik Notları

- **Withdrawal iznini AÇMAYIN.** Sistem para çekme endpoint'i kullanmaz, key'inizde de bu yetki bulunmamalıdır.
- **IP whitelist kullanın.** Mümkünse borsa tarafında bot IP'sini kısıtlayın (Vercel için statik bir IP yoksa staging/self-hosted ortam tercih edin).
- **Trade izni** verirseniz dahi live trading default kapalıdır; bot futures verisi için key gerektirmez.

---

## Günlük Kâr Hedefi Mantığı

- Default: **$20**, kullanıcı ayarı 1–50 arası.
- Hedef tamamlanınca bot yeni işlem açmaz; isterseniz **conservative mode** ile sadece çok yüksek skorlu işlemleri kabul eder.
- Hedefe ulaşmak için kaldıraç artırılmaz, risk gevşetilmez. **Martingale, revenge trading, full-balance trade ve 5x üstü kaldıraç tasarımca yasaktır.**

---

## Risk Yönetimi Özet

- Sistem hard cap kaldıraç: **5x**.
- Sinyal skoruna bağlı kaldıraç tavanı: 70-79 → 2x, 80-89 → 3x, 90+ → 5x.
- Volatilite/funding/spread aşırıysa kaldıraç düşürülür veya işlem açılmaz.
- Stop-loss likidasyondan önce çalışacak şekilde hesaplanır; aksi halde işlem açılmaz.
- Aynı anda max 2 açık pozisyon (configurable).
- Aynı sembolde tek pozisyon, korele coin'lerde aşırı pozisyon kaçınılır.
- Art arda 3 zarar → bot otomatik pause.

---

## Kaldıraç ve Likidasyon Uyarıları

- 5x üstü kaldıraç UI'da reddedilir (Risk Settings) ve API katmanında Zod ile bloklanır.
- Likidasyon fiyatı `entry × (1 ∓ 0.95/leverage)` ile muhafazakâr tahmin edilir; gerçekte borsa marjin tablosu daha hassastır — yine de her durumda stop-loss likidasyon fiyatından **önce** çalışmalıdır.

---

## Bilinen Limitler

- Bu sürümde **gerçek WebSocket abonelikleri Vercel serverless ortamında kalıcı tutulmaz**; market data REST polling'e dayanır. Persistent WS için ayrı worker (Railway, Fly.io) önerilir.
- Authenticated trading endpoint imzalama kodları adapter seviyesinde guarded olarak `throw` eder; live mode için her borsanın HMAC/sign rutini ayrıca yazılmalı ve testnet'te doğrulanmalıdır.
- Tek-tenant default kullanıcı kimliğiyle gelir (bkz. `src/lib/auth.ts`); çok kullanıcılı kullanım için Supabase Auth bağlanması gerekir.
- Gelişmiş backtest motoru iskelete dahil değil; `strategy_configs` tablosu ve sinyal engine üzerinden eklenebilir.

---

## Lisans

MIT (özel kullanım için uyarlayın).
