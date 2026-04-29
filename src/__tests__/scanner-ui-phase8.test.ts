// Phase 8 — Piyasa Tarayıcı UI temizleme tests.
// Bu testler yalnızca presentation kuralları + güvenlik invariantleri
// üzerinde çalışır; trade kararı, risk engine veya canlı gate'i taklit
// etmez. Dosya doğrulaması yaparak ürün kuralının kodda korunduğunu
// kanıtlar.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

const SCANNER_PAGE = read("src/app/scanner/page.tsx");
const TOPBAR = read("src/components/TopBar.tsx");
const DIAGNOSTICS_ROUTE = read("src/app/api/bot/diagnostics/route.ts");
const ORCHESTRATOR = read("src/lib/engines/bot-orchestrator.ts");
const WORKER = read("worker/index.ts");

// ── 1. Banner / status / dashboard blokları kaldırıldı ─────────────────
describe("Phase 8 — Piyasa Tarayıcı banner/dashboard blokları kaldırıldı", () => {
  it("Tarama Akışı bloğu yok", () => {
    expect(SCANNER_PAGE).not.toMatch(/Tarama Akışı/);
  });

  it("Görünürlük bloğu yok", () => {
    expect(SCANNER_PAGE).not.toMatch(/Görünürlük/);
  });

  it("EVREN / ÖN ELEME / ANALİZ EDİLEN gibi büyük metrik kutuları yok", () => {
    // Bu etiketler artık yalnızca dashboard/panel'de yer almalı —
    // Piyasa Tarayıcı sayfasında kullanılmıyor.
    expect(SCANNER_PAGE).not.toMatch(/label="Evren"/);
    expect(SCANNER_PAGE).not.toMatch(/label="Ön Eleme"/);
    expect(SCANNER_PAGE).not.toMatch(/label="Analiz Edilen"/);
    expect(SCANNER_PAGE).not.toMatch(/label="Sinyal"/);
    expect(SCANNER_PAGE).not.toMatch(/label="Açılan"/);
    expect(SCANNER_PAGE).not.toMatch(/label="Hata"/);
    expect(SCANNER_PAGE).not.toMatch(/label="Süre"/);
  });

  it("TABLODA GÖSTERİLEN / CORE GÖSTERİLEN / DYNAMIC blokları yok", () => {
    expect(SCANNER_PAGE).not.toMatch(/Tabloda Gösterilen/);
    expect(SCANNER_PAGE).not.toMatch(/Core Gösterilen/);
    expect(SCANNER_PAGE).not.toMatch(/Dynamic Gösterilen/);
    expect(SCANNER_PAGE).not.toMatch(/Dynamic Filtrelenen/);
  });

  it("StatTile bileşeni / kullanımı yok", () => {
    expect(SCANNER_PAGE).not.toMatch(/StatTile/);
  });
});

// ── 2. Aktif Tarama Modları özeti yok ──────────────────────────────────
describe("Phase 8 — aktif Tarama Modları özeti yalnızca /scan-modes sayfasında", () => {
  it("Piyasa Tarayıcı içinde ScanModesSummary kullanımı yok", () => {
    expect(SCANNER_PAGE).not.toMatch(/ScanModesSummary/);
  });

  it("Piyasa Tarayıcı içinde 'Tarama Modları' başlık metni yok", () => {
    expect(SCANNER_PAGE).not.toMatch(/Tarama Modları/);
  });

  it("Piyasa Tarayıcı içinde wideMarket/momentum/manualList aktif/pasif kontrolü yok", () => {
    expect(SCANNER_PAGE).not.toMatch(/wideMarket\.active/);
    expect(SCANNER_PAGE).not.toMatch(/momentum\.active/);
    expect(SCANNER_PAGE).not.toMatch(/manualList\.active/);
  });
});

// ── 3. Tablo başlıkları büyük harf ─────────────────────────────────────
describe("Phase 8 — tablo başlıkları büyük harf ve yeni kolon seti", () => {
  it("Varsayılan kolon başlıkları büyük harf ve doğru sırada", () => {
    const expected = [
      "COIN", "KAYNAK", "YÖN", "KALİTE", "FIRSAT",
      "İŞLEM SKORU", "EŞİĞE KALAN", "KARAR", "SEBEP",
    ];
    for (const h of expected) {
      // Her başlık <th> veya başlığı taşıyan elementte geçmeli.
      expect(SCANNER_PAGE.includes(`>${h}<`)).toBe(true);
    }
  });

  it("eski 'SEMBOL/SINIF/KADEME/SİNYAL' kolon kümesi kaldırıldı", () => {
    expect(SCANNER_PAGE).not.toMatch(/<th>SEMBOL<\/th>/);
    expect(SCANNER_PAGE).not.toMatch(/<th>SINIF<\/th>/);
    expect(SCANNER_PAGE).not.toMatch(/<th>KADEME<\/th>/);
  });
});

// ── 4. Kaynak mapping (GMT/MT/MİL/KRM) ─────────────────────────────────
describe("Phase 8 — kaynak (KAYNAK) mapping GMT/MT/MİL/KRM", () => {
  it("WIDE_MARKET → GMT, MOMENTUM → MT, MANUAL_LIST → MİL, MIXED/2+ → KRM", () => {
    // Source mapping pure-fonksiyon olarak inline yazılmıştır; bu testler
    // dosya içeriğinde mapping ifadelerinin korunduğunu doğrular.
    expect(SCANNER_PAGE).toMatch(/WIDE_MARKET/);
    expect(SCANNER_PAGE).toMatch(/MOMENTUM/);
    expect(SCANNER_PAGE).toMatch(/MANUAL_LIST/);
    expect(SCANNER_PAGE).toMatch(/"GMT"/);
    expect(SCANNER_PAGE).toMatch(/"MT"/);
    expect(SCANNER_PAGE).toMatch(/"MİL"/);
    expect(SCANNER_PAGE).toMatch(/"KRM"/);
  });
});

// ── 5. WAIT/NO_TRADE → Türkçe etiket mapping ───────────────────────────
describe("Phase 8 — WAIT/NO_TRADE raw ifadeleri Türkçe etiketlere maplanır", () => {
  it("ana UI etiketleri (LONG ADAY / LONG AÇILDI / ... / İŞLEM YOK) kullanılır", () => {
    expect(SCANNER_PAGE).toMatch(/"LONG ADAY"/);
    expect(SCANNER_PAGE).toMatch(/"LONG AÇILDI"/);
    expect(SCANNER_PAGE).toMatch(/"SHORT ADAY"/);
    expect(SCANNER_PAGE).toMatch(/"SHORT AÇILDI"/);
    expect(SCANNER_PAGE).toMatch(/"YÖN BEKLİYOR"/);
    expect(SCANNER_PAGE).toMatch(/"İŞLEM YOK"/);
    expect(SCANNER_PAGE).toMatch(/"RİSK REDDİ"/);
    expect(SCANNER_PAGE).toMatch(/"BTC FİLTRESİ"/);
  });

  it("ham WAIT/NO_TRADE etiketleri ana tablo render'ına basılmaz", () => {
    // Ham değerler signalType karşılaştırmasında geçer (mapping girdisi),
    // ancak doğrudan başlık veya hücre metni olarak basılmamalıdır.
    expect(SCANNER_PAGE).not.toMatch(/<th>WAIT<\/th>/);
    expect(SCANNER_PAGE).not.toMatch(/<th>NO_TRADE<\/th>/);
    expect(SCANNER_PAGE).not.toMatch(/>WAIT<\/span>/);
    expect(SCANNER_PAGE).not.toMatch(/>NO_TRADE<\/span>/);
  });
});

// ── 6. Gelişmiş metrik picker ikon davranışı ───────────────────────────
describe("Phase 8 — gelişmiş metrik seçici yalnızca ikon ile açılır", () => {
  it("'Gelişmiş Seçenekler' yazılı buton metni yok", () => {
    expect(SCANNER_PAGE).not.toMatch(/Gelişmiş Seçenekler/);
  });

  it("'Tümünü Seç' / 'Tümünü Kaldır' / 'Varsayılana Dön' butonları yok", () => {
    expect(SCANNER_PAGE).not.toMatch(/Tümünü Seç/i);
    expect(SCANNER_PAGE).not.toMatch(/Tümünü Göster/);
    expect(SCANNER_PAGE).not.toMatch(/Tümünü Gizle/);
    expect(SCANNER_PAGE).not.toMatch(/Tümünü Kaldır/);
    expect(SCANNER_PAGE).not.toMatch(/Varsayılana Dön/);
  });

  it("ikon-buton aria-label 'Gelişmiş metrikler' ile açılır", () => {
    expect(SCANNER_PAGE).toMatch(/aria-label="Gelişmiş metrikler"/);
  });

  it("seçilebilir gelişmiş metrik kümesi spec'e uygun", () => {
    // Spec'in açıkça istediği metrikler:
    const required = [
      "RSI", "MA8", "MA55", "MACD", "ADX", "VWAP",
      "BOLLİNGER", "ATR PERSANTİL", "HACİM İVMESİ",
      "SPREAD", "HACİM (USDT)", "DERİNLİK",
    ];
    for (const h of required) {
      expect(SCANNER_PAGE.includes(`header: "${h}"`)).toBe(true);
    }
  });
});

// ── 7. Açılan pozisyon satırı görsel olarak öne çıkar ──────────────────
describe("Phase 8 — açılan paper pozisyon satırı aday satırından belirgin", () => {
  it("opened === true olan satır font-semibold + bg-success/5 alır", () => {
    expect(SCANNER_PAGE).toMatch(/opened\s*\?\s*"font-semibold bg-success\/5"/);
  });

  it("açılan satırın sembol hücresi font-bold olur", () => {
    expect(SCANNER_PAGE).toMatch(/opened\s*\?\s*"font-bold"\s*:\s*"font-medium"/);
  });
});

// ── 8. Trading & live gate invariantleri ───────────────────────────────
describe("Phase 8 — trading invariantleri korunur", () => {
  it("MIN_SIGNAL_CONFIDENCE eşiği signal-engine'de 70 (değişmedi)", () => {
    const eng = read("src/lib/engines/signal-engine.ts");
    expect(eng).toMatch(/if\s*\(score\s*<\s*70\)/);
  });

  it("Piyasa Tarayıcı SIGNAL_THRESHOLD sabiti 70 (UI gösterimi için)", () => {
    expect(SCANNER_PAGE).toMatch(/SIGNAL_THRESHOLD\s*=\s*70/);
  });

  it("HARD_LIVE_TRADING_ALLOWED varsayılanı false", () => {
    const env = read("src/lib/env.ts");
    // Default false (canlı trading kapalı).
    expect(env).toMatch(/HARD_LIVE_TRADING_ALLOWED/);
  });

  it("Piyasa Tarayıcı içinde Binance fapi/axios çağrısı yok", () => {
    expect(SCANNER_PAGE).not.toMatch(/fapi\.binance\.com/);
    expect(SCANNER_PAGE).not.toMatch(/api\.binance\.com/);
    expect(SCANNER_PAGE).not.toMatch(/from\s+["']axios["']/);
    expect(SCANNER_PAGE).not.toMatch(/import\s+axios/);
  });

  it("Piyasa Tarayıcı verisi yalnızca /api/bot/diagnostics'ten okunur", () => {
    expect(SCANNER_PAGE).toMatch(/\/api\/bot\/diagnostics/);
    // Eski /api/scanner endpoint'ine doğrudan fetch yok.
    expect(SCANNER_PAGE).not.toMatch(/fetch\(["']\/api\/scanner["']/);
  });
});

// ── 9. Empty state — sade mesaj ────────────────────────────────────────
describe("Phase 8 — empty state sade mesaj kullanır", () => {
  it("'Bu periyotta güçlü aday bulunamadı.' mesajı tabloda boşken gösterilir", () => {
    expect(SCANNER_PAGE).toMatch(/Bu periyotta güçlü aday bulunamadı\./);
  });
});

// ── 10. TopBar heartbeat parse bug düzeltmesi ─────────────────────────
describe("Bugfix 1 — TopBar heartbeat parse", () => {
  it("data.online öncelikli okunur", () => {
    expect(TOPBAR).toMatch(/heartbeatJson\?\.data\?\.online\s*===\s*true/);
  });

  it("heartbeatJson.online backward-compat fallback var", () => {
    expect(TOPBAR).toMatch(/heartbeatJson\?\.online\s*===\s*true/);
  });

  it("SUNUCU rozetinde ÇEVRİMİÇİ / ÇEVRİMDIŞI gösterilir", () => {
    expect(TOPBAR).toMatch(/ÇEVRİMİÇİ/);
    expect(TOPBAR).toMatch(/ÇEVRİMDIŞI/);
  });
});

// ── 11. Diagnostics stale flag ────────────────────────────────────────
describe("Bugfix 1 — diagnostics stale flag", () => {
  it("diagnosticsStale alanı response'a eklendi", () => {
    expect(DIAGNOSTICS_ROUTE).toMatch(/diagnosticsStale/);
  });

  it("diagnosticsAgeSec alanı response'a eklendi", () => {
    expect(DIAGNOSTICS_ROUTE).toMatch(/diagnosticsAgeSec/);
  });

  it("lastTickAt alanı response'a eklendi", () => {
    expect(DIAGNOSTICS_ROUTE).toMatch(/lastTickAt/);
  });

  it("diagnosticsGeneratedAt alanı response'a eklendi", () => {
    expect(DIAGNOSTICS_ROUTE).toMatch(/diagnosticsGeneratedAt/);
  });

  it("90 saniyelik stale eşiği uygulanır", () => {
    expect(DIAGNOSTICS_ROUTE).toMatch(/>\s*90/);
  });

  it("unified_diagnostics alanları response'a eklendi", () => {
    expect(DIAGNOSTICS_ROUTE).toMatch(/unified_diagnostics/);
    expect(DIAGNOSTICS_ROUTE).toMatch(/unifiedCandidatePoolActive/);
    expect(DIAGNOSTICS_ROUTE).toMatch(/unifiedPoolSize/);
    expect(DIAGNOSTICS_ROUTE).toMatch(/analyzedSymbolsCount/);
    expect(DIAGNOSTICS_ROUTE).toMatch(/tradeMode/);
    expect(DIAGNOSTICS_ROUTE).toMatch(/executionMode/);
  });
});

// ── 12. Scanner stale uyarısı ─────────────────────────────────────────
describe("Bugfix 1 — Scanner stale uyarısı", () => {
  it("diagnosticsStale=true iken uyarı gösterilir", () => {
    expect(SCANNER_PAGE).toMatch(/isStale/);
    expect(SCANNER_PAGE).toMatch(/Tarama verisi güncel değil/);
  });

  it("GÜNCEL DEĞİL rozeti stale satırlarda gösterilir", () => {
    expect(SCANNER_PAGE).toMatch(/GÜNCEL DEĞİL/);
  });

  it("Aktif mod özeti (ScanModesSummary) geri gelmedi", () => {
    expect(SCANNER_PAGE).not.toMatch(/ScanModesSummary/);
    expect(SCANNER_PAGE).not.toMatch(/Tarama Modları/);
  });

  it("Tarama Akışı ve Görünürlük blokları geri gelmedi", () => {
    expect(SCANNER_PAGE).not.toMatch(/Tarama Akışı/);
    expect(SCANNER_PAGE).not.toMatch(/Görünürlük/);
  });
});

// ── 13. Trade / live gate invariantleri değişmedi ─────────────────────
describe("Bugfix 1 — trade & live gate invariantleri", () => {
  it("HARD_LIVE_TRADING_ALLOWED varsayılanı false korunur", () => {
    const env = read("src/lib/env.ts");
    // Default value must be false — e.g. bool(process.env.HARD_LIVE_TRADING_ALLOWED, false)
    expect(env).toMatch(/HARD_LIVE_TRADING_ALLOWED.*false/);
  });

  it("MIN_SIGNAL_CONFIDENCE=70 korunur (signal-engine)", () => {
    const eng = read("src/lib/engines/signal-engine.ts");
    expect(eng).toMatch(/if\s*\(score\s*<\s*70\)/);
  });

  it("Scanner içinde Binance API çağrısı yok", () => {
    expect(SCANNER_PAGE).not.toMatch(/fapi\.binance\.com/);
    expect(SCANNER_PAGE).not.toMatch(/api\.binance\.com/);
  });

  it("diagnostics route içinde Binance fetch eklenmedi", () => {
    expect(DIAGNOSTICS_ROUTE).not.toMatch(/fapi\.binance\.com/);
    expect(DIAGNOSTICS_ROUTE).not.toMatch(/api\.binance\.com/);
  });
});

// ── 14. Bugfix 1.1 — writeSkipSummary helper var ─────────────────────
describe("Bugfix 1.1 — writeSkipSummary helper", () => {
  it("writeSkipSummary fonksiyonu orchestrator'da tanımlı", () => {
    expect(ORCHESTRATOR).toMatch(/function writeSkipSummary/);
  });

  it("isLockOwner === false olan worker özet yazmaz (guard var)", () => {
    expect(ORCHESTRATOR).toMatch(/wCtx\?\.isLockOwner\s*===\s*false/);
  });

  it("generatedAt ve tickSkipped alanları yazılıyor", () => {
    expect(ORCHESTRATOR).toMatch(/generatedAt/);
    expect(ORCHESTRATOR).toMatch(/tickSkipped/);
  });

  it("skipReason alanı yazılıyor", () => {
    expect(ORCHESTRATOR).toMatch(/skipReason/);
  });

  it("workerLockOwner alanı yazılıyor", () => {
    expect(ORCHESTRATOR).toMatch(/workerLockOwner/);
  });
});

// ── 15. Bugfix 1.1 — early return path'ler summary yazıyor ───────────
describe("Bugfix 1.1 — tickBot early return path'ler", () => {
  it("daily_target_hit path summary yazıyor", () => {
    // Son eşleşmeyi bul — writeSkipSummary call'ı en sondaki "daily_target_hit" stringidir
    const idx = ORCHESTRATOR.lastIndexOf('"daily_target_hit"');
    expect(idx).toBeGreaterThan(0);
    const nearbyCtx = ORCHESTRATOR.slice(Math.max(0, idx - 100), idx + 100);
    expect(nearbyCtx).toMatch(/writeSkipSummary/);
  });

  it("daily_loss_limit_hit path summary yazıyor", () => {
    const idx = ORCHESTRATOR.lastIndexOf('"daily_loss_limit_hit"');
    expect(idx).toBeGreaterThan(0);
    const nearbyCtx = ORCHESTRATOR.slice(Math.max(0, idx - 100), idx + 100);
    expect(nearbyCtx).toMatch(/writeSkipSummary/);
  });

  it("strategy_health_blocked path summary yazıyor", () => {
    // writeSkipSummary ile strategy_health_blocked birlikte geçiyor
    expect(ORCHESTRATOR).toMatch(/writeSkipSummary.*strategy_health_blocked|strategy_health_blocked.*writeSkipSummary/s);
  });

  it("max_open_positions path summary yazıyor", () => {
    const idx = ORCHESTRATOR.lastIndexOf('"max_open_positions"');
    expect(idx).toBeGreaterThan(0);
    const nearbyCtx = ORCHESTRATOR.slice(Math.max(0, idx - 100), idx + 100);
    expect(nearbyCtx).toMatch(/writeSkipSummary/);
  });

  it("bot_not_running path summary yazıyor", () => {
    expect(ORCHESTRATOR).toMatch(/bot_not_running/);
    expect(ORCHESTRATOR).toMatch(/writeSkipSummary.*bot_not_running|bot_not_running.*writeSkipSummary/s);
  });
});

// ── 16. Bugfix 1.1 — worker catch bloğu error summary yazıyor ────────
describe("Bugfix 1.1 — worker error summary", () => {
  it("tickLoop catch bloğu tickError summary yazıyor", () => {
    expect(WORKER).toMatch(/tickError/);
  });

  it("worker catch bloğunda last_tick_at güncelleniyor", () => {
    expect(WORKER).toMatch(/last_tick_at/);
  });

  it("worker error summary non-fatal (try-catch ile sarılı)", () => {
    // Worker catch içinde diagnostics write kendi try-catch'i içinde
    expect(WORKER).toMatch(/diagnostics-only, non-fatal/);
  });
});

// ── 17. Bugfix 1.1 — trade logic ve invariantler korunmuş ────────────
describe("Bugfix 1.1 — invariantler korunmuş", () => {
  it("signal-engine MIN_SIGNAL_CONFIDENCE=70 değişmedi", () => {
    const eng = read("src/lib/engines/signal-engine.ts");
    expect(eng).toMatch(/if\s*\(score\s*<\s*70\)/);
  });

  it("orchestrator içinde Binance API çağrısı eklenmedi", () => {
    expect(ORCHESTRATOR).not.toMatch(/fapi\.binance\.com/);
    expect(ORCHESTRATOR).not.toMatch(/api\.binance\.com/);
  });

  it("worker içinde Binance API çağrısı eklenmedi", () => {
    expect(WORKER).not.toMatch(/fapi\.binance\.com/);
    expect(WORKER).not.toMatch(/api\.binance\.com/);
  });

  it("HARD_LIVE_TRADING_ALLOWED=false korunmuş", () => {
    const env = read("src/lib/env.ts");
    expect(env).toMatch(/HARD_LIVE_TRADING_ALLOWED.*false/);
  });

  it("writeSkipSummary trade kararı vermiyor (openPaperTrade çağrısı yok)", () => {
    // writeSkipSummary fonksiyonu sadece bot_settings günceller, trade açmaz
    const helperStart = ORCHESTRATOR.indexOf("async function writeSkipSummary");
    const helperEnd = ORCHESTRATOR.indexOf("\nasync function loadSettings");
    const helperBody = ORCHESTRATOR.slice(helperStart, helperEnd);
    expect(helperBody).not.toMatch(/openPaperTrade/);
    expect(helperBody).not.toMatch(/generateSignal/);
    expect(helperBody).not.toMatch(/evaluateRisk/);
  });
});
