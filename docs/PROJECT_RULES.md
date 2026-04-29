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

## Geniş Market Taraması — Katmanlı Altyapı (Faz 2 — iskelet)

Geniş Market Taraması **tüm piyasayı her tick derin analize sokmaz**.
Pipeline 4 katmandan oluşur:

1. **Universe** — Binance Futures `exchangeInfo`'dan yalnızca `PERPETUAL` +
   `quoteAsset=USDT` + `status=TRADING` semboller; varsayılan TTL **6 saat**.
2. **Lightweight Screener** — zaten merkezi adapter tarafından çekilmiş
   bulk ticker verisi üzerinden saf fonksiyon; volume/spread/movement
   eşikleri ve 0–100 `marketQualityPreScore` üretir. **Yeni Binance isteği
   atmaz.** Önerilen tarama periyodu **2 dakika** (henüz worker'a
   bağlanmadı).
3. **Candidate Pool** — birden fazla kaynaktan (Geniş/Momentum/Manuel)
   gelen adayları sembol bazında tekilleştirir, kaynakları birleştirir,
   üst sınır **50** uygular. Ana gösterimde ≥2 kaynak → `KRM` (MIXED).
4. **Deep Analysis Selection** — `getDeepAnalysisCandidates(pool, max=30)`
   ile sıralanmış üst-N listesi. Bu fazda signal-engine çağrılmaz; sadece
   bir sonraki faz için sınır arayüzü hazırlanmıştır.

**Faz 2 kapsamı sadece iskelet:** worker tick davranışı değişmedi, mevcut
10 core coin akışı bozulmadı, signal-engine / risk engine / live-gate /
SL-TP-R:R / leverage parametreleri **değiştirilmedi**. Yeni periyodik
Binance isteği eklenmedi; tüm fetch'ler **merkezi adapter** üzerinden
geçer (`getAdapter().getFuturesSymbols()`). Bu doküman ve
[BINANCE_API_GUARDRAILS.md](./BINANCE_API_GUARDRAILS.md) kuralları
korundu.

İlgili dosyalar:
- `src/lib/market-universe/types.ts` — config + DTO'lar.
- `src/lib/market-universe/universe-store.ts` — 6 saat TTL'li sembol
  evreni; tek allowed Binance call site (adapter üzerinden).
- `src/lib/market-universe/lightweight-screener.ts` — saf filtre + skor.
- `src/lib/market-universe/candidate-pool.ts` — multi-source merge +
  max 50.
- `src/lib/market-universe/deep-analysis.ts` — top-N seçici (max 30).

## Momentum Taraması — Altyapı (Faz 3 — iskelet)

Momentum Taraması her zaman **hem en çok yükselenleri hem en çok düşenleri
birlikte** değerlendirir. Kullanıcıya `Yükselenler / Düşenler / İkisi`
seçeneği **sunulmaz**; UI'da yalnızca Aktif/Pasif kontrolü vardır.

İşleyiş:
1. Faz 2 evreninden + zaten çekilmiş bulk ticker verisinden başlar; **yeni
   Binance HTTP isteği atılmaz** (saf fonksiyon).
2. Hijyen filtreleri: stablecoin tabanları (USDT/USDC/BUSD/DAI/TUSD/USDP/
   FDUSD/USDD/PYUSD), pasif/non-perp/USDT-dışı semboller, `minQuoteVolumeUsd`
   altı hacim, bid/ask varsa `maxSpreadPercent` üstü spread, `minAbsMovePercent`
   altı hareket → elenir.
3. İki yön ayrı sıralanır: top-N gainers (default 20), top-N losers
   (default 20). Birleştirilir, sembol bazında dedupe edilir.
4. Her aday için 0–100 `momentumScore` hesaplanır (movement + volume +
   spread health + direction clarity). `directionBias` = `UP` / `DOWN`
   signed change%'a göre.
5. Final cap: `maxMomentumCandidates` (default 40). `momentumRank` 1..N
   atanır.

**Faz 2 entegrasyonu:** `MomentumCandidate extends LightweightCandidate`
olduğundan `buildCandidatePool([momentumCandidates, ...])` doğrudan
çalışır. `WIDE_MARKET` + `MOMENTUM` çakışmasında ana gösterim **MIXED →
KRM**'dir; `sourceCandidates` listesi korunur.

**Faz 3 kapsamı sadece iskelet:** worker tick davranışı **değiştirilmedi**,
signal-engine / risk engine / live-gate / SL-TP-R:R / leverage **dokunulmadı**.
Yeni periyodik Binance API yükü oluşturulmadı. Tarama Modları sayfası
mevcut Aktif/Pasif arayüzüyle kalır; Panel/Piyasa Tarayıcı'da aktif mod
özeti gösterilmez (Faz 1.1 ürün kuralı).
[BINANCE_API_GUARDRAILS.md](./BINANCE_API_GUARDRAILS.md) kuralları korundu.

İlgili dosyalar:
- `src/lib/momentum-screener/types.ts` — `MomentumCandidate`,
  `MomentumScreenerConfig`, `DEFAULT_MOMENTUM_CONFIG`.
- `src/lib/momentum-screener/momentum-screener.ts` —
  `runMomentumScreen()`, `computeMomentumScore()`. Saf fonksiyon, HTTP
  içermez.
- `src/lib/momentum-screener/index.ts` — barrel.

## Manuel İzleme Listesi — Arama ve Yönetim (Faz 4)

Manuel İzleme Listesi yalnızca **Tarama Modları** sayfasında yönetilir.
Panel/Dashboard veya Piyasa Tarayıcı üzerinde aktif mod özeti gösterilmez
(Faz 1.1 ürün kuralı).

İşleyiş:
- **Arama** `GET /api/scan-modes/manual-list/search?q=…&limit=20`
  endpoint'i Faz 2'nin **cache'li market evrenini** kullanır
  (`getMarketUniverse()`, varsayılan TTL 6 saat). Her tuş basışı yeni
  Binance isteği üretmez.
- **Filtreler:** USDT perpetual + `status=TRADING` + stablecoin tabanları
  hariç. Sadece bu evren aranır; sonuçlar prefix-match önceliklidir.
- **Boş sorgu** boş liste döner — gereksiz uzun varsayılan liste
  gösterilmez.
- **Ekleme** `POST /api/scan-modes/manual-list` artık girdiyi cache'li
  evrenle doğrular (`resolveManualListSymbol`): "sol" → `SOL/USDT`,
  "btcusdt" → `BTC/USDT`, "BTC-USDT-SWAP" → `BTC/USDT`. Evrende
  bulunmayan veya stablecoin tabanlı semboller reddedilir.
- **Duplicate koruması:** aynı sembol zaten listedeyse 409.
- **Kaldırma** `DELETE /api/scan-modes/manual-list?symbol=…` mevcut
  davranışla aynı.
- **Mod pasif yapılırsa liste silinmez** (Faz 1 garantisi sürer).

**Kaynak gösterimi:** `MANUAL_LIST` → `MİL`. Aynı coin başka kaynakla
çakışırsa ana gösterim **MIXED → KRM**'dir.

**Faz 4 kapsamı:** mevcut çalışan trade açma mantığı, signal-engine, risk
engine, leverage, live-gate, worker tick **dokunulmadı**. Tüm Binance
trafiği merkezi adapter üzerinden ve cache'li evren ile yönetilir;
[BINANCE_API_GUARDRAILS.md](./BINANCE_API_GUARDRAILS.md) kuralları
korundu.

İlgili dosyalar:
- `src/lib/scan-modes/manual-list-search.ts` — saf
  `searchManualListCandidates` + `resolveManualListSymbol`.
- `src/app/api/scan-modes/manual-list/search/route.ts` — arama endpoint'i
  (cache'li evren).
- `src/app/api/scan-modes/manual-list/route.ts` — POST artık evren
  doğrulaması yapar.
- `src/app/scan-modes/page.tsx` — debounce'lu arama + sonuç listesi +
  "Seçili" rozet.

## Birleşik Aday Havuz (Faz 5)

`GMT`, `MT`, `MİL` **yalnızca coin kaynaklarıdır**. Pozisyon açma kararı
değişmemiştir — tek trade engine (signal-engine + risk-engine) tarafından
verilir; bu faz orada hiçbir şey değiştirmez.

Birleşik aday havuz `buildUnifiedCandidatePool()` tarafından üretilir:

- 3 kaynak da aktifse Faz 2 lightweight screener (`WIDE_MARKET`), Faz 3
  momentum screener (`MOMENTUM`) ve Manuel İzleme Listesi (`MANUAL_LIST`)
  sonuçları aynı havuzda birleştirilir.
- Her kaynak bağımsız Aktif/Pasif anahtarına sahiptir; pasif kaynak hiçbir
  aday katmaz. Manuel İzleme Listesi pasif yapılırsa **liste silinmez**;
  sadece bu havuza dahil edilmez.
- Manuel adaylar evrenle (Faz 2 cache'i) doğrulanır: evrende yoksa /
  stablecoin tabanlıysa **filteredOutManualSymbols**'e düşer; evrende
  ama o anda ticker'ı yoksa havuza degraded entry olarak girer ve
  **missingMarketDataSymbols**'e listelenir.
- Aynı coin birden fazla kaynaktan gelirse tek entry olur; `sources`
  listesi birleştirilir ve ana gösterimde `MIXED → KRM` görünür. Tek
  kaynaklı `MANUAL_LIST` `MİL` görünür.

**Limitler:** `unifiedCandidatePool` ≤ **50**, `deepAnalysisCandidates` ≤
**30**. Sabitler `DEFAULT_MARKET_UNIVERSE_CONFIG`'ten gelir.

**Worker entegrasyonu:** Faz 5'te orchestrator worker tick'e
**bağlanmadı**. Mevcut 10 core coin davranışı ve mevcut tarama akışı
**aynen** çalışır. Tek API yüzeyi salt-okunur snapshot endpoint'i:
`GET /api/candidate-pool/snapshot`. Bu endpoint dakikada **en fazla bir**
toplu Binance çağrısı yapar (cache'li bulk-ticker, 60s TTL) ve evren
çağrısını 6 saatte bir yapar — kline/order book çağrısı **yoktur**.
[BINANCE_API_GUARDRAILS.md](./BINANCE_API_GUARDRAILS.md) kuralları
korundu.

İlgili dosyalar:
- `src/lib/candidate-orchestrator/types.ts`
- `src/lib/candidate-orchestrator/build-unified-candidates.ts`
- `src/lib/candidate-orchestrator/index.ts`
- `src/lib/market-universe/bulk-ticker-cache.ts` (60s TTL)
- `src/app/api/candidate-pool/snapshot/route.ts` (read-only)

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
