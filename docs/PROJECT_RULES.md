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

## Worker'a Güvenli Entegrasyon (Faz 6)

Faz 5'in birleşik aday havuzu **opt-in feature flag** ile worker tick'ine
bağlanır. Varsayılan **kapalıdır** — flag kapalıyken Faz 5 davranışı bire
bir korunur (orchestrator hiçbir şekilde tick hot path'inde çağrılmaz).

**Feature flag:**

| Env | Default | Anlamı |
|---|---|---|
| `USE_UNIFIED_CANDIDATE_POOL` | `false` | Açıldığında worker'ın ek (non-core) aday listesi unified deep-analysis alt kümesinden gelir. |
| `UNIFIED_DEEP_ANALYSIS_MAX` | `30` | Worker'a teslim edilen unified deep candidate hard cap'i. `DEFAULT_MARKET_UNIVERSE_CONFIG.deepAnalysisMax` (30) ile sınırlanır. |
| `UNIFIED_CANDIDATE_REFRESH_INTERVAL_SEC` | `120` | Worker tarafı pool snapshot TTL'i. Bu süre dolmadan tick'lerde orchestrator yeniden çalıştırılmaz. |

**Flag açıkken worker davranışı:**

1. **Mevcut core 10 coin korunur** (`tierWhitelist()`); her tick analizden
   geçer.
2. Worker, `getUnifiedCandidates()` ile pool snapshot'ını alır:
   - Snapshot cache geçerliyse (≤ 120 s) yeniden hesaplanmaz.
   - Süre dolmuşsa Faz 2 cache'li evren (6 saat TTL) + Faz 5 bulk ticker
     cache'i (60 s TTL) üzerinden saf orchestrator çalıştırılır.
3. Unified deep candidate listesi (≤ 30) core listesiyle **dedupe edilir**
   ve mevcut DYNAMIC akışına dahil edilir (paper-only, TIER_3 politikası).
   Live mode'da unified adaylar da otomatik trade açmaz — mevcut whitelist
   kuralı korunur.
4. Orchestrator hata verirse `getUnifiedCandidates()` **null** döner;
   worker, eski `selectDynamicCandidates` çıktısına **sessizce geri
   düşer**. Tick düşmez, kullanıcıya görünür yan etki yoktur.
5. Manuel İzleme Listesi pasifse veya boşsa `MANUAL_LIST` adayları
   katılmaz (Faz 1 garantisi).

**Trade kararı değişmez:** Pozisyon açma kapısı hâlâ `signal-engine →
risk-engine → SL/TP/R:R → paper-only`. `MIN_SIGNAL_CONFIDENCE=70`,
`HARD_LIVE_TRADING_ALLOWED=false`, `enable_live_trading=false`,
`DEFAULT_TRADING_MODE=paper`, BTC trend filtresi, leverage tavanı, daily
loss limit — hepsi aynen yerinde.

**Binance API yükü artmaz:**
- Worker hiçbir tick'te orchestrator için yeni Binance isteği üretmez.
- Universe çağrısı 6 saatte bir, bulk ticker çağrısı 60 saniyede bir
  olur (zaten Faz 2 / Faz 5 cache'li). Per-symbol kline / order-book
  çağrısı **yoktur**.
- Pool kendi TTL'i dolmadan yeniden hesaplanmaz.

**ScanDetail metadata (display-only):** `sourceDisplay` (GMT/MT/MİL/KRM),
`candidateSources`, `candidateRank`, `marketQualityPreScore`,
`momentumScore`, `candidatePoolGeneratedAt`. Bu alanlar skor hesabına ve
trade kararına müdahale **etmez**; sadece dashboard / `scan_details` /
debug kullanımı içindir.

İlgili dosyalar:
- `src/lib/env.ts` — `useUnifiedCandidatePool`,
  `unifiedDeepAnalysisMax`, `unifiedCandidateRefreshIntervalSec`.
- `src/lib/engines/unified-candidate-provider.ts` — TTL cache + fail-safe
  fallback.
- `src/lib/engines/bot-orchestrator.ts` — flag-gated entegrasyon
  (orchestrator import'u sadece bu çağrı çevresinde kullanılır; flag
  kapalıyken çağrılmaz).
- `worker/.env.example` — yeni env'lerin worker tarafı dökümanı.

Bu faz [BINANCE_API_GUARDRAILS.md](./BINANCE_API_GUARDRAILS.md)
kurallarını **değişmez** kabul eder; ek her tick fetch, per-symbol
kline/order-book spam'i veya merkezi adapter dışı çağrı **yoktur**.

## Paper-Mode Aktivasyonu (Faz 7)

Faz 6'da feature flag ile bağlanan unified candidate pool, Faz 7'de
**varsayılan açık** hale gelir — ancak yalnızca **paper modda** ve canlı
trading kapısı kapalıyken çalışır.

**Aktivasyon koşulları (üçü birden):**
1. `env.hardLiveTradingAllowed === false`
2. `bot_settings.trading_mode === "paper"`
3. `bot_settings.enable_live_trading !== true`

Bu üç koşuldan biri bile bozulursa worker `core-only fallback` moduna
geçer: orchestrator çağrılmaz, unified candidate listesi üretilmez,
mevcut 10 core coin (`tierWhitelist()`) ve legacy `selectDynamicCandidates`
akışı kullanılır. Karar `isUnifiedPoolPaperSafe(settings)` saf
fonksiyonu ile verilir; sebep `last_tick_summary.unifiedProviderError`
alanına `paper-safety: trading_mode=live` gibi etiketle düşer.

**Config değişiklikleri (Faz 7):**

| Ayar | Eski | Yeni |
|---|---|---|
| `env.useUnifiedCandidatePool` default | `false` | `true` |
| `worker/.env.example` `USE_UNIFIED_CANDIDATE_POOL` | `false` | `true` |

**Live trading değişmedi:**
- `HARD_LIVE_TRADING_ALLOWED=false` — değişmez.
- `DEFAULT_TRADING_MODE=paper` — değişmez.
- `enable_live_trading=false` — değişmez (hâlâ `settings/update` API'si
  bunu kabul etmiyor).
- `MIN_SIGNAL_CONFIDENCE=70` — değişmez.
- BTC trend filtresi, SL/TP/R:R, leverage tavanı, daily loss limit,
  worker lock — hepsi değişmedi.

**`last_tick_summary` JSONB yeni alanlar (Faz 7):**

- `unifiedCandidatePoolActive` — bu tick için unified candidate eklendi mi.
- `unifiedPoolSize` — orchestrator pool size (≤ 50).
- `unifiedDeepCandidatesCount` — deep-analysis subset size (≤ 30).
- `unifiedPoolGeneratedAt` — snapshot timestamp.
- `unifiedPoolFromCache` — TTL cache hit / miss.
- `unifiedProviderError` — provider hata mesajı veya safe-gate sebebi
  (`paper-safety: …`); başarılıysa `null`.
- `analyzedSymbolsCount` — bu tick'te derin analiz yapılan toplam sembol.
- `coreSymbolsCount` — analiz batch'indeki core (whitelist) sembol sayısı.
- `unifiedSymbolsCount` — core üstüne unified pool'dan eklenen sembol
  sayısı (dedupe sonrası).

**`scan_details` source metadata:** Faz 6'daki gibi devam eder —
`sourceDisplay` (GMT/MT/MİL/KRM), `candidateSources`, `candidateRank`,
`marketQualityPreScore`, `momentumScore`, `candidatePoolGeneratedAt`.
Bu alanlar trade kararını ve skor hesabını **etkilemez**.

**Binance API yükü (değişmedi):**
- Universe çağrısı 6 saatte bir (Faz 2 cache).
- Bulk ticker çağrısı 60 saniyede bir (Faz 5 cache).
- Unified pool TTL'i 120 saniye — bu süre dolmadan tick'ler in-memory
  cache'ten okur.
- Per-symbol kline / order-book çağrısı **yoktur**.
- [BINANCE_API_GUARDRAILS.md](./BINANCE_API_GUARDRAILS.md) kuralları
  korundu.

**Snapshot endpoint:** `GET /api/candidate-pool/snapshot` salt-okunur
çıktısı (pool size, deep candidate count, source breakdown, generatedAt,
fromCache) Faz 5/6 davranışıyla aynıdır. Bu fazda dashboard'a
sık-polling ekleyen yeni UI **eklenmedi**.

İlgili dosyalar:
- `src/lib/env.ts` — flag default `true`.
- `src/lib/engines/bot-orchestrator.ts` — `isUnifiedPoolPaperSafe()` +
  flag + gate kontrolü, yeni diagnostics alanları.
- `src/lib/engines/unified-candidate-provider.ts` — `lastError` sidecar.
- `worker/.env.example` — `USE_UNIFIED_CANDIDATE_POOL=true` dökümante
  edildi.

## Piyasa Tarayıcı Sadeleştirme (Faz 8)

Piyasa Tarayıcı sayfası bir **dashboard/panel** değil, **coin operasyon
tablosudur**. Bu fazda banner/status kutuları, "Tarama Akışı" ve
"Görünürlük" özet blokları, EVREN/ÖN ELEME/ANALİZ EDİLEN gibi büyük
metrik kutuları ve aktif Tarama Modları özeti **kaldırıldı**. Sayfa
yalnızca canlı coin tablosunu render eder.

**Ürün kuralları (değişmez):**
- Piyasa Tarayıcı **dashboard özeti göstermez**.
- Piyasa Tarayıcı yalnızca coin operasyon tablosudur.
- Aktif Tarama Modları (GMT/MT/MİL aktif/pasif) özeti **sadece**
  `/scan-modes` sayfasında bulunur.
- Kaynaklar ana tabloda kısa etiketle gösterilir:
  `WIDE_MARKET → GMT`, `MOMENTUM → MT`, `MANUAL_LIST → MİL`,
  birden fazla kaynak için `KRM`. Tam kaynak listesi yalnızca
  hover/detay/debug görünümünde tutulur.
- Gelişmiş metrikler **küçük vektörel ikonla** açılır. Yazılı
  "Gelişmiş Seçenekler" butonu yoktur. "Tümünü seç" / "Tümünü kaldır"
  toplu seçim eylemleri yoktur — sadece tek tek metrik kutuları.

**Tablo varsayılan kolonları:**
COIN · KAYNAK · YÖN · KALİTE · FIRSAT · İŞLEM SKORU · EŞİĞE KALAN ·
KARAR · SEBEP. Başlıklar büyük harf, hücreler simetrik hizalı.

**Yön/karar etiketleri:** ana UI'da yalnızca Türkçe etiketler kullanılır
— `LONG ADAY`, `LONG AÇILDI`, `SHORT ADAY`, `SHORT AÇILDI`,
`YÖN BEKLİYOR`, `İŞLEM YOK`, `RİSK REDDİ`, `BTC FİLTRESİ`.
Backend'in döndürdüğü `WAIT` / `NO_TRADE` ham ifadeleri ekrana
yazılmaz; UI mapping yapar.

**Açılan paper pozisyon satırları** aday satırlarından görsel olarak
ayrılır (bold + hafif background tint).

**Trading invariant'leri (bu fazda dokunulmadı):**
- `HARD_LIVE_TRADING_ALLOWED=false`
- `DEFAULT_TRADING_MODE=paper`
- `enable_live_trading=false`
- `MIN_SIGNAL_CONFIDENCE=70` (signal-engine `if (score < 70)` kapısı)
- BTC trend filtresi
- SL/TP/R:R kontrolleri
- Risk engine, kaldıraç sistemi, worker lock
- Unified candidate provider mantığı
- Binance API çağrı modeli (yeni fetch eklenmedi —
  [BINANCE_API_GUARDRAILS.md](./BINANCE_API_GUARDRAILS.md) korundu)

İlgili dosyalar:
- `src/app/scanner/page.tsx` — yeniden yazıldı; sade tablo + ikon
  picker.
- `src/lib/engines/bot-orchestrator.ts` — `ScanIndicators`'a sadece
  RSI ve MACD histogramı **observation alanı** eklendi (zaten
  features içinde hesaplanıyordu; trade kararını etkilemez).
- `src/__tests__/scanner-ui-phase8.test.ts` — yeni test paketi.

## Dashboard / Panel Kart Mimarisi (Faz 9)

Dashboard ana sayfası **kart bazlıdır**. Düz yazı / defter / uzun
rapor formatı kullanılmaz. Bilgiler kompakt kutular, gauge/bar,
tablo-kart ve kısa özet metinler ile sunulur.

**Sayfa rolleri (değişmez):**
- **Dashboard** (`/`) — özet ve karar destek kartlarını gösterir.
- **Piyasa Tarayıcı** (`/scanner`) — yalnızca coin operasyon
  tablosudur (Faz 8). Dashboard kartı eklenmez.
- **Tarama Modları** (`/scan-modes`) — yalnızca aktif/pasif kontrolü.
  Dashboard kartı eklenmez.

**Bot Durumu kartı dili (ürün kuralı):**
Ana Bot Durumu kartı **operasyonel** dil kullanır. Bu kartta
`MOD: SANAL`, `PAPER MODE`, `YAKINDA CANLI`, `SANAL İŞLEM MODU`
ifadeleri **gösterilmez**. Bunun yerine `BOT: ÇALIŞIYOR / DURDU`,
`BORSA: BINANCE FUTURES`, `PİYASA VERİSİ: CANLI`,
`SUNUCU: ÇEVRİMİÇİ / ÇEVRİMDIŞI`, `SON GÜNCELLEME` ve `ACİL DURDUR`
unsurları yer alır. Mod / paper-validation bilgisi ayrı
**Paper İşlem Doğrulaması** kartında gösterilir.

**Karar destek kartları:**
- **Piyasa Nabzı** — `RİSK İŞTAHI`, `FOMO DÜZEYİ`, `PİYASA RİSKİ`
  yüzde + bar olarak; kısa Türkçe yorum (örn. "Piyasa seçici
  şekilde güçlü; FOMO riski artıyor."). Trade kararını
  **etkilemez**, observation-only.
- **Fırsat Radarı** — `GÜÇLÜ FIRSAT`, `EŞİĞE YAKIN`, `YÖN BEKLEYEN`,
  `RİSKTEN ELENEN` sayımları + zarif radar sweep. Animasyon hafif
  ve performans dostudur.
- **Pozisyon Karar Merkezi** — Faz 8 ile bire bir aynı kolon seti:
  `COIN · KAYNAK · YÖN · KALİTE · FIRSAT · İŞLEM SKORU · KARAR ·
  SEBEP`. Tüm başlıklar büyük harf. Kaynak kısa: `GMT/MT/MİL/KRM`.
  WAIT/NO_TRADE ham etiketleri ana UI'da görünmez.
- **Pozisyona En Yakın Coinler** — en fazla 5 coin, sıralama
  `tradeSignalScore` desc → `setupScore` desc. Her satır
  yön etiketi, `İŞLEM/70`, `EŞİĞE Np` farkı ve "Eksik:"
  metnini içerir. Güçlü aday yoksa "Bu periyotta güçlü fırsat yok."
- **Açık Pozisyonlar** — paper açık satırlar **bold + bg-success/5**
  ile aday satırlardan ayrışır.
- **En Çok Engelleyen Sebepler** — son tick'in reject sebepleri
  `BTC FİLTRESİ`, `HACİM ZAYIF`, `MACD UYUMSUZ`, `R:R GEÇERSİZ`
  gibi sınıflara indirgenir; veri yoksa "Yeterli karar verisi
  oluşmadı."
- **Bugünkü Özet** — kompakt 6 kutu (analiz / aday havuzu /
  eşiğe yakın / açılan / kapanan / toplam PnL).
- **Paper İşlem Doğrulaması** — henüz paper trade açılmamışsa
  kırmızı hata değil **gri "BEKLENİYOR"** durumu gösterir;
  `first_trade_opened` ham hatası kullanıcıya kırmızı yansıtılmaz.

**Aksiyon kart altyapısı (`ActionFooter`):**
- Sadece **aksiyon gerektiren** kartlarda manuel olarak monte
  edilir; her kartın altında otomatik görünmez.
- Butonlar: `ONAYLA`, `REDDET`, `GÖZLEM` (≈1 hafta), `PROMPT`
  (gelecekte Claude Code / Codex talimatı üretmek için).
- Bu fazda hiçbir kritik ayar değiştirilmez; component sadece
  parent'a `onAction(kind, actionId)` callback'i iletir.
- ActionFooter doğrudan trade engine, risk engine veya canlı
  trading gate fonksiyonu çağırmaz.

**Veri kaynağı:**
- `/api/bot/status`, `/api/bot/heartbeat`, `/api/bot/diagnostics`,
  `/api/paper-trades*`, `/api/system/env-check`. Hiçbiri yeni
  Binance API çağrısı eklemez; mevcut DB/diagnostics okunur.
- [BINANCE_API_GUARDRAILS.md](./BINANCE_API_GUARDRAILS.md) korundu.

**Trading invariant'leri (bu fazda dokunulmadı):**
- `HARD_LIVE_TRADING_ALLOWED=false`
- `DEFAULT_TRADING_MODE=paper`
- `enable_live_trading=false`
- `MIN_SIGNAL_CONFIDENCE=70`
- BTC trend filtresi, SL/TP/R:R, risk engine, kaldıraç, worker lock
- Unified candidate provider mantığı

İlgili dosyalar:
- `src/lib/dashboard/labels.ts` — ortak yön/karar/kaynak mapping +
  threshold sabit (paylaşımlı saf yardımcılar).
- `src/lib/dashboard/market-pulse.ts` — Piyasa Nabzı hesabı.
- `src/lib/dashboard/opportunity-radar.ts` — radar sayımları.
- `src/lib/dashboard/blocking-reasons.ts` — engelleyici sebepler
  aggregator'ı.
- `src/components/dashboard/Cards.tsx` — kart bileşenleri.
- `src/components/dashboard/ActionFooter.tsx` — aksiyon altyapısı.
- `src/app/page.tsx` — yeni grid'li kart kompozisyonu.
- `src/__tests__/dashboard-phase9.test.ts` — 48 test.

## Risk Yönetimi ve Güvenli Config Altyapısı (Faz 10)

Risk Yönetimi sayfası **canlı mimariye uygun** bir config altyapısıdır;
**paper mode güvenli test katmanıdır**. Bu fazda risk ayarları
**execution path'ine bağlanmaz** — `appliedToTradeEngine` daima
`false`'dur. Trade engine, signal engine, risk engine execution
ve canlı trading gate davranışı bu sayfadan etkilenmez.

**Profiller:**
- `LOW` (DÜŞÜK) — küçük pozisyon, az işlem (%2 / %6 / 2 / 3 / 6).
- `STANDARD` (STANDART) — varsayılan; küçük sermaye için kontrollü
  agresif (%3 / %10 / 3 / 5 / 10).
- `AGGRESSIVE` (AGRESİF) — daha çok pozisyon (%5 / %15 / 4 / 6 / 15).
- `CUSTOM` (ÖZEL) — kullanıcı tüm alanları elle ayarlar; tek profil
  30x'e izin verir.

Varsayılan aktif profil: **STANDART**.

**Kaldıraç teknik field kodları:**
| Bucket | Min | Max |
|---|---|---|
| Core Coin | `CCMNKL` | `CCMXKL` |
| Genel Market | `GNMRMNKL` | `GNMRMXKL` |
| Manuel Liste | `MNLSTMNKL` | `MNLSTMXKL` |

Varsayılan: `CC 3-20`, `GNMR 10-20`, `MNLST 10-20`. Maks tavan
`30x`; varsayılan üst limit `20x`. **30x yalnızca ÖZEL profilde**
kabul edilir ve seçilirse **kırmızı kritik uyarı** üretilir. 30x
seçilse bile bu fazda trade engine'e uygulanmaz.

**Stop-loss modu:** UI seçimleri `SİSTEM BELİRLESİN / SIKI / STANDART
/ GENİŞ`. Varsayılan `SİSTEM BELİRLESİN` — bot stop seviyesini kendi
kuralına göre koymaya devam eder; bu fazda signal/risk engine'e
bağlanmaz.

**Kademeli yönetim:**
- `Kârda Kademeli Yönetim`: aktif/pasif (UI/config).
- `Zararda Pozisyon Artırma`: **DAİMA kapalı**, UI'da `KİLİTLİ`
  rozetiyle gösterilir, type sisteminde `averageDownEnabled: false`
  literal'i ile sabittir, store + zod schema seviyesinde reddedilir.
  Bu kural değişmez.

**Kırmızı risk uyarı eşikleri** (UI + `computeWarnings`):
- İşlem başı risk > %3 → `RISK_PER_TRADE_HIGH`
- Günlük max zarar > %10 → `MAX_DAILY_LOSS_HIGH`
- Dinamik üst sınır > 5 → `DYNAMIC_CAP_HIGH`
- Max günlük işlem > 10 → `MAX_DAILY_TRADES_HIGH`
- Herhangi bir bucket max > 20 → `LEVERAGE_MAX_HIGH`
- Herhangi bir bucket max ≥ 30 → `LEVERAGE_MAX_CRITICAL`
- Zararda pozisyon büyütme açma denemesi → `AVERAGE_DOWN_BLOCKED`

**Validation kuralları (server + store):**
- Min kaldıraç max kaldıraçtan büyük olamaz.
- Kaldıraç 1-30 aralığında olmalı.
- Risk yüzdeleri negatif olamaz; günlük max zarar 0'dan büyük olmalı.
- Dinamik üst sınır varsayılan açık pozisyondan düşük olamaz.
- Max günlük işlem ≥ 1.
- Toplam sermaye ≥ 0.
- 30x sadece ÖZEL profilde.
- `averageDownEnabled = true` her zaman reddedilir.
- `appliedToTradeEngine !== false` reddedilir.

**API:**
- `GET /api/risk-settings` → `{ settings, warnings }`.
- `PUT /api/risk-settings` → patch-style; validation hatasında
  `400 + errors[]`.
- Endpoint hiçbir Binance API çağrısı yapmaz.

**Trading invariant'leri (bu fazda değişmedi):**
- `HARD_LIVE_TRADING_ALLOWED=false`
- `DEFAULT_TRADING_MODE=paper`
- `enable_live_trading=false`
- `MIN_SIGNAL_CONFIDENCE=70` (signal-engine `if (score < 70)` kapısı)
- BTC trend filtresi, SL/TP/R:R, risk engine, kaldıraç execution,
  worker lock, unified candidate provider mantığı
- [BINANCE_API_GUARDRAILS.md](./BINANCE_API_GUARDRAILS.md) korundu —
  yeni Binance fetch/axios eklenmedi.

İlgili dosyalar:
- `src/lib/risk-settings/types.ts` — profil/policy/defaults/types.
- `src/lib/risk-settings/validation.ts` — `validateRiskSettings`,
  `computeWarnings`, `isExtremeLeverageAllowed`.
- `src/lib/risk-settings/store.ts` — in-memory store + patch.
- `src/app/api/risk-settings/route.ts` — GET + PUT.
- `src/app/risk/page.tsx` — kart bazlı UI (6 grup).
- `src/components/Sidebar.tsx` — etiket "Risk Ayarları" → "Risk
  Yönetimi".
- `src/__tests__/risk-settings-phase10.test.ts` — 49 test.

## Opportunity Priority Score / Fırsat Önceliklendirme (Faz 11)

Bot birden fazla fırsat gördüğünde rastgele veya yalnızca tarama
sırasına göre seçim yapmasın diye **Opportunity Priority Score**
altyapısı kuruldu. Bu altyapı **trade açma kararını DEĞİŞTİRMEZ** —
yalnızca metadata/sıralama/queue üretir.

**Kurallar (değişmez):**
- Trade açma eşiği `tradeSignalScore >= 70` korunur.
- Opportunity Priority Score yalnızca **sıralama / queue / metadata**
  içindir. Trade-açma kapısı değildir.
- Birden fazla güçlü fırsat varsa kalanlar **çöpe atılmaz**;
  `WATCH_QUEUE` ile izleme listesinde tutulur.

**Skor bileşenleri (toplam 1.0 ağırlık):**
- `tradeSignal` 0.30 — `tradeSignalScore` (≥70 = 100, 50-69 = 60-100,
  altı = orantılı)
- `setup` 0.18 — `setupScore` yapı kalitesi
- `quality` 0.12 — `marketQualityScore` (yoksa `preScore`)
- `riskReward` 0.07 — R:R (1:3+ = 100, 1:2 = 80, <1.5 penalty)
- `liquidity` 0.08 — spread + depth + 24h hacim ortalaması
- `btcAlignment` 0.07 — uyumlu = 100, veto = 0, bilinmiyor = 50
- `volatility` 0.05 — ATR percentile + volume impulse sağlığı
- `source` 0.07 — KRM 95 / MİL 90 / MT 75 / GMT 60
- `momentumUrgency` 0.06 — volumeImpulse + MT bonusu
- `correlationPenalty` — alan hazır, bu fazda 0 (gelecek faz)

**Bucket sınıflandırma (default config):**
| Sıra | Skor | Bucket |
|---|---|---|
| 1-3 | ≥60 | `PRIMARY` |
| 1-5 | ≥50 | `WATCH_QUEUE` |
| diğer | — | `REJECTED_OR_WEAK` |

Hard penalty (sırasız): BTC veto, risk reddi, ya da `tradeSignal=0 ve
setup=0` → otomatik `REJECTED_OR_WEAK`.

Default config (`DEFAULT_PRIORITY_BUCKET_CONFIG`):
`primaryCapacity=3, dynamicUpperCapacity=5, minPrimaryScore=60,
minWatchScore=50`. Bu değerler **yalnızca priority preview** içindir;
trade açma davranışını değiştirmez.

**Sıralama (deterministic tiebreaker zinciri):**
1. `opportunityPriorityScore` desc
2. `tradeSignalScore` desc
3. `setupScore` desc
4. `marketQualityScore` desc
5. `quoteVolume24h` desc
6. `symbol` asc

**Reasons / Penalties örnekleri:**
- ✓ "İşlem skoru güçlü (≥70)"
- ✓ "Fırsat yapısı çok güçlü"
- ✓ "Likidite sağlıklı"
- ✓ "MT momentum desteği var"
- ✓ "KRM çoklu kaynak teyidi var"
- ✓ "BTC yönü uyumlu"
- ✓ "MİL kaynak önceliği (manuel izleme)"
- ✗ "BTC yön uyumsuzluğu"
- ✗ "Spread yüksek"
- ✗ "R:R zayıf"
- ✗ "Volatilite sağlıksız"
- ✗ "Likidite zayıf"
- ✗ "Sinyal eşiğe uzak"
- ✗ "Risk reddi"

**Decoupling (test ile garantili):**
- `opportunity-priority/*` modülleri `signal-engine`,
  `bot-orchestrator`, `risk-engine` import etmez.
- `bot-orchestrator` `opportunity-priority` modülünü import etmez.
- `risk-settings` store opportunity-priority import etmez.
- Hiçbir Binance API çağrısı eklenmedi (no fapi/api/axios import).

**Pozisyona En Yakın Coinler kartı**: ana sıralaması bu fazda
**değiştirilmedi** — `tradeSignalScore desc → setupScore desc`
korunur. Opportunity Priority ayrı metadata olarak kalır; ana
sıralamayı değiştirmek gerekirse ayrı faza bırakılır.

**Korelasyon riski**: alan ayrıldı (`correlationPenalty`), bu fazda
hesap yok. Gelecekte ağır olmayan in-memory saldırı vektörü ile
çalıştırılacak — Binance API çağrısı eklenmeyecektir.

**Trading invariant'leri (bu fazda dokunulmadı):**
- `HARD_LIVE_TRADING_ALLOWED=false`
- `DEFAULT_TRADING_MODE=paper`
- `enable_live_trading=false`
- `MIN_SIGNAL_CONFIDENCE=70` (signal-engine `if (score < 70)` kapısı)
- BTC trend filtresi, SL/TP/R:R, risk engine, kaldıraç execution,
  worker lock, unified candidate provider mantığı, Risk Yönetimi
  ayarlarının execution'a bağlanmaması

İlgili dosyalar:
- `src/lib/opportunity-priority/types.ts` — `OpportunityInput`,
  `OpportunityPriorityResult`, `PriorityComponents`,
  `PriorityWeights`, `PriorityBucketConfig` + defaultlar.
- `src/lib/opportunity-priority/score.ts` —
  `computeOpportunityPriorityScore`, `computeBatch`. 9 alt skor
  fonksiyonu, NaN-safe.
- `src/lib/opportunity-priority/rank.ts` — `rankOpportunities`,
  `classifyOpportunityBucket`. Deterministic tiebreaker.
- `src/lib/opportunity-priority/index.ts` — barrel.
- `src/__tests__/opportunity-priority-phase11.test.ts` — 39 test.

UI entegrasyonu bu fazda yalnızca lib seviyesinde; worker tick payload'ı
priority metadata üretmeye başlayınca dashboard/scanner küçük badge ile
besleyecek (ayrı faz).

## WAIT / Direction Candidate Açıklanabilirliği (Faz 12)

Botun neden WAIT / İŞLEM YOK kaldığını kullanıcıya net açıklayan
**direction explainability** modülü ayrı bir lib altına taşındı:
`src/lib/direction-explainability/`. "Trend/momentum belirsiz" gibi
tek başına yetersiz mesajlar yerine, kullanıcı coin'in hangi yöne
yakın olduğunu ve hangi şartların eksik olduğunu doğrudan görür.

**Üretilen alanlar (display/debug only):**
- `longSetupScore` — 0–100 LONG hipotez gücü
- `shortSetupScore` — 0–100 SHORT hipotez gücü
- `directionCandidate` — `LONG_CANDIDATE | SHORT_CANDIDATE | MIXED | NONE`
- `directionConfidence` — 0–100 normalize edilmiş lead farkı
- `waitReasonCodes` — sabit kelime dağarcığı: `EMA_ALIGNMENT_MISSING`,
  `MA_FAST_SLOW_CONFLICT`, `MACD_CONFLICT`, `RSI_NEUTRAL`, `ADX_FLAT`,
  `VWAP_NOT_CONFIRMED`, `VOLUME_WEAK`, `BOLLINGER_NO_CONFIRMATION`,
  `ATR_REGIME_UNCLEAR`, `BTC_DIRECTION_CONFLICT`
- `waitReasonSummary` — en fazla 2–3 sebepli kısa Türkçe özet

**Türkçe sebep mapping** (`WAIT_REASON_TR`):
`EMA dizilimi eksik` · `hızlı/yavaş ortalama uyumsuz` · `MACD uyumsuz` ·
`RSI nötr` · `trend gücü zayıf` · `VWAP teyidi yok` · `hacim zayıf` ·
`Bollinger teyidi yok` · `volatilite rejimi belirsiz` · `BTC yönü ters`.

**Özet örnekleri:**
- `"LONG adayı ama EMA dizilimi eksik, hacim zayıf"`
- `"SHORT adayı ama BTC yönü ters"`
- `"Yön karışık: MACD uyumsuz, RSI nötr"`
- `"Yön net değil: RSI nötr, trend gücü zayıf"`
- `"Yön teyidi bekleniyor"` (hiç sebep yoksa)

**Kesin invariantlar:**
- `directionCandidate` **gerçek `signalType` (LONG/SHORT) yerine geçmez**.
- `longSetupScore` / `shortSetupScore` **`tradeSignalScore` yerine geçmez**.
- Trade açma kapısı hâlâ aynıdır:
  `signalType=LONG/SHORT` + `tradeSignalScore >= 70` + BTC trend filter +
  risk gate + SL/TP + R:R + paper mode.
- "Trend/momentum belirsiz" fallback'ı tek başına ana sebep olarak
  gösterilmez: `waitReasonCodes` doluysa onlardan üretilen kısa özet
  kullanılır, yalnızca hiç sebep yoksa güvenli fallback metni döner.
- Dashboard / Piyasa Tarayıcı `WAIT` / `NO_TRADE` ham etiketlerini
  ana UI'da göstermez (Faz 8/9 ürün kuralı korunur).

**UI mapping (değişmez):**
- Açılan LONG/SHORT işlem → `LONG AÇILDI` / `SHORT AÇILDI`
- `directionCandidate=LONG_CANDIDATE` ve işlem yok → `LONG ADAY`
- `directionCandidate=SHORT_CANDIDATE` ve işlem yok → `SHORT ADAY`
- `directionCandidate=NONE` veya `MIXED` → `YÖN BEKLİYOR`
- BTC veto → `BTC FİLTRESİ`
- Risk reddi → `RİSK REDDİ`
- `signalType=NO_TRADE` → `İŞLEM YOK`

**Trading invariant'leri (bu fazda dokunulmadı):**
- `HARD_LIVE_TRADING_ALLOWED=false`
- `DEFAULT_TRADING_MODE=paper`
- `enable_live_trading=false`
- `MIN_SIGNAL_CONFIDENCE=70`
- BTC trend filtresi, SL/TP/R:R, risk engine, kaldıraç execution,
  worker lock, unified candidate provider mantığı, Risk Yönetimi
  ayarlarının execution'a bağlanmaması, Opportunity Priority'nin
  trade engine'e bağlanmaması.
- [BINANCE_API_GUARDRAILS.md](./BINANCE_API_GUARDRAILS.md) korundu —
  yeni Binance fetch/axios eklenmedi.

İlgili dosyalar:
- `src/lib/direction-explainability/types.ts` — kanonik tipler.
- `src/lib/direction-explainability/score-direction.ts` — 0–100
  long/short skor + `directionCandidate` üretimi.
- `src/lib/direction-explainability/wait-reasons.ts` — sebep kodu
  üretimi + sabit vocab.
- `src/lib/direction-explainability/summary.ts` — Türkçe etiket
  mapping + kısa özet.
- `src/lib/direction-explainability/index.ts` — barrel +
  `computeDirectionExplainability`.
- `src/lib/engines/signal-engine.ts` — eski inline implementasyon
  kaldırıldı; tek modüle delege ediyor. `SignalResult` yeni
  `waitReasonSummary` alanı içerir.
- `src/lib/engines/bot-orchestrator.ts` — `ScanDetail` üzerinden
  `waitReasonSummary` UI'ya akıyor.
- `src/lib/dashboard/labels.ts` ve `src/app/scanner/page.tsx` —
  `buildReasonText` artık `waitReasonSummary` varsa onu öncelikli
  gösterir.
- `src/__tests__/direction-explainability-module.test.ts` —
  modül seviyesi birim testler.

## Trade Performans Karar Motoru (Faz 13)

CoinBot'un işlemlerini, kaçan fırsatlarını ve skor bandlarını analiz edip
yorumlayan **karar destek motoru** Faz 13'te kuruldu. Sistem sadece
"işlem açıldı/açılmadı" demez; neden açıldığını, neden kaybettiğini,
hangi ayarın zarar ettirebileceğini ve hangi alanın gözlem gerektirdiğini
yorumlar.

### Paper-only DEĞİL — paper/live ortak motor

Faz 13 mimari kuralı: **Paper ve live için ayrı performans/karar motoru
kurulmaz.** Tek `trade-performance` modülü, paper ve live işlemleri
**ortak `NormalizedTrade` modeli** üzerinden işler.

| Alan | Anlam |
|---|---|
| `tradeMode` | `"paper"` veya `"live"` — bot moduna karşılık gelir. |
| `executionType` | `"simulated"` veya `"real"` — emir tipini ayırır. |

Şu an veri kaynağı sadece `paper_trades` tablosudur (`paperTradeRowToNormalizedTrade`
adaptörü ile NormalizedTrade'e çevrilir). Canlıya geçince ileride
`live_trades` tablosu için ayrı bir adaptör eklenecek; **motor yeniden
yazılmayacak**, UI sözleşmesi değişmeyecek.

### Modül kapsamı

`src/lib/trade-performance/` — saf fonksiyonlar; external I/O yok.

- `types.ts` — `NormalizedTrade`, `TradeMode`, `ExecutionType`,
  `ScanRowInput`, tüm rapor tipleri + `paperTradeRowToNormalizedTrade`
  adaptörü.
- `score-bands.ts` — skor bandı analizi (50–59, 60–64, 65–69, 70–74,
  75–84, 85+). Her band için sinyal sayısı, açılan/açılmayan, TP/SL,
  ortalama PnL%, ortalama R:R, en sık bloklayan sebep ve kısa Türkçe
  yorum. `modeFilter` ile paper/live ayrımı yapılabilir.
- `shadow-threshold.ts` — 60/65/70/75 eşikleri için hipotetik trade
  sayımı + tahmini kalite/risk skoru + öneri. `liveThreshold` daima
  70'tir; `liveThresholdUnchanged` daima `true` döner.
- `missed-opportunities.ts` — `BAND_60_69_NEAR_TP`,
  `BTC_FILTER_REJECTED`, `RISK_GATE_REJECTED`, `DIRECTION_UNCONFIRMED`
  sebepleri. Veri yokken `insufficientData=true` ile güvenli fallback.
  Future-price backtest YAPILMAZ; mevcut scan_details verisi üzerinden
  çalışır.
- `trade-review.ts` — kapanan her işlem için `NORMAL_TRADE | GOOD_WIN |
  ACCEPTABLE_LOSS | POSSIBLE_EARLY_STOP | POSSIBLE_BAD_ENTRY |
  POSSIBLE_BAD_RR | POSSIBLE_RISK_TOO_HIGH | POSSIBLE_EXIT_TOO_EARLY |
  DATA_INSUFFICIENT` etiketi. Stop-loss kalitesi için ayrı
  `reviewStopLossQuality()` fonksiyonu (`NORMAL_STOP |
  EARLY_STOP_SUSPECT | SL_TOO_TIGHT | RR_WEAK | DATA_INSUFFICIENT`).
- `risk-advisory.ts` — risk yüzdesi, günlük max zarar, açık pozisyon
  ve günlük işlem sınırları için **yorum** üretir. Hiçbir Risk Yönetimi
  ayarı **DEĞİŞTİRİLMEZ** — `RiskAdvisoryItem` sadece `code + comment`
  döner.
- `decision-summary.ts` — üst seviye karar:
  - `status`: `HEALTHY | WATCH | ATTENTION_NEEDED | DATA_INSUFFICIENT`
  - `actionType`: `NO_ACTION | OBSERVE | REVIEW_THRESHOLD |
    REVIEW_STOP_LOSS | REVIEW_RISK_SETTINGS | REVIEW_POSITION_LIMITS |
    REVIEW_SIGNAL_QUALITY | DATA_INSUFFICIENT`
  - `confidence`: 0–100
  - `requiresUserApproval`: ATTENTION_NEEDED / REVIEW_* için `true`
  - `observeDays`: OBSERVE için varsayılan `7`
  - `appliedToTradeEngine`: **daima `false`**
  - `tradeMode`: paper veya live (UI rozeti)

### Read-only API endpoint

`GET /api/trade-performance/decision-summary` — opsiyonel `?mode=paper|live`.

- Yalnızca `paper_trades` ve `bot_settings.last_tick_summary` okur.
- **Yeni Binance API çağrısı YAPMAZ.**
- Trade engine, signal engine, risk engine veya canlı trading gate'i
  tetiklemez; salt-okunur.
- Veri yetersizse `decision.actionType=DATA_INSUFFICIENT` ile güvenli
  fallback döner ("Yeterli paper veri oluşmadı. Gözlem devam ediyor.").
- Live veri kaynağı henüz yok — `meta.liveTradeSourceAvailable=false`.

### Dashboard kartı — Performans Karar Özeti

`PerformanceDecisionCard` kartı:
- Mini bölümler: **MEVCUT DURUM**, **ANA BULGU**, **SİSTEM YORUMU**,
  **ÖNERİ**, **AKSİYON DURUMU**, **UYGULAMA**.
- Başlığı sabit: "PERFORMANS KARAR ÖZETİ" — paper'a dar bir isim
  kullanılmaz; canlıya geçişte aynı kart live verisini de gösterir.
- `MOD: PAPER / CANLI` rozeti.
- `actionType ≠ NO_ACTION/DATA_INSUFFICIENT` ise altında ONAYLA /
  REDDET / GÖZLEM / PROMPT butonları görünür. **Bu butonlar gerçek
  ayar değişikliğine bağlı DEĞİLDİR**; yalnızca callback üretir.

### Mutlak invariantlar (bu fazda dokunulmadı)

- `HARD_LIVE_TRADING_ALLOWED=false`
- `DEFAULT_TRADING_MODE=paper`
- `enable_live_trading=false`
- `MIN_SIGNAL_CONFIDENCE=70` — `liveThreshold=70` sabiti shadow analize
  hardcoded olarak yansır.
- BTC trend filtresi, SL/TP/R:R, risk engine execution, kaldıraç
  execution, worker lock, unified candidate provider mantığı,
  Risk Yönetimi ayarlarının execution'a bağlanmaması, Opportunity
  Priority'nin trade engine'e bağlanmaması.
- [BINANCE_API_GUARDRAILS.md](./BINANCE_API_GUARDRAILS.md) korundu —
  yeni Binance fetch/axios eklenmedi.

### Yasaklar (Faz 13 ürün kuralı)

- Trade logic değiştirme.
- `tradeSignalScore` eşiğini değiştirme.
- `MIN_SIGNAL_CONFIDENCE` değiştirme.
- Stop-loss kuralını otomatik değiştirme — yalnızca yorumla.
- Risk Settings'i execution'a bağlama.
- Opportunity Priority'yi trade engine'e bağlama.
- Kaldıraç execution ekleme.
- Canlı trading gate açma.
- Binance API çağrısı ekleme.
- Worker lock değiştirme.
- ActionFooter butonlarını gerçek ayar değişikliğine bağlama.
- Dashboard'u düz yazı rapor ekranına çevirme.

İlgili dosyalar:
- `src/lib/trade-performance/` — modül (7 dosya).
- `src/app/api/trade-performance/decision-summary/route.ts` — read-only
  endpoint.
- `src/components/dashboard/Cards.tsx` — `PerformanceDecisionCard` +
  `MiniSection` helper.
- `src/app/page.tsx` — kart KPI satırının üstüne yerleştirildi.
- `src/__tests__/trade-performance-phase13.test.ts` — 34 test.

## Mode-Safe Refactor / Paper-Live Kilidini Kaldırma (Faz 14)

Faz 13.5 audit sonucunda tespit edilen paper/live mimari uyumsuzluğu
düzeltildi. **Bu faz canlı trading açmaz; gerçek emir gönderimi,
live execution adapter, live_trades tablosu veya Binance private
order çağrısı eklenmedi.**

### Ana mimari kural (değişmez)

Paper ve live için ayrı iş mantığı kurulmaz. Tek aday havuz, tek
signal engine, tek risk lifecycle, tek SL/TP/R:R, tek performans
analiz modeli. Paper/live farkı yalnızca execution adapter,
tradeMode, executionType ve live safety gate seviyesindedir.

### Değişiklikler

**`canUseUnifiedCandidatePoolForMode()` — yeni mode-safe helper:**

| Mod | Sonuç |
|---|---|
| `trading_mode="paper"` | `allowed=true, executionMode="simulated"` |
| `trading_mode="live"` + triple gate açık | `allowed=true, executionMode="real"` |
| `trading_mode="live"` + triple gate kapalı | `allowed=false, executionMode="live_gate_closed"` |

Önceki `isUnifiedPoolPaperSafe()`:
- `trading_mode="live"` → `safe=false, reason="trading_mode=live"` (paper-locked)

Yeni `canUseUnifiedCandidatePoolForMode()`:
- `trading_mode="live"` + gate kapalı → `allowed=false, reason="live_execution_gate_blocked: ..."` (execution-gated)
- `trading_mode="live"` + gate açık → `allowed=true` (mode-independent pool)

**Ayrım:**
- `isUnifiedPoolPaperSafe()` deprecated wrapper olarak korundu (geriye uyumluluk).
- Tüm iç kullanım `poolModeCheck` değişkeni ile yeni helper'a geçirildi.

**`last_tick_summary` yeni alanlar (Faz 14):**

| Alan | Anlam |
|---|---|
| `unifiedCandidatePoolModeAllowed` | Bu tick için pool mode gate izni |
| `unifiedCandidatePoolBlockedReason` | Gate kapalıysa sebep; açıksa null |
| `tradeMode` | `"paper"` veya `"live"` — bu tick'in trade modu |
| `executionMode` | `"simulated"` / `"real"` / `"live_gate_closed"` |

### Candidate selection vs execution safety ayrımı

- **Candidate pool (aday havuzu):** mode-independent, `canUseUnifiedCandidatePoolForMode()` ile kontrol edilir.
- **Execution (emir gönderimi):** `live-trading-guard.ts → tripleGate()` ile kontrol edilir.
- Bu iki katman birbirinden bağımsızdır; aday havuzu paper'a kilitli değildir.

### Bu fazda dokunulmadı

- Canlı trading açılmadı.
- `HARD_LIVE_TRADING_ALLOWED=false` korundu.
- `DEFAULT_TRADING_MODE=paper` korundu.
- `enable_live_trading=false` korundu.
- `MIN_SIGNAL_CONFIDENCE=70` korundu.
- `openLiveOrder` / `closeLiveOrder` yazılmadı.
- `live_trades` tablosu / migration eklenmedi.
- Binance private/order endpoint çağrısı eklenmedi.
- Risk settings execution'a bağlanmadı.
- Trade/signal/risk engine değiştirilmedi.
- Worker lock mekanizması bozulmadı.
- [BINANCE_API_GUARDRAILS.md](./BINANCE_API_GUARDRAILS.md) korundu.

İlgili dosyalar:
- `src/lib/engines/bot-orchestrator.ts` — `canUseUnifiedCandidatePoolForMode`,
  `UnifiedPoolModeCheck` interface, `isUnifiedPoolPaperSafe` deprecated alias,
  `tickBot` mode-safe refactor, yeni `last_tick_summary` alanları.
- `src/__tests__/unified-paper-rollout.test.ts` — güncellendi (yeni helper adı).
- `src/__tests__/mode-safe-refactor-phase14.test.ts` — yeni Faz 14 test paketi.

## Live Trades Analiz Altyapısı (Faz 15)

Canlıya geçiş için veri/analiz altyapısı hazırlandı. **Bu fazda gerçek canlı
emir gönderimi yoktur.** `live_trades` tablosu ve adaptörü, Trade Performance
Engine'in paper/live ortak çalışma mimarisini tamamlar.

### Ana mimari kural (değişmez)

Paper ve live için **ayrı performans/karar motoru kurulmaz.** Tek
`trade-performance` modülü, paper ve live işlemleri ortak `NormalizedTrade`
modeli üzerinden işler. Paper/live farkı yalnızca `tradeMode`, `executionType`,
data adapter ve live safety gate seviyesindedir.

### live_trades şeması

`supabase/migrations/0009_live_trades.sql` — analiz altyapısı tablosu.

| Alan grubu | Alanlar |
|---|---|
| Kimlik | `id`, `user_id` |
| Sembol / yön | `symbol`, `side` (LONG\|SHORT) |
| Durum | `status` (open\|closed\|cancelled\|error) |
| Fiyat | `entry_price`, `exit_price`, `quantity`, `leverage`, `stop_loss`, `take_profit` |
| PnL | `pnl`, `pnl_percent` |
| Zaman | `opened_at`, `closed_at`, `created_at`, `updated_at` |
| Sebep | `close_reason`, `entry_reason`, `exit_reason` |
| Skor | `trade_signal_score`, `setup_score`, `market_quality_score`, `source_display` |
| Risk/oran | `rr_ratio`, `stop_distance_percent` |
| Emir ID (audit) | `order_id`, `client_order_id`, `position_id` |
| Meta | `exchange`, `execution_type` (real), `trade_mode` (live) |
| Payload (log) | `raw_entry_payload`, `raw_exit_payload` |

`execution_type` default `real`, `trade_mode` default `live`.
Bu tablo **canlı emir açmaz/kapatmaz**; yalnızca analiz/görüntüleme içindir.

### liveTradeRowToNormalizedTrade adaptörü

`src/lib/trade-performance/types.ts` içinde yeni fonksiyon.

- `tradeMode: "live"`, `executionType: "real"` döndürür.
- `side` → `direction` eşlemesi (LONG/SHORT).
- `trade_signal_score` → `signalScore`, `rr_ratio` → `riskRewardRatio`.
- `close_reason` öncelikli; null ise `exit_reason`'a fallback.
- `status` `cancelled`/`error` → `"closed"` güvenli fallback.
- `entry_price` null → `0`; NaN/undefined üretmez.
- `paperTradeRowToNormalizedTrade` davranışı bozulmaz.

### /api/trade-performance/decision-summary — mode parametresi

`GET /api/trade-performance/decision-summary?mode=paper|live|all`

| mode | Davranış |
|---|---|
| `paper` | Yalnızca `paper_trades` okur. Default. |
| `live` | Yalnızca `live_trades` okur. Veri yoksa güvenli fallback döner. |
| `all` | paper_trades + live_trades birleşik analiz. |

- `mode=live` veri yokken hata fırlatmaz: `"Canlı işlem verisi oluşmadı."` döner.
- `meta.liveTradeSourceAvailable` → `boolean` (veri varsa `true`).
- Binance API çağrısı yoktur.

### /api/live-trades — read-only endpoint

`GET /api/live-trades` (opsiyonel `?status=open|closed&limit=N`)

- Yalnızca Supabase `live_trades` tablosunu okur.
- Binance API/private endpoint çağrısı yapmaz.
- Emir göndermez.
- Veri yoksa boş liste döner (`hasData: false`).
- `live_trades` tablosu henüz oluşturulmamışsa da hata fırlatmaz.

### Bu fazda kesinlikle dokunulmadı

- Canlı trading açılmadı (`HARD_LIVE_TRADING_ALLOWED=false` korundu).
- `DEFAULT_TRADING_MODE=paper` korundu.
- `enable_live_trading=false` korundu.
- `MIN_SIGNAL_CONFIDENCE=70` korundu.
- `openLiveOrder` / `closeLiveOrder` yazılmadı.
- Binance private/order endpoint çağrısı eklenmedi.
- Trade/signal/risk engine değiştirilmedi.
- Risk settings execution'a bağlanmadı.
- Kaldıraç execution eklenmedi.
- Worker lock korundu.
- Dashboard yeniden tasarlanmadı; Piyasa Tarayıcı değişmedi.
- [BINANCE_API_GUARDRAILS.md](./BINANCE_API_GUARDRAILS.md) korundu.

İlgili dosyalar:
- `supabase/migrations/0009_live_trades.sql` — live_trades şeması.
- `src/lib/trade-performance/types.ts` — `LiveTradeRowRaw` + `liveTradeRowToNormalizedTrade`.
- `src/lib/trade-performance/index.ts` — yeni barrel export'ları.
- `src/app/api/trade-performance/decision-summary/route.ts` — mode=paper|live|all desteği.
- `src/app/api/live-trades/route.ts` — read-only live trades endpoint.
- `src/__tests__/trade-performance-phase15.test.ts` — Faz 15 test paketi.

## Faz 16 — Live Execution Adapter Skeleton

**Hedef:** Gerçek canlı emir altyapısının iskeletini oluştur; bu fazda Binance'e
hiçbir özel emir gönderilmez. Tüm kapılar kapalı tutulur ve execution her zaman
`LIVE_EXECUTION_NOT_IMPLEMENTED` döner.

### Mimari

Triple-gate, fail-closed guard:
1. `HARD_LIVE_TRADING_ALLOWED=true` (env — değiştirilemez)
2. `trading_mode='live'` (DB)
3. `enable_live_trading=true` (DB)

Üç kapı da açık olsa bile `openLiveOrder()` bu fazda `LIVE_EXECUTION_NOT_IMPLEMENTED`
döndürür. Gerçek Binance çağrısı gelecek bir fazda eklenecek.

### Dosyalar

| Dosya | Açıklama |
|---|---|
| `src/lib/live-execution/types.ts` | `LiveOrderRequest`, `LiveCloseRequest`, `LiveOrderResult`, `LiveExecutionGuardResult`, `LiveExecutionMode` |
| `src/lib/live-execution/guard.ts` | Triple-gate, fail-closed; `checkLiveExecutionGuard()` |
| `src/lib/live-execution/adapter.ts` | `openLiveOrder()` — guard sonrası `LIVE_EXECUTION_NOT_IMPLEMENTED` döner |
| `src/lib/live-execution/mock-adapter.ts` | Test mock; `mockOpenLiveOrder()`, `buildMockMode()` |
| `src/lib/live-execution/index.ts` | Barrel export |
| `src/__tests__/live-execution-phase16.test.ts` | 38 test — guard, mock, invariant sentinels |

### Guard parametreleri

| Kontrol | Değer |
|---|---|
| `MIN_SIGNAL_SCORE` | 70 |
| `MIN_RR_RATIO` | 2 |
| stopLoss, takeProfit | > 0 olmalı |
| quantity | > 0 olmalı |
| clientOrderId | boş olamaz |
| tradeMode | `"live"` olmalı |
| executionType | `"real"` olmalı |

### Bu fazda kesinlikle dokunulmadı

- Canlı trading açılmadı (`HARD_LIVE_TRADING_ALLOWED=false` korundu).
- `DEFAULT_TRADING_MODE=paper` korundu.
- `enable_live_trading=false` korundu.
- `MIN_SIGNAL_CONFIDENCE=70` korundu.
- Binance private/order endpoint (`/fapi/v1/order` vb.) çağrısı eklenmedi.
- Worker lock korundu.
- Risk/signal/trade engine değiştirilmedi.
- [BINANCE_API_GUARDRAILS.md](./BINANCE_API_GUARDRAILS.md) korundu.

---

## Faz 17 — Binance Credential / Permission / IP Validation

**Hedef:** Canlıya geçiş öncesi Binance API credential güvenliğini ve permission
durumunu doğrulayacak read-only validation altyapısı kurmak. Bu faz canlı
trading açmaz, gerçek emir göndermez ve `/fapi/v1/order` çağırmaz.

### Mimari

`src/lib/binance-credentials/`:
- `types.ts` — `CredentialPresence`, `FuturesAccessResult`, `BinanceSecurityChecklist`, `BinanceCredentialStatus`, `EXPECTED_VPS_IP`
- `validator.ts` — `checkCredentialPresence()`, `validateFuturesAccess()`, `maskApiKey()`
- `index.ts` — barrel

API:
- `GET  /api/binance-credentials/status` — credential presence + futures read + checklist + recommendedVpsIp
- `POST /api/binance-credentials/checklist` — sadece checklist state günceller; secret/api key kabul etmez

UI: `src/app/api-settings/page.tsx` üzerine 3 kart eklendi
1. Binance Credential Durumu (read-only)
2. Güvenlik Checklist (manuel)
3. Önerilen VPS IP

### Validator davranışı

| Kontrol | Endpoint | Tip |
|---|---|---|
| Credential presence | (env okuma) | yerel |
| Futures public erişim | `GET /fapi/v1/time` | unsigned |
| Account read | `GET /fapi/v2/account` | signed (read-only) |
| Order endpoint | — | **YASAK** |

- API key maskelenir: ilk 4 + `****` + son 4.
- Secret hiçbir response/log'a yazılmaz.
- Hata mesajları `safeErrorMessage()` ile temizlenir (signature/uzun token kaldırılır).

### Manuel checklist

| Alan | Tip |
|---|---|
| `withdrawPermissionDisabled` | `unknown` / `confirmed` / `failed` |
| `ipRestrictionConfigured` | `unknown` / `confirmed` / `failed` |
| `futuresPermissionConfirmed` | `unknown` / `confirmed` / `failed` |
| `extraPermissionsReviewed` | `unknown` / `confirmed` / `failed` |

State `bot_settings.binance_security_checklist` JSONB kolonunda tutulur
(migration `0010_binance_security_checklist.sql`).

### VPS IP

`EXPECTED_VPS_IP=72.62.146.159`. UI ve `/status` response içinde
`recommendedVpsIp` olarak döner. Binance API Management tarafında IP
restriction alanına bu IP girilmelidir.

### Bu fazda kesinlikle dokunulmadı

- Canlı trading açılmadı (`HARD_LIVE_TRADING_ALLOWED=false` korundu).
- `DEFAULT_TRADING_MODE=paper` korundu.
- `enable_live_trading=false` korundu.
- `MIN_SIGNAL_CONFIDENCE=70` korundu.
- `/fapi/v1/order` çağrısı eklenmedi.
- `openLiveOrder` hâlâ `LIVE_EXECUTION_NOT_IMPLEMENTED` döner.
- Risk/signal/trade engine değiştirilmedi.
- Worker lock korundu.
- Withdraw izni hiçbir koşulda kullanılmaz; checklist'te kapalı doğrulanmalı.
- [BINANCE_API_GUARDRAILS.md](./BINANCE_API_GUARDRAILS.md) korundu.

İlgili dosyalar:
- `src/lib/binance-credentials/{types,validator,index}.ts`
- `src/app/api/binance-credentials/{status,checklist}/route.ts`
- `src/app/api-settings/page.tsx` (kart entegrasyonu)
- `supabase/migrations/0010_binance_security_checklist.sql`
- `src/__tests__/binance-credentials-phase17.test.ts`

---

## Faz 18 — WebSocket + Reconciliation Güvenli Altyapı

**Hedef:** Canlıya hazır mimari için WebSocket bağlantı durumu, fiyat feed
skeleton'u ve reconciliation altyapısını güvenli şekilde kurmak. Bu faz canlı
trading açmaz, gerçek emir göndermez ve `/fapi/v1/order` çağırmaz.

### WebSocket / market feed status

`src/lib/market-feed/`:
- `types.ts` — `MarketFeedStatus`, `WebsocketStatus`, `FeedMode`, `MARKET_FEED_STALE_SEC=60`
- `status.ts` — singleton `getMarketFeedStatus()` / `setMarketFeedStatus()` + skeleton
  `createPublicMarketFeed()` (default `skeletonOnly: true` — fiziksel socket açmaz)
- `index.ts` — barrel

Status alanları: `websocketStatus`, `feedMode`, `lastConnectedAt`, `lastMessageAt`,
`disconnectReason`, `symbolsSubscribed`, `stale`, `staleAgeSec`.

Default değerler **disconnected / none / market_feed_not_started** — sahte
"connected" üretilmez.

### Public market feed skeleton durumu

`createPublicMarketFeed()` skeleton mod default'tur:
- Fiziksel WS socket açılmaz.
- `subscribeSymbols()` / `unsubscribeSymbols()` sadece status'taki listeyi günceller.
- `close()` durumu `disconnected` + `feed_closed_by_caller` olarak set eder.
- Gerçek production WS adapter'ı bu arayüz arkasına ileride eklenebilir.

### User data stream

Bu fazda **bağlanmaz**. `listenKey`, `/api/v3/userDataStream`, account/order update
stream, private signed call — **YOK**. Sadece mimari placeholder olarak feedMode
enum'unda yer alır (`"user_data"`).

### Reconciliation (saf fonksiyon)

`src/lib/reconciliation/`:
- `types.ts` — `ReconciliationIssueCode`, `ReconciliationSeverity`, `ReconciliationResult`, snapshot tipleri
- `reconcile.ts` — saf `reconcile({ dbTrades, exchangePositions })`; exchange'e bağlanmaz
- `duplicate-guard.ts` — `detectDuplicateOpenPosition`, `buildClientOrderId`,
  `validateClientOrderIdUniqueness`
- `index.ts` — barrel

Issue kodları: `DB_OPEN_EXCHANGE_MISSING`, `EXCHANGE_OPEN_DB_MISSING`,
`SIZE_MISMATCH`, `SIDE_MISMATCH`, `PRICE_MISMATCH`, `STATUS_MISMATCH`,
`DUPLICATE_OPEN_POSITION`, `UNKNOWN`.

Severity: `info` / `warning` / `critical`. Tolerans: size %0.5, price %0.5.

### Worker reconciliation loop

Fail-closed:
- `mode.mode !== "live"` → no-op.
- `!isHardLiveAllowed()` → no-op.
- `!isLockOwner` → skip.
- `!supabaseConfigured()` → skip.
- Hata → log, worker crash etmez.

Bu fazda `exchangeOpenOrders: []` boş geçilir; gerçek exchange snapshot ileride
adapter'dan gelecek.

### Heartbeat entegrasyonu

`worker/index.ts` artık:
- `websocketStatus`'u `getMarketFeedStatus()` + `toHeartbeatWebsocketStatus()` üzerinden
  yazar; sahte sabit "disconnected" string'i kaldırıldı.
- `binanceApiStatus`'u `"unknown"` olarak yazar (heartbeat hot path'inde signed
  health probe çalıştırılmaz; Faz 17 credential validator ayrı endpoint).

### Bu fazda kesinlikle dokunulmadı

- Canlı trading açılmadı (`HARD_LIVE_TRADING_ALLOWED=false` korundu).
- `DEFAULT_TRADING_MODE=paper` korundu.
- `enable_live_trading=false` korundu.
- `MIN_SIGNAL_CONFIDENCE=70` korundu.
- `/fapi/v1/order` çağrısı eklenmedi.
- Private listenKey / user data stream çağrısı eklenmedi.
- `openLiveOrder` hâlâ `LIVE_EXECUTION_NOT_IMPLEMENTED` döner.
- Risk/signal/trade engine değiştirilmedi.
- Worker lock korundu.
- [BINANCE_API_GUARDRAILS.md](./BINANCE_API_GUARDRAILS.md) korundu.

İlgili dosyalar:
- `src/lib/market-feed/{types,status,index}.ts`
- `src/lib/reconciliation/{types,reconcile,duplicate-guard,index}.ts`
- `worker/index.ts` (heartbeat + reconciliation loop sertleştirildi)
- `src/__tests__/websocket-reconciliation-phase18.test.ts`

---

## Faz 19 — Risk Settings Execution Binding

**Hedef:** Risk Yönetimi config'ini paper/live ortak risk lifecycle'a okunabilir
hale getirmek. Bu faz canlı trading açmaz; kaldıraç execution yapmaz; zararda
büyütme kilitli kalır.

### Kalıcılık

`bot_settings.risk_settings` JSONB kolonu (migration `0011_risk_settings_persistence.sql`).
Store hâlâ in-memory'dir; `ensureHydrated()` ilk okumada Supabase'den
rehydrate eder, `updateRiskSettings()` fire-and-forget persist eder. Supabase
yoksa default'a düşer (mevcut davranış bozulmaz).

### Modüller

`src/lib/risk-settings/apply.ts`:
- `getEffectiveRiskSettings()` — store snapshot
- `buildRiskExecutionConfig()` — paper/live ortak risk execution config
- `validateRiskExecutionConfig()` — invariant doğrulaması
- `getRiskExecutionStatus()` — UI/diagnostics rozetleri

API:
- `GET /api/risk-settings/effective` — execution config + validation + status

### RiskExecutionConfig alanları

| Alan | Kaynak | Lifecycle'a bağlı mı? |
|---|---|---|
| `totalBotCapitalUsdt` | `capital.totalCapitalUsdt` | metadata (config-bound) |
| `riskPerTradePercent` | `capital.riskPerTradePercent` | config-bound |
| `dailyMaxLossPercent` | `capital.maxDailyLossPercent` | config-bound |
| `defaultMaxOpenPositions` | `positions.defaultMaxOpenPositions` | config-bound |
| `dynamicMaxOpenPositions` | `positions.dynamicMaxOpenPositionsCap` | metadata (default 3 uygulanır; dinamik üst sınır Opportunity Priority entegrasyonu beklenir) |
| `maxDailyTrades` | `positions.maxDailyTrades` | config-bound |
| `leverageRanges` | `leverage.{CC,GNMR,MNLST}` | **config-only — execution YOK** |
| `longLeverageEnabled` / `shortLeverageEnabled` | `direction.*` | config-bound |
| `stopLossMode` | `stopLoss.mode` | config-bound |
| `progressiveManagementEnabled` | `tiered.scaleInProfitEnabled` | metadata |
| `averageDownEnabled` | **DAİMA `false`** | **kilitli** |

### Bağlama durumu (sabit)

```
riskConfigBound:        true
liveExecutionBound:     false   // Faz 19 sabit
leverageExecutionBound: false
averageDownLocked:      true
```

### STANDART defaults (test invariant)

- `riskPerTradePercent = 3`
- `maxDailyLossPercent = 10`
- `defaultMaxOpenPositions = 3`
- `dynamicMaxOpenPositionsCap = 5`
- `maxDailyTrades = 10`

### UI

`/risk` sayfasında küçük durum kartı (Faz 19): "CONFIG OKUNUYOR / CANLI EXECUTION
KAPALI / KALDIRAÇ EXECUTION KAPALI / ZARARDA BÜYÜTME KİLİTLİ".

### Bu fazda kesinlikle dokunulmadı

- Canlı trading açılmadı (`HARD_LIVE_TRADING_ALLOWED=false` korundu).
- `DEFAULT_TRADING_MODE=paper` korundu.
- `enable_live_trading=false` korundu.
- `MIN_SIGNAL_CONFIDENCE=70` korundu.
- `/fapi/v1/order` çağrısı eklenmedi.
- Kaldıraç execution eklenmedi (Binance position leverage set edilmiyor).
- `openLiveOrder` hâlâ `LIVE_EXECUTION_NOT_IMPLEMENTED` döner.
- Signal engine matematiği değişmedi.
- Trade signal threshold değişmedi.
- Worker lock korundu.
- [BINANCE_API_GUARDRAILS.md](./BINANCE_API_GUARDRAILS.md) korundu.

İlgili dosyalar:
- `src/lib/risk-settings/apply.ts`
- `src/lib/risk-settings/store.ts` (hydrate + persist)
- `src/lib/risk-settings/index.ts` (apply re-export)
- `src/app/api/risk-settings/effective/route.ts`
- `src/app/api/risk-settings/route.ts` (GET hidrate çağrısı eklendi)
- `src/app/risk/page.tsx` (BindingStatus kartı)
- `supabase/migrations/0011_risk_settings_persistence.sql`
- `src/__tests__/risk-execution-binding-phase19.test.ts`

---

## Faz 20 — Risk Engine Binding / Position Sizing

**Amaç:** Risk Yönetimi sayfasındaki kalıcı risk ayarlarını gerçek risk
lifecycle hesaplarına (pozisyon büyüklüğü, günlük zarar limiti, max açık
pozisyon, max günlük işlem) kontrollü şekilde bağlamak.

### Pozisyon Büyüklüğü Formülü

```
riskAmountUsdt       = totalBotCapitalUsdt × riskPerTradePercent / 100
stopDistancePercent  = |entryPrice − stopLoss| / entryPrice × 100
positionNotionalUsdt = riskAmountUsdt / (stopDistancePercent / 100)
quantity             = positionNotionalUsdt / entryPrice
```

- **Kaldıraç pozisyon büyüklüğünü artırmaz.** Kaldıraç bu fazda yalnızca
  config metadata olarak taşınır; position sizing hesabına girmez.
- **Kaldıraç execution bu fazda yoktur.** `/fapi/v1/leverage` çağrısı yok.
- `totalBotCapitalUsdt = 0` ise `capital_missing` reason üretilir; güvenli
  fallback (PAPER_BALANCE = 1000 USDT) devreye girer.

### Risk Settings → Lifecycle Bağlantıları

| Risk Settings Alanı | Lifecycle Kullanımı |
|---|---|
| `capital.totalCapitalUsdt` | `accountBalanceUsd` (position sizing + daily loss limit) |
| `capital.riskPerTradePercent` | `effectiveRiskPct` (risk engine + position sizing) |
| `capital.maxDailyLossPercent` | `dailyLossLimitUsd` (risk engine + daily-target) |
| `positions.defaultMaxOpenPositions` | Max açık pozisyon guard (risk engine + orchestrator) |
| `positions.dynamicMaxOpenPositionsCap` | Diagnostics metadata |
| `positions.maxDailyTrades` | Günlük max işlem guard (orchestrator tick) |

### Korunan Güvenlik Sabiitleri (Değişmez)
- `HARD_LIVE_TRADING_ALLOWED=false` — canlı trading kapalı.
- `DEFAULT_TRADING_MODE=paper` — varsayılan mod paper.
- `enable_live_trading=false` — DB gati kapalı.
- `MIN_SIGNAL_CONFIDENCE=70` — sinyal eşiği değişmedi.
- `averageDownEnabled=false` — zararda pozisyon büyütme kilitli.
- `liveExecutionBound=false` — canlı execution bağlı değil.
- `leverageExecutionBound=false` — kaldıraç execution yok.
- `openLiveOrder` hâlâ `LIVE_EXECUTION_NOT_IMPLEMENTED` döner.
- Binance API Guardrails değişmez kuraldır.
- Worker lock mekanizması korunuyor.
- Signal engine matematiği ve trade signal threshold değişmedi.

### Paper Trade Risk Metadata

Açılan paper trade kayıtlarına `risk_metadata` JSONB alanı eklendi:
```json
{
  "risk_amount_usdt": 30,
  "risk_per_trade_percent": 3,
  "position_notional_usdt": 600,
  "stop_distance_percent": 5,
  "risk_config_source": "risk_settings",
  "risk_config_bound": true
}
```

İlgili dosyalar:
- `src/lib/engines/position-sizing.ts` (yeni — calculatePositionSizeByRisk)
- `src/lib/engines/risk-engine.ts` (riskConfigMaxOpenPositions, riskConfigDailyMaxLossPercent, riskConfigRiskPerTradePercent eklendi)
- `src/lib/engines/daily-target.ts` (DailyStatusOptions.dailyMaxLossPercent eklendi)
- `src/lib/engines/paper-trading-engine.ts` (riskMetadata alanı eklendi)
- `src/lib/engines/bot-orchestrator.ts` (buildRiskExecutionConfig bağlantısı, maxDailyTrades guard)
- `src/app/api/paper-trades/open/route.ts` (risk config kullanımı)
- `supabase/migrations/0012_paper_trades_risk_metadata.sql`
- `src/__tests__/risk-engine-binding-phase20.test.ts`

---

## Faz 21 — Kademeli Pozisyon / Kaldıraç Yönetimi Hazırlığı

**Amaç:** Paper/live ortak pozisyon yönetimi için kademeli yönetim altyapısı.
Tüm çıktılar **öneri/metadata** niteliğindedir; gerçek emir gönderilmez.

### Kademeli Yönetim Kuralları

- **Zararda büyütme yasaktır.** `averageDownEnabled=false` invariantı korunur.
  `currentRMultiple < 0` → `BLOCK_SCALE_IN_LOSING_POSITION` döner.
- **Kaldıraç execution yoktur.** `leverageExecutionBound=false` sabit kalır.
- **Gerçek order update yoktur.** `recommendedStopLoss` yalnızca öneridir.

### R-Multiple Aşamaları ve Aksiyonlar

| Aşama | R-Multiple | Aksiyon Önerisi |
|---|---|---|
| `losing` | < 0R | HOLD + scale-in engeli |
| `breakeven` | 0–0.5R | HOLD |
| `early_profit` | 0.5–1R | HOLD (izle) |
| `at_1r` | 1–1.5R | MOVE_SL_TO_BREAKEVEN |
| `at_1_5r` | 1.5–2R | PARTIAL_TAKE_PROFIT / ENABLE_TRAILING_STOP |
| `at_2r_plus` | 2R+ | ENABLE/TIGHTEN_TRAILING_STOP |

### Trailing Stop Kuralları (Advisory Only)

- Long: SL sadece yukarı hareket eder.
- Short: SL sadece aşağı hareket eder.
- SL asla riski artıracak yönde geri alınmaz.
- Breakeven sonrası stop yalnızca kârı koruyacak yönde güncellenir.
- Gerçek order update yoktur.

### Kârda Scale-In Koşulları (Advisory Only)

`CONSIDER_PROFIT_SCALE_IN` yalnızca şu koşullar sağlanırsa önerilir:
- `currentRMultiple >= 1.5`
- `tradeSignalScore >= 70`, `setupScore >= 70`, `marketQualityScore >= 70`
- `btcAligned = true`, `volumeImpulse = true`
- SL breakeven seviyesine taşınmış

Bu fazda bu aksiyon yalnızca öneri/metadata; gerçek emir yoktur.

### Korunan Güvenlik Sabitleri

- `HARD_LIVE_TRADING_ALLOWED=false` korundu
- `DEFAULT_TRADING_MODE=paper` korundu
- `enable_live_trading=false` korundu
- `MIN_SIGNAL_CONFIDENCE=70` değişmedi
- `averageDownEnabled=false` invariantı korundu
- `leverageExecutionBound=false` sabit
- `openLiveOrder` hâlâ `LIVE_EXECUTION_NOT_IMPLEMENTED`
- Binance API Guardrails değişmez kural

İlgili dosyalar:
- `src/lib/position-management/types.ts` (yeni)
- `src/lib/position-management/progressive-plan.ts` (yeni — ana karar motoru)
- `src/lib/position-management/trailing-stop.ts` (yeni — trailing stop modeli)
- `src/lib/position-management/scale-rules.ts` (yeni — scale-in kuralları)
- `src/lib/position-management/index.ts` (yeni — barrel export)
- `src/app/api/position-management/recommendations/route.ts` (yeni — read-only endpoint)
- `src/components/dashboard/Cards.tsx` (PmBadge eklendi — display-only)
- `src/app/page.tsx` (PM recommendations fetch + mapping)
- `src/__tests__/position-management-phase21.test.ts`

---

## Faz 22 — Trade Denetimi ve Risk Kalibrasyonu

**Amaç:** Paper/live ortak trade lifecycle'ındaki açılan/kapanan işlemleri,
kaçan fırsatları, SL/TP kalitesini, risk yüzdesini, pozisyon büyüklüğünü,
max/min limitleri ve kaldıraç aralıklarını denetleyen analiz motoru.

### Temel Kural (DEĞİŞMEZ)

Bu faz analiz, sınıflandırma, kalibrasyon önerisi ve karar kartı verisi
üretir. **Hiçbir ayarı otomatik değiştirmez.**

### Modül Yapısı

`src/lib/trade-audit/` — saf fonksiyonlar; external I/O yok.

| Dosya | Açıklama |
|---|---|
| `types.ts` | Tüm tip tanımları (`TradeAuditInput`, `TradeAuditReport`, `TradeAuditSummary` + tüm tag tipleri) |
| `trade-quality.ts` | İşlem kalite incelemesi: `GOOD_TRADE`, `ACCEPTABLE_LOSS`, `BAD_ENTRY`, `EARLY_STOP_SUSPECT`, `BAD_RR`, `EXIT_TOO_EARLY`, `MISSED_PROFIT_PROTECTION`, `DATA_INSUFFICIENT` |
| `stop-loss-audit.ts` | SL denetimi: `NORMAL_STOP`, `EARLY_STOP_SUSPECT`, `SL_TOO_TIGHT`, `SL_TOO_WIDE`, `WICK_STOP_SUSPECT`, `SPREAD_SLIPPAGE_SUSPECT`, `DATA_INSUFFICIENT` |
| `take-profit-audit.ts` | TP/çıkış denetimi: `NORMAL_TP`, `TP_TOO_CLOSE`, `TP_TOO_FAR`, `EXIT_TOO_EARLY`, `MISSED_TRAILING_STOP`, `MISSED_PARTIAL_TP`, `DATA_INSUFFICIENT` |
| `risk-calibration.ts` | Risk % değerlendirmesi: `KEEP`, `OBSERVE`, `REDUCE_RISK`, `INCREASE_RISK`, `REVIEW_DAILY_LOSS`, `REVIEW_POSITION_SIZE`, `DATA_INSUFFICIENT` |
| `position-sizing-audit.ts` | Pozisyon boyutu denetimi: `POSITION_SIZE_OK`, `POSITION_SIZE_TOO_LARGE`, `STOP_DISTANCE_INFLATED_NOTIONAL`, `CAPITAL_MISSING_FALLBACK_USED`, `DATA_INSUFFICIENT` |
| `limit-calibration.ts` | Max pozisyon/günlük işlem limitleri: `KEEP_LIMITS`, `REVIEW_MAX_OPEN_POSITIONS`, `REVIEW_DYNAMIC_CAPACITY`, `REVIEW_MAX_DAILY_TRADES`, `OVERTRADE_RISK`, `DATA_INSUFFICIENT` |
| `leverage-calibration.ts` | Kaldıraç aralığı değerlendirmesi: `KEEP_LEVERAGE_RANGE`, `REDUCE_MAX_LEVERAGE`, `OBSERVE_BEFORE_30X`, `BLOCK_30X`, `DATA_INSUFFICIENT` |
| `missed-opportunity-audit.ts` | Kaçan fırsatlar: `MISSED_OPPORTUNITY_LOW/MODERATE/HIGH`, `THRESHOLD_TOO_STRICT_SUSPECT`, `FILTER_TOO_STRICT_SUSPECT`, `DATA_INSUFFICIENT` |
| `threshold-calibration.ts` | 70 eşiği değerlendirmesi: `KEEP_70`, `OBSERVE_65_69`, `REVIEW_THRESHOLD_LATER`, `DO_NOT_LOWER`, `DATA_INSUFFICIENT` |
| `summary.ts` | Genel karar kartı: `buildTradeAuditReport()` |
| `index.ts` | Barrel export |

### Read-only API endpoint

`GET /api/trade-audit/summary?mode=paper|live|all`

- Supabase `paper_trades` / `live_trades` + `bot_settings.last_tick_summary` okur.
- **Binance API çağrısı YAPMAZ.** `/fapi/v1/order` ve `/fapi/v1/leverage` YOK.
- Risk config'i `buildRiskExecutionConfig()` üzerinden okur; değiştirmez.
- Veri yetersizse `DATA_INSUFFICIENT` ile güvenli fallback döner.

### Dashboard kartı

`TradeAuditCard` — 6 bölüm:
- **RİSK** — risk % kalibrasyonu
- **STOP-LOSS** — SL denetim özeti
- **POZİSYON BÜYÜKLÜĞÜ** — position sizing denetimi
- **EŞİK** — 70 eşiği performans değerlendirmesi
- **KAÇAN FIRSAT** — filtre ve eşik kaynaklı kaçan fırsatlar
- **KALDIRAÇ** — kaldıraç aralığı değerlendirmesi

Aksiyon butonları (ONAYLA / REDDET / GÖZLEM / PROMPT) bu fazda gerçek
ayar değiştirmez; yalnızca `onAction(kind, actionId)` callback üretir.

### Temel İnvariantlar (Değişmez)

- Trade Denetimi ve Risk Kalibrasyonu analiz/öneri üretir — ayarları otomatik değiştirmez.
- SL/TP/risk/kaldıraç/threshold kararlarını yalnızca sınıflandırır.
- `MIN_SIGNAL_CONFIDENCE=70` korunur; `liveThreshold` daima 70, `liveThresholdUnchanged` daima `true`.
- 30x için yeterli performans verisi (`winRate ≥ 50`, `closedTrades ≥ 20`) gerekir.
- Veri yoksa `DATA_INSUFFICIENT` döner — sahte sonuç üretmez.
- `HARD_LIVE_TRADING_ALLOWED=false` korunur.
- `DEFAULT_TRADING_MODE=paper` korunur.
- `enable_live_trading=false` korunur.
- `averageDownEnabled=false` invariantı korunur.
- `openLiveOrder` hâlâ `LIVE_EXECUTION_NOT_IMPLEMENTED` döner.
- Binance API Guardrails değişmez kuraldır.
- `appliedToTradeEngine` daima `false`.

### Bu fazda kesinlikle dokunulmadı

- Canlı trading açılmadı.
- Risk ayarları otomatik değiştirilmedi.
- Stop-loss kuralı değiştirilmedi.
- Trade signal threshold değiştirilmedi.
- Kaldıraç execution eklenmedi.
- Signal engine matematiği değiştirilmedi.
- Worker lock korundu.
- [BINANCE_API_GUARDRAILS.md](./BINANCE_API_GUARDRAILS.md) korundu.

İlgili dosyalar:
- `src/lib/trade-audit/` — modül (11 dosya)
- `src/app/api/trade-audit/summary/route.ts` — read-only endpoint
- `src/components/dashboard/Cards.tsx` — `TradeAuditCard` eklendi
- `src/__tests__/trade-audit-phase22.test.ts` — 48 test

---

## Faz 23 — Live Readiness / Canlıya Geçiş Kontrolü

**Amaç:** CoinBot'un canlıya geçmeye hazır olup olmadığını ölçen final
readiness gate sistemi. Bu faz canlı trading **AÇMAZ**; yalnızca
"HAZIR / HAZIR DEĞİL / GÖZLEM GEREKLİ" kararı üretir.

### Değişmez Kural

- Live Readiness canlıyı AÇMAZ.
- Live gate değerleri (`HARD_LIVE_TRADING_ALLOWED`, `enable_live_trading`,
  `DEFAULT_TRADING_MODE`) manuel final aktivasyon olmadan değişmez.
- En az **100 kapanmış paper trade** zorunludur — bypass edilemez.
- API security checklist tamamlanmadan canlıya geçilmez.
- Kullanıcı onayı (`userLiveApproval`) ayrı ve zorunludur, default `pending`.
- Binance API Guardrails değişmez kuraldır.

### Modül Yapısı

`src/lib/live-readiness/` — saf fonksiyonlar; external I/O endpoint'te.

| Dosya | Açıklama |
|---|---|
| `types.ts` | `LiveReadinessInput`, `LiveReadinessSummary`, `ReadinessCheck` + 9 kategori input tipi |
| `checks.ts` | 9 kategori için saf check fonksiyonları |
| `summary.ts` | `buildLiveReadinessSummary()` — tüm check'leri toplar, status üretir |
| `index.ts` | Barrel export |

### 9 Readiness Kategorisi

| Kategori | İçerik |
|---|---|
| `PAPER_PERFORMANCE` | Min 100 kapanmış trade, win rate ≥ %45, profit factor ≥ 1.3, drawdown ≤ %10, ardışık kayıp ≤ 5 |
| `RISK_CALIBRATION` | `averageDownEnabled=false`, `leverageExecutionBound=false`, risk %, daily max loss, sermaye, 30x uyarısı |
| `TRADE_AUDIT` | Faz 22 audit raporundaki kritik bulgu sayısı, position sizing inflation tespiti |
| `BINANCE_CREDENTIALS` | API key/secret, futures read access, account read |
| `API_SECURITY` | Withdraw kapalı, IP restriction, futures permission, ek izinler — hepsi `confirmed` olmalı |
| `EXECUTION_SAFETY` | `openLiveOrder=NOT_IMPLEMENTED`, triple-gate, binding invariant'ları |
| `WEBSOCKET_RECONCILIATION` | WS connected, reconciliation safe, duplicate guard, clientOrderId guard |
| `SYSTEM_HEALTH` | Worker online, heartbeat fresh, diagnostics not stale, worker lock healthy |
| `USER_APPROVAL` | `userLiveApproval` default `pending` — onay olmadan blocking |

### 100 Paper Trade Şartı

Her senaryoda zorunludur ve bypass edilemez:
- 0 kapanmış işlem → `pending`, blocking
- 1–99 kapanmış işlem → `fail`, blocking
- ≥100 kapanmış işlem → `pass`

Test ile garantilenir: 0/25/50/75/99 değerleri için `blocking=true`.

### API Security Checklist Davranışı

`bot_settings.binance_security_checklist` (Faz 17) JSONB alanı:
- `withdrawPermissionDisabled`, `ipRestrictionConfigured`,
  `futuresPermissionConfirmed`, `extraPermissionsReviewed`
- Her alan `unknown | confirmed | failed` olabilir.
- Default tüm alanlar `unknown` → tüm checkler blocking.
- `failed` durumda blocking + critical severity.
- `confirmed` durumunda pass; tüm 4 alan confirmed olmadıkça canlıya geçilmez.

### WebSocket / Reconciliation Değerlendirmesi

Faz 18 altyapısı üzerinden:
- `MarketFeedStatus.websocketStatus === "connected"` zorunlu.
- `disconnected` durumunda `warning + blocking` (canlı fiyat takibi yok).
- Reconciliation loop fail-closed/no-op invariant korunuyor mu?
- Duplicate position guard ve clientOrderId guard mevcut mu?

### Execution Safety Kararı

Bu fazda canlı execution **kapalı kalmalı**. Check'ler şunu doğrular:
- `openLiveOrder` hâlâ `LIVE_EXECUTION_NOT_IMPLEMENTED` → pass.
- Triple-gate (`hardLiveTradingAllowed`, `enableLiveTrading`,
  `defaultTradingMode`) okunup raporlanır; kapalıysa pass.
- `liveExecutionBound=false`, `leverageExecutionBound=false` invariant'ları.
- Bilgilendirme: "Final aktivasyon ayrı manuel adımdır." (status `pending`,
  blocking değil — READY'yi engellemez.)

### Read-only API Endpoint

`GET /api/live-readiness/status`

- Supabase'den paper_trades, live_trades, bot_settings okur.
- `getEffectiveRiskSettings()`, `buildTradeAuditReport()`, `getWorkerHealth()`,
  `getMarketFeedStatus()` üzerinden dahili modülleri okur.
- `validateFuturesAccess()` Faz 17 read-only signed çağrısını kullanır
  (sadece `/fapi/v1/time` ve `/fapi/v2/account`, **order endpoint YOK**).
- **Yasaklı Binance private path'leri (order, leverage) referans alınmaz.**
- Live gate değerlerini DEĞİŞTİRMEZ; sadece okur.
- Endpoint dosyası test ile doğrulanır: `update(trading_mode|enable_live_trading)` yok.

### Dashboard Kartı — CANLIYA GEÇİŞ KONTROLÜ

`LiveReadinessCard`:
- Üst pill: HAZIR / HAZIR DEĞİL / GÖZLEM GEREKLİ + skor /100
- 6 mini bölüm: Paper Performans, Risk Kalibrasyonu, API Güvenliği,
  Execution Safety, Sistem Sağlığı, WebSocket
- NOT_READY ise net mesaj: "Canlıya geçiş için hazır değil."
- Paper trade eksikse net mesaj: "100 kapanmış paper trade tamamlanmadan
  canlıya geçilmez."
- Sonraki aksiyon kutusu (`COMPLETE_PAPER_TRADES`, `FIX_API_SECURITY`,
  `MANUAL_FINAL_ACTIVATION`, …)
- **ONAYLA butonu YOK** — canlıyı açan UI bu kartta gösterilmez.
  Aksiyonlar: GÖZLEM, PROMPT, RAPORU YENİLE (sadece callback).

### Bu fazda kesinlikle dokunulmadı

- Canlı trading açılmadı.
- `HARD_LIVE_TRADING_ALLOWED=false` korundu.
- `DEFAULT_TRADING_MODE=paper` korundu.
- `enable_live_trading=false` korundu.
- `MIN_SIGNAL_CONFIDENCE=70` korundu.
- `openLiveOrder` hâlâ `LIVE_EXECUTION_NOT_IMPLEMENTED`.
- Yasaklı Binance private endpoint'leri eklenmedi.
- Risk ayarları otomatik değiştirilmedi.
- Threshold/SL kuralı değiştirilmedi.
- Worker lock korundu.
- `averageDownEnabled=false` korundu.
- `liveExecutionBound=false`, `leverageExecutionBound=false` korundu.
- [BINANCE_API_GUARDRAILS.md](./BINANCE_API_GUARDRAILS.md) korundu.

İlgili dosyalar:
- `src/lib/live-readiness/{types,checks,summary,index}.ts` — modül
- `src/app/api/live-readiness/status/route.ts` — read-only endpoint
- `src/components/dashboard/Cards.tsx` — `LiveReadinessCard` eklendi
- `src/__tests__/live-readiness-phase23.test.ts` — 44 test

---

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
