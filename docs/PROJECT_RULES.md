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
