# CoinBot — Project Instructions

> **🚨 KURAL — Her işlem sonrasında otomatik yapılacaklar:**
> **Commit + push yap. Worker kodu değiştiyse VPS deploy'u izle; UI-only değişiklikse workflow tetiklenmez, sadece Vercel'e gider.**

## Her işlem sonrasında otomatik yapılacaklar

**Her görev tamamlandığında**, kullanıcı ayrıca istemese bile:

1. **Commit** — değişen dosyaları stage et, anlamlı bir commit mesajı yaz.
2. **Push** — `git push origin main`.

### Değişiklik tipine göre deploy davranışı

| Değişen dosyalar | GitHub Actions tetiklenir mi? | Yapılacak |
|------------------|-------------------------------|-----------|
| `worker/**`, `src/lib/**`, `scripts/**`, `package.json`, `tsconfig.json` | ✅ Evet — VPS deploy çalışır | `gh run watch <run-id>` ile izle, heartbeat doğrula |
| `src/app/**`, `src/components/**`, `CLAUDE.md`, `*.md` | ❌ Hayır — sadece Vercel | Push yeterli; workflow izleme gerekmez |
| `workflow_dispatch` ile manuel tetikle | ✅ Her zaman | Gerektiğinde `gh workflow run deploy-worker.yml` |

**VPS deploy gerektiren değişiklikte doğrulama:**
- `gh run watch <run-id> --exit-status` ile workflow'u izle
- Heartbeat'te `"online":true` ve `"status":"running_paper"` görünmeli

### Atlanacak durumlar
- Değişiklikler test/build'i kıracaksa → commit/push yapma, önce sorunu çöz.
- Kullanıcı açıkça "henüz commit etme" / "lokal kalsın" dediyse → atla.

### Workflow detayları
- Auto-deploy workflow: `.github/workflows/deploy-worker.yml`
- Path filtresi: `worker/**`, `src/lib/**`, `scripts/**`, `package.json`, `tsconfig.json`, workflow dosyasının kendisi
- Push (path eşleşirse) → SSH to VPS → `git reset --hard origin/main` → `bash scripts/deploy-worker.sh`
- Heartbeat check: `https://coin.onursuay.com/api/bot/heartbeat`
- Bilinen false-positive: workflow log'unda "WARNING: workerOnline is not true"
  görünür çünkü grep `workerOnline:true` arıyor ama endpoint `online:true`
  döndürüyor. Response içinde `"online":true` ve `"status":"running_paper"`
  varsa deploy başarılıdır.

## Proje Çalışma Mantığı

### Genel Mimari

CoinBot üç katmandan oluşur:

- **Next.js Dashboard + API** (Vercel): Web arayüzü ve REST endpoint'leri.
- **VPS Worker** (Docker, uzun ömürlü Node.js process): 30 sn'de bir tick döngüsü; scan → sinyal → risk → paper trade.
- **Supabase**: Tüm konfigürasyon, trade geçmişi, log ve gerçek zamanlı durum buradadır.
- **Exchange Adapter'ları** (Binance, MEXC, OKX, Bybit): Yalnızca piyasa verisi okur; canlı emir gönderme hard-disable.

### Tick Döngüsü (Veri Akışı)

```
VPS Worker (her 30s)
  └─ bot-orchestrator.ts
       ├─ bot_settings + risk_settings yükle
       ├─ Günlük hedef / loss limit kontrolü → aşıldıysa dur
       ├─ Sembol evreni seç (core + dynamic + unified pool)
       ├─ Her sembol için kline + ticker + funding çek
       │
       ├─ [signal-engine.ts]
       │    ├─ 20+ indikatör hesapla (MA8/55/200, RSI, MACD, BB, ADX, VWAP, ATR, hacim)
       │    ├─ setupScore (0-100, 10 bileşen) + marketQualityScore hesapla
       │    ├─ Skor ≥70 + tüm filtreler geçti → LONG veya SHORT
       │    └─ Aksi hâlde WAIT / NO_TRADE
       │
       ├─ [risk-engine.ts] — geçen sinyaller için
       │    ├─ Pozisyon boyutu: riskAmount = kapital × riskPct; qty = riskAmount / stopMesafesi
       │    ├─ Kaldıraç sınırla (skor 90+→5x, 80+→3x, 70+→2x, <70→1x)
       │    ├─ Margin cap: sıkı SL (<1%) → reddet; margin ≤ hesap×%10
       │    ├─ Tier politikası, kill switch, günlük/haftalık zarar, max pozisyon, likidasyon güvenliği
       │    └─ allowed=true/false + diagnostics döner
       │
       └─ [paper-trading-engine.ts] — onaylanan sinyaller için
            ├─ paper_trades tablosuna INSERT (open)
            └─ Her tick'te açık pozisyonları mark-to-market → SL/TP tetiklenirse kapat
```

### Canlı Trading Güvenlik Kapısı (3 Katman)

Canlı emir açmak için **üçü aynı anda** doğru olmalıdır:

1. `HARD_LIVE_TRADING_ALLOWED=true` — env var (şu an `false`, asla değiştirme)
2. `bot_settings.trading_mode='live'` — DB toggle
3. `bot_settings.enable_live_trading=true` — DB explicit confirm

### Temel Dosyalar

| Dosya | Görev |
|-------|-------|
| `src/lib/engines/bot-orchestrator.ts` | Ana tick döngüsü |
| `src/lib/engines/signal-engine.ts` | LONG/SHORT kararı |
| `src/lib/engines/risk-engine.ts` | Pozisyon boyutu + risk kapıları |
| `src/lib/engines/paper-trading-engine.ts` | Paper trade aç/kapat, SL/TP sweep |
| `src/lib/engines/heartbeat.ts` | Worker sağlık raporu (15s'de bir) |
| `src/lib/risk-tiers.ts` | TIER_1/2/3 kaldıraç + RR politikaları |
| `src/lib/dashboard/paper-stats.ts` | Canonical P&L hesabı (tek kaynak) |
| `src/app/api/bot/tick/route.ts` | Tek tick tetikleyici endpoint |
| `worker/index.ts` | VPS'teki uzun ömürlü process giriş noktası |

### Supabase Tabloları

| Tablo | İçerik |
|-------|--------|
| `bot_settings` | trading_mode, exchange, leverage, risk %, günlük hedef |
| `paper_trades` | Tüm paper trade geçmişi (open/closed, pnl, margin, leverage) |
| `bot_logs` | Olay logu (tick, sinyal, risk reddi, hata) |
| `risk_settings` | JSONB risk konfigürasyonu |
| `risk_events` | Risk kapısı ihlalleri |
| `worker_heartbeat` | Son worker sağlık durumu + timestamp |
| `trade_learning_events` | Paper learning modu kapandı analizi |

### Risk Tier Politikaları

| Tier | Semboller | Max Kaldıraç | Min R:R |
|------|-----------|--------------|---------|
| TIER_1 | BTC, ETH | 3x | 2.0 |
| TIER_2 | SOL, BNB, XRP, LTC | 2x | 2.2 |
| TIER_3 | AVAX, LINK, ADA, DOGE | 1x | 2.0 |

### VPS Worker Yönetimi

- Tick döngüsü: 30s — `tickBot()` çağırır
- Heartbeat döngüsü: 15s — Supabase'e durum yazar
- Dağıtık kilit: Çift worker'ı önler (TTL: 90s)
- Deploy: `scripts/deploy-worker.sh` → Docker image build → sağlık kontrolü → başarısızsa auto-rollback
- Graceful shutdown: SIGTERM/SIGINT → döngüler durur → son heartbeat → lock serbest

### Bypass Modları (Tümü Hard-Disabled)

`paper_learning_mode`, `force_paper_entry`, `aggressive_paper` — üçü de kod seviyesinde `active=false` döndürür. Env var ile yeniden açılamaz; açmak için kod değişikliği gerekir.

---

## Güvenlik kuralları (asla değiştirme)
- `HARD_LIVE_TRADING_ALLOWED=false` — canlı trading kapalı kalmalı.
- `MIN_SIGNAL_CONFIDENCE=70` — sinyal eşiği düşürülmemeli.
- BTC trend filtresi açık kalmalı.
- Worker lock mekanizması bozulmamalı (duplicate worker önlenmeli).
- Risk ayarları gevşetilmemeli.
