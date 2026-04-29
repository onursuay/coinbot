# Binance API Guardrails

> **Bu doküman CoinBot için değişmez (immutable) mimari kural setidir.**
> Buradaki kurallar trading logic, sinyal mantığı, risk yönetimi veya
> dashboard davranışından bağımsız olarak **her zaman** geçerlidir.
> Hiçbir faz, hiçbir refactor, hiçbir "geçici" değişiklik bu kuralları
> gevşetemez. İhlal eden kod merge edilemez.

---

## 1. Amaç

Bu doküman, CoinBot'un Binance API ile iletişiminde Binance tarafından
uygulanan rate limit, weight ve ban politikalarına **istisnasız** uymasını
garanti eden mimari kuralları tanımlar. Hedef:

- Binance tarafından **HTTP 429 (rate limit)** alma riskini sıfıra yakın tutmak.
- **HTTP 418 (IP ban)** durumunu **asla** yaşamamak.
- API key'in kalıcı/uzun süreli kısıtlamaya tabi tutulmasını engellemek.
- Worker, dashboard ve scanner'ın Binance'e gereksiz, tekrar eden veya
  paralel/duplike istek üretmesini önlemek.
- Gelecek fazların (canlı trading, yeni sinyal motoru, yeni indikatör vs.)
  bu güvenlik tabanını koruyarak inşa edilmesini sağlamak.

---

## 2. Değişmez Ana Kural

> **CoinBot hiçbir koşulda Binance API rate limit ihlali, IP ban,
> request spam, kontrolsüz polling, gereksiz endpoint çağrısı veya Binance
> tarafından engelleme/sınırlama doğuracak bir API kullanım modeliyle
> çalışmayacak.**

Bu kural; trading sinyallerinden, scanner ekranından, manuel coin detay
sorgusundan, debug endpoint'lerinden ve worker tick'lerinden bağımsız
olarak **mutlak**'tır. Performans, hız, "daha fresh veri" gibi gerekçelerle
delinemez.

---

## 3. Resmi Binance API Riskleri

Binance'in resmi dokümantasyonunda tanımlı ve CoinBot için bağlayıcı olan
riskler:

- **Rate limit ihlali** → `HTTP 429 Too Many Requests`.
- **429 alındıktan sonra istek atmaya devam etmek** → `HTTP 418 I'm a teapot`,
  yani **otomatik IP ban** (genellikle 2 dakikadan başlar, tekrarlanırsa
  saatlere/günlere uzar).
- **Rate limit IP bazlıdır.** Aynı IP'yi paylaşan birden fazla worker veya
  process kümülatif weight tüketir. Sadece API key bazlı düşünmek **yanlış**.
- **Endpoint'ler weight tüketir.** Ağır endpoint'ler (örn. tüm semboller için
  `klines`, `depth` derinliği yüksek istekler) bir tek çağrıyla dakikalık
  bütçeyi yiyebilir.
- **Order endpoint'leri** ayrı bir `X-MBX-ORDER-COUNT-*` sayacı tutar; spot
  ve futures için ayrı ayrı izlenir.
- **5xx hataları** sunucu kaynaklıdır; körü körüne retry duplicate request
  veya duplicate order yaratabilir.
- **`Retry-After` header'ı**, Binance'in "şu kadar saniye sus" talimatıdır;
  uyulmaması banla sonuçlanır.

---

## 4. 429 / 418 / Retry-After Kuralları

- **429 alındığında**: Binance API client o anda **tüm Binance trafiğini
  durdurmalı**, kuyruktaki istekler beklemeye alınmalı.
  - Eğer response'ta `Retry-After` header'ı varsa o süre kadar **kesinlikle**
    beklenir, kısaltılmaz.
  - `Retry-After` yoksa minimum 60 saniye soğuma uygulanır.
- **418 alındığında**: client "**circuit open**" moduna geçer.
  - Tüm Binance istekleri en az **5 dakika** bloklanır.
  - Heartbeat loglanır, dashboard'a görünür alarm yazılır.
  - Otomatik retry **yoktur**; soğuma süresi sonunda probe (tek hafif istek)
    ile durum doğrulanır, başarılı olmadan trafik açılmaz.
- **Birden fazla 429/418 ardışık geldiğinde** geri açılış süresi exponential
  artar (bkz. §9).
- **Her Binance response'u** client tarafında inspect edilir; status kodu
  ne olursa olsun `Retry-After`, `X-MBX-USED-WEIGHT-*` ve
  `X-MBX-ORDER-COUNT-*` header'ları okunup metric/log'a yazılır.

> **Asla**: 429 sonrası "belki düzeldi" diye hemen tekrar denemek,
> `Retry-After`'ı yoksaymak veya kısaltmak, 418 sırasında başka endpoint'e
> istek atmak (rate limit IP bazlı; 418 tüm IP'yi kapsar).

---

## 5. Request Weight ve Header Takibi

- Her Binance HTTP yanıtında dönen şu header'lar **merkezi client**
  tarafından okunur ve in-memory state'e yazılır:
  - `X-MBX-USED-WEIGHT` ve `X-MBX-USED-WEIGHT-1M` (genel ağırlık).
  - `X-MBX-ORDER-COUNT-1S`, `X-MBX-ORDER-COUNT-1M`, `X-MBX-ORDER-COUNT-1D`
    (order endpoint'leri için).
  - `Retry-After` (varsa).
- Client şu eşikleri uygular (Binance default'larından **emniyet payıyla**
  düşük tutulur):
  - **Weight kullanımı %75'i geçtiğinde**: yeni istekler kuyrukta yavaşlatılır
    (soft throttle), düşük öncelikli olanlar ertelenir.
  - **Weight kullanımı %90'ı geçtiğinde**: sadece kritik istekler (örn. açık
    paper-trade pozisyon kapatma için fiyat doğrulama) geçer; scanner,
    background tarama, history fetch gibi istekler durdurulur.
- Order weight için ayrı eşikler aynı mantıkla uygulanır.
- Header değerleri eksik gelirse client **default conservative** davranır
  (yani %90 dolu kabul eder).

---

## 6. WebSocket / Toplu Veri Önceliği

CoinBot Binance'ten veri çekerken aşağıdaki **öncelik sırası** uygulanır:

1. **WebSocket** — sürekli güncellenen veriler (ticker, mark price, kline
   stream, funding güncellemeleri vs.) için varsa WS kullanılır.
2. **Toplu (batch) REST endpoint** — `tickers`, `exchangeInfo`, multi-symbol
   `klines` gibi tek istekle çoklu sembol veren endpoint'ler kullanılır.
3. **Tekil REST endpoint** — sadece toplu/WS yoksa veya tek sembol için
   gerçekten ad-hoc bir sorgu varsa.

> **Yasak**: 50 sembol için 50 ayrı `/klines` isteği atmak. Toplu çekim
> mümkünse tekil istek **yapılamaz**.

WebSocket bağlantıları:
- Kalıcı worker (VPS) tarafında tutulur; serverless route'lardan WS
  kurulmaz.
- Reconnect exponential backoff + jitter ile yapılır.
- Aynı stream için **tek bir** abone bulunur; duplicate subscription yasak.

---

## 7. Cache ve TTL Kuralları

Aynı veri tekrar tekrar Binance'ten çekilemez. Her veri tipi için
**zorunlu** TTL'leri client/cache katmanı uygular:

| Veri tipi | Minimum TTL | Notlar |
|---|---|---|
| `exchangeInfo` (semboller, filtreler) | 1 saat | Değişim nadir; hot-reload yasak. |
| 24h ticker (toplu) | 30 saniye | Scanner için yeterli. |
| Tek sembol ticker | 5 saniye | Coin detay için. |
| Kline (closed candle) | Candle interval kadar | Kapanmış mum yeniden çekilmez. |
| Kline (current/forming) | 5 saniye | Sadece güncel mum tazelenir. |
| Funding rate | 60 saniye | |
| Mark price | 5 saniye | WS varsa cache atlanır, doğrudan WS state. |
| Order book (depth) | 2 saniye | Yüksek weight; minimumda tutulur. |

- Cache layer **process-içi** (memory) + **paylaşılan** (Redis/DB) iki
  katmanlı olabilir; ancak her durumda **TTL bypass** edilemez.
- Cache miss sırasında aynı key için paralel çağrı geldiğinde
  **single-flight** uygulanır (aynı anda sadece 1 upstream istek, diğerleri
  beklemeye alınır).

---

## 8. Queue / Concurrency / Rate Limit Guard

- **Tüm Binance HTTP çağrıları merkezi bir client üzerinden geçer.**
  - Dosya konumu (öneri): `src/lib/exchanges/adapters/binance.adapter.ts`
    veya altındaki shared `binance-client` modülü. Yeni dosyalar bu client'ı
    bypass etmeyecek şekilde yazılır.
- Client içinde:
  - **FIFO queue** + **öncelik (priority)** seviyeleri:
    `critical` > `trading` > `interactive` > `background`.
  - **Concurrency limit**: aynı anda en fazla N (default 4) Binance isteği
    in-flight olabilir.
  - **Rate guard**: dakikalık weight bütçesi yumuşak %75, sert %90 eşikleri
    (bkz. §5).
- Queue derinliği üst sınırı vardır; aşılırsa düşük öncelikli istekler
  reddedilir (`background` önce düşer). Trading isteği asla sessizce
  düşmez; yerine error fırlatır ki çağıran taraf güvenli karar versin.
- Aynı endpoint + parametre kombinasyonu için **dedupe** (single-flight)
  zorunludur: aynı anda 2 worker tick'i `klines BTCUSDT 1h` istediğinde
  Binance'e tek istek gider, iki çağıran aynı sonucu paylaşır.

---

## 9. Backoff + Jitter Stratejisi

429/418/5xx ve network hatalarında retry **kuralları**:

- **Sınırsız retry yasak.** Maksimum retry sayısı tanımlıdır
  (default 3, kritik endpoint'ler için 5).
- **Exponential backoff**: temel gecikme 500 ms, her denemede `×2`.
- **Jitter**: hesaplanan gecikme `[base, base × 2)` aralığında rastgele
  seçilir; aynı anda paralel client'ların aynı saniyede ateşlemesini
  engeller.
- 429 sırasında `Retry-After` header'ı varsa **bu süre tabandır**;
  exponential backoff bu sürenin altına inemez.
- 418 sırasında retry **yoktur**; circuit breaker devreye girer (§10).
- 5xx hatalarında: idempotent endpoint'ler (GET) retry edilebilir; **order
  endpoint'leri retry edilmez**, bunun yerine durum doğrulanır (§11).

---

## 10. Circuit Breaker Kuralları

Binance API client'ı bir **circuit breaker** ile sarılır:

- **Closed** (normal): istekler akar.
- **Open** (acil durum): tüm Binance istekleri reddedilir; bekleyen kuyruk
  boşaltılır veya beklemeye alınır.
- **Half-open** (probe): kısa bir test süresi sonunda tek hafif istek
  (`/ping` veya `exchangeInfo`) ile durum yoklanır.

Açma koşulları (en az biri):
- Son 60 saniyede 3+ kez 429 alındı.
- Tek bir 418 alındı (anında open, en az 5 dakika).
- Son 60 saniyede 5+ kez 5xx alındı.
- Worker heartbeat 2 tick üst üste kaybedildi (duplicate worker şüphesi —
  §11).

Açıkken:
- Trading kararları "no-trade" olarak işaretlenir; risk engine zaten kapalı
  kabul eder.
- Dashboard görünür uyarı verir.
- Scanner çalışmaz; cache'den son bilinen veri "stale" etiketiyle gösterilir.

---

## 11. Worker Duplicate Request Önlemi

- **Tek worker garantisi**: VPS üzerinde Binance'e konuşan worker process'i
  **tek instance** çalışır. Mevcut worker lock mekanizması (CLAUDE.md'deki
  güvenlik kuralı) bozulmamalıdır.
- Tick scheduler içinde aynı semboller için aynı periyotta **paralel iki
  tarama** başlatılmaz; her tick öncesi önceki tick'in bittiği doğrulanır
  (overlap guard).
- Order benzeri istekler için **client order id** üretilir; idempotency
  bunun üzerinden sağlanır.
- 5xx veya timeout sonucu **bilinmeyen durum** (özellikle order
  gönderiminde): otomatik retry **yapılmaz**. Önce durum doğrulanır
  (`getOrder`, `openOrders`, `accountTrades`); ancak doğrulama netse
  ardından karar verilir.
- Aynı symbol+endpoint için kuyruğa düşen duplicate istekler single-flight
  ile birleştirilir (§8).

---

## 12. Yasaklanan API Kullanım Şekilleri

Aşağıdaki davranışlar CoinBot kod tabanında **yasaktır**. Code review'da
reddedilir, merge edilmez:

1. Doğrudan `fetch('https://...binance.com/...')` veya `axios.get(...)` ile
   merkezi client dışında Binance çağrısı yapmak.
2. `setInterval`/`while(true)` ile sıkı (ms düzeyinde) polling kurmak.
3. Aynı veri için TTL içinde tekrar tekrar Binance'e istek atmak.
4. 429 veya 5xx alındığında bekleme yapmadan retry atmak.
5. 418 alındıktan sonra **herhangi bir** Binance isteği atmak.
6. `Retry-After` header'ını kısaltmak veya yoksaymak.
7. Sembol başına ayrı tek-sembol istekleri atmak (toplu endpoint varken).
8. Worker dışı (örn. Vercel route) süreçlerden kalıcı WS bağlantısı
   açmaya çalışmak.
9. Aynı stream için birden fazla WebSocket aboneliği başlatmak.
10. Order endpoint'lerinde durum doğrulamadan retry yapmak (duplicate order
    riski).
11. Concurrency limit'i bypass eden "fast path" / "debug only" çağrılar
    eklemek.
12. Geçici test amaçlı `console.log` çağrı sayısını artıran in-loop
    Binance istekleri yazmak.

---

## 13. Trading Logic'e Dokunmama Kuralı

Bu doküman trading davranışını **değiştirmez**:

- `MIN_SIGNAL_CONFIDENCE`, BTC trend filtresi, leverage tavanı, R:R minimumu,
  paper-only mod, kill-switch ve diğer risk parametreleri korunur.
- `HARD_LIVE_TRADING_ALLOWED=false` kalır.
- Mevcut sinyal motoru, skor hesabı, dashboard görünümü değiştirilmez.
- Bu doküman yalnızca **API kullanım katmanını** yöneten kuralları belirler.

> Yeni Binance entegrasyonu eklenirken (yeni endpoint, yeni veri kaynağı)
> trading kararı veren modüller davranışsal olarak aynı kalır; sadece veriyi
> nasıl aldıkları (queue, cache, WS, batch) bu dokümana uyar.

---

## 14. Gelecek Fazlar İçin Zorunlu Kontrol Listesi

Yeni bir faz, PR veya feature Binance API'yle temas ediyorsa **mutlaka**
aşağıdaki kontrol listesi geçilmeden onaylanmaz:

- [ ] Tüm yeni Binance çağrıları merkezi client üzerinden mi geçiyor?
- [ ] Yeni endpoint için TTL/cache stratejisi tanımlandı mı?
- [ ] Toplu endpoint mevcutsa tekil çağrı kullanılmıyor olduğu doğrulandı mı?
- [ ] WebSocket ile çözülebilen bir veri için REST polling kurulmadı mı?
- [ ] 429 / 418 / `Retry-After` davranışı client'ta zaten kapsanıyor; yeni
      kod bunu bypass edecek bir path açmıyor mu?
- [ ] Yeni endpoint'in resmi weight değeri biliniyor ve queue priority'si
      doğru atanmış mı?
- [ ] Single-flight / dedupe gerekiyorsa sağlandı mı?
- [ ] Order benzeri etkili çağrılarda idempotency (client order id) var mı?
- [ ] Retry sayısı sınırlı mı, exponential backoff + jitter uygulanıyor mu?
- [ ] Circuit breaker open iken bu kod nasıl davranıyor; dokümante edildi mi?
- [ ] Worker lock + tek-instance garantisi bozulmuyor mu?
- [ ] Risk engine, live trading gate ve `HARD_LIVE_TRADING_ALLOWED=false`
      gibi güvenlik bayrakları değiştirilmedi mi?
- [ ] Bu PR yalnızca bu dokümana referans veriyor; trading logic davranışını
      değiştirmiyor (trading davranış değişikliği gerekiyorsa **ayrı PR**).

> Bu liste değişmez. Madde silmek/zayıflatmak için bu doküman güncellenmeli
> ve mimari karar olarak ayrıca onaylanmalıdır.
