# CoinBot — Proje Kuralları

Bu dosya, CoinBot projesinin değişmez ana kurallarını ve bunları
detaylandıran alt-doküman referanslarını içerir.

---

## Ana Kurallar

### 1. Güvenlik (CLAUDE.md)
- `HARD_LIVE_TRADING_ALLOWED=false` — canlı trading kapalı kalır.
- `MIN_SIGNAL_CONFIDENCE=70` — sinyal eşiği düşürülmez.
- BTC trend filtresi açık kalır.
- Worker lock mekanizması bozulmaz; aynı anda tek worker çalışır.
- Risk ayarları (leverage tavanı, R:R, daily loss vb.) gevşetilmez.

### 2. Binance API Guardrails — **DEĞİŞMEZ MİMARİ KURAL**
Detay: [BINANCE_API_GUARDRAILS.md](./BINANCE_API_GUARDRAILS.md)

CoinBot hiçbir koşulda Binance API rate limit ihlali, IP ban, request spam,
kontrolsüz polling, gereksiz endpoint çağrısı veya Binance tarafından
engelleme/sınırlama doğuracak API kullanım modeliyle çalışmaz.

Tüm Binance istekleri merkezi client üzerinden geçer; queue, concurrency
limit, weight izleme, TTL cache, single-flight dedupe, exponential backoff
+ jitter, circuit breaker ve duplicate-request guard zorunludur. Detaylar
ve gelecek fazlar için kontrol listesi bağlı dokümandadır.

### 3. Auto-deploy (CLAUDE.md)
Her tamamlanan iş sonrası: commit + push + GitHub Actions deploy doğrulama.
Detay: ana dizindeki `CLAUDE.md`.

---

## Tarama Modları (Faz 1 — iskelet)

CoinBot coin seçim mimarisi 3 bağımsız moddan oluşur:

| Mod | Kısa Etiket | Varsayılan |
|---|---|---|
| Geniş Market Taraması | `GMT` | aktif |
| Momentum Taraması | `MT` | aktif |
| Manuel İzleme Listesi | `MİL` | pasif |

Bir coin birden fazla kaynaktan geldiğinde ana dashboard/tablo gösteriminde
karma kaynak etiketi `KRM` (MIXED) kullanılır; tam kaynak listesi
detay/debug görünümlerinde tutulabilir.

**Faz 1 kapsamı:** sadece config/data model, API endpoint'leri, UI iskeleti
ve mod özet göstergesi eklendi. Sinyal motoru, skor hesabı, risk engine,
worker tick davranışı **değiştirilmedi**. Yeni periyodik Binance taraması
**başlatılmadı**; bu fazın koruduğu kurallar:

- `HARD_LIVE_TRADING_ALLOWED=false`
- `DEFAULT_TRADING_MODE=paper`
- `enable_live_trading=false`
- `MIN_SIGNAL_CONFIDENCE=70` (signal-engine `if (score < 70)` kapısı)
- BTC trend filtresi
- SL/TP/R:R kontrolleri
- Worker lock yapısı

Bu faz [BINANCE_API_GUARDRAILS.md](./BINANCE_API_GUARDRAILS.md) kurallarına
**aykırı hiçbir API kullanımı eklemedi**: yeni endpoint çağrısı yok, yeni
periyodik tarama yok, mevcut merkezi adapter dışı fetch yok.

**Ürün kuralı:** Tarama Modları kontrolleri ve aktif mod özetleri **yalnızca**
`/scan-modes` sayfasında yer alır. Panel/Dashboard ve Piyasa Tarayıcı
sayfalarında aktif mod rozet/banner/özet satırı gösterilmez.

İlgili dosyalar:
- `src/lib/scan-modes/` — types, sources, in-memory store.
- `src/app/api/scan-modes/` — GET/PUT, manual-list POST/DELETE.
- `src/app/scan-modes/page.tsx` — 3-kartlı modlar sayfası.

## Dokümantasyon İndeksi

- [BINANCE_API_GUARDRAILS.md](./BINANCE_API_GUARDRAILS.md) — Binance API
  kullanım kuralları (rate limit, weight, cache, queue, circuit breaker,
  yasak kullanımlar, faz kontrol listesi).
- [WORKER_AUTO_DEPLOY.md](./WORKER_AUTO_DEPLOY.md) — Worker'ın VPS'e
  otomatik deploy süreci.

---

## Değişiklik Politikası

Bu doküman ve referansladığı kural dokümanları (özellikle
[BINANCE_API_GUARDRAILS.md](./BINANCE_API_GUARDRAILS.md)) tek bir PR'da
"yan değişiklik" olarak güncellenmez. Kural gevşetme/silme önerisi ayrı,
gerekçeli bir mimari karar PR'ı gerektirir.
