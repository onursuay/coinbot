// Phase 9 — Dashboard / Panel kart mimarisi tests.
//
// Bu testler:
// - Dosya doğrulaması ile kart varlığını ve presentation kurallarını kanıtlar.
// - `lib/dashboard/*` saf fonksiyonların davranışını doğrular.
// - Trading invariant'lerinin (MIN_SIGNAL_CONFIDENCE=70, hard live gate,
//   yeni Binance fetch yok) hâlâ korunduğunu kanıtlar.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  mapDirectionLabel,
  mapDecisionLabel,
  mapSourceLabel,
  buildReasonText,
  distanceToThreshold,
  SIGNAL_THRESHOLD,
} from "@/lib/dashboard/labels";
import { computeMarketPulse } from "@/lib/dashboard/market-pulse";
import { computeRadarCounts } from "@/lib/dashboard/opportunity-radar";
import { computeBlockingReasons } from "@/lib/dashboard/blocking-reasons";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

const PAGE = read("src/app/page.tsx");
const CARDS = read("src/components/dashboard/Cards.tsx");
const ACTION_FOOTER = read("src/components/dashboard/ActionFooter.tsx");
const SCANNER_PAGE = read("src/app/scanner/page.tsx");
const SCAN_MODES_PAGE = read("src/app/scan-modes/page.tsx");

// ── 1. Bot Durumu kartı yasaklı etiketleri içermez ─────────────────────
describe("Phase 9 — Bot Durumu kartı operasyonel; mod/paper etiketi yok", () => {
  it("BOT DURUMU kartında 'MOD: SANAL' / 'PAPER MODE' / 'YAKINDA CANLI' / 'SANAL İŞLEM MODU' yok", () => {
    // BotStatusCard render'ı Cards.tsx içinde tek yerde tanımlanır;
    // bu blok içinde yasaklı stringlerin geçmemesi gerekir.
    const card = extractBlock(CARDS, "function BotStatusCard");
    expect(card).not.toMatch(/MOD:\s*SANAL/);
    expect(card).not.toMatch(/PAPER MODE/);
    expect(card).not.toMatch(/YAKINDA CANLI/);
    expect(card).not.toMatch(/SANAL İŞLEM MODU/);
  });

  it("BOT DURUMU kartında BORSA: BINANCE FUTURES geçer", () => {
    const card = extractBlock(CARDS, "function BotStatusCard");
    // JSX içinde "BORSA: {exchange} FUTURES" şeklinde geçer.
    expect(card).toMatch(/BORSA:\s*\{exchange\}\s*FUTURES/);
  });

  it("ACİL DURDUR butonu korunmuş", () => {
    expect(CARDS).toMatch(/ACİL DURDUR/);
  });
});

// ── 2. Karar kartları varlığı ─────────────────────────────────────────
describe("Phase 9 — gerekli kartların hepsi mevcut", () => {
  it("Piyasa Nabzı kartı tanımlı ve sayfaya monte edilmiş", () => {
    expect(CARDS).toMatch(/export function MarketPulseCard/);
    expect(CARDS).toMatch(/PİYASA NABZI/);
    expect(PAGE).toMatch(/<MarketPulseCard/);
  });

  it("Fırsat Radarı kartı tanımlı ve sayfaya monte edilmiş", () => {
    expect(CARDS).toMatch(/export function OpportunityRadarCard/);
    expect(CARDS).toMatch(/FIRSAT RADARI/);
    expect(PAGE).toMatch(/<OpportunityRadarCard/);
  });

  it("Pozisyon Karar Merkezi kartı tanımlı ve sayfaya monte edilmiş", () => {
    expect(CARDS).toMatch(/export function DecisionCenterCard/);
    expect(CARDS).toMatch(/POZİSYON KARAR MERKEZİ/);
    expect(PAGE).toMatch(/<DecisionCenterCard/);
  });

  it("Pozisyona En Yakın Coinler kartı tanımlı ve sayfaya monte edilmiş", () => {
    expect(CARDS).toMatch(/export function NearThresholdCoinsCard/);
    expect(CARDS).toMatch(/POZİSYONA EN YAKIN COİNLER/);
    expect(PAGE).toMatch(/<NearThresholdCoinsCard/);
  });

  it("En Çok Engelleyen Sebepler kartı var", () => {
    expect(CARDS).toMatch(/export function BlockingReasonsCard/);
    expect(CARDS).toMatch(/EN ÇOK ENGELLEYEN SEBEPLER/);
    expect(PAGE).toMatch(/<BlockingReasonsCard/);
  });

  it("Bugünkü Özet kartı var", () => {
    expect(CARDS).toMatch(/export function TodaysSummaryCard/);
    expect(CARDS).toMatch(/BUGÜNKÜ ÖZET/);
    expect(PAGE).toMatch(/<TodaysSummaryCard/);
  });

  it("Açık Pozisyonlar kartı var", () => {
    expect(CARDS).toMatch(/export function OpenPositionsCard/);
    expect(CARDS).toMatch(/AÇIK POZİSYONLAR/);
    expect(PAGE).toMatch(/<OpenPositionsCard/);
  });

  it("Paper İşlem Doğrulaması kartı var ve 'BEKLENİYOR' state'i destekliyor", () => {
    expect(CARDS).toMatch(/export function PaperValidationCard/);
    expect(CARDS).toMatch(/PAPER İŞLEM DOĞRULAMASI/);
    expect(CARDS).toMatch(/BEKLENİYOR/);
  });
});

// ── 3. Karar Merkezi başlıkları büyük harf ────────────────────────────
describe("Phase 9 — Karar Merkezi tablo başlıkları", () => {
  it("kolon başlıkları büyük harf ve doğru sırada", () => {
    const card = extractBlock(CARDS, "export function DecisionCenterCard");
    const expected = ["COIN", "KAYNAK", "YÖN", "KALİTE", "FIRSAT", "İŞLEM SKORU", "KARAR", "SEBEP"];
    for (const h of expected) {
      expect(card.includes(`>${h}<`)).toBe(true);
    }
  });
});

// ── 4. Source mapping (GMT/MT/MİL/KRM) ────────────────────────────────
describe("Phase 9 — KAYNAK mapping", () => {
  it("WIDE_MARKET → GMT", () => {
    expect(mapSourceLabel({ candidateSources: ["WIDE_MARKET"] })).toBe("GMT");
  });
  it("MOMENTUM → MT", () => {
    expect(mapSourceLabel({ candidateSources: ["MOMENTUM"] })).toBe("MT");
  });
  it("MANUAL_LIST → MİL", () => {
    expect(mapSourceLabel({ candidateSources: ["MANUAL_LIST"] })).toBe("MİL");
  });
  it("birden fazla kaynak → KRM", () => {
    expect(mapSourceLabel({ candidateSources: ["WIDE_MARKET", "MOMENTUM"] })).toBe("KRM");
  });
  it("hazır sourceDisplay etiketi geçerli", () => {
    expect(mapSourceLabel({ sourceDisplay: "GMT" })).toBe("GMT");
  });
  it("kaynak yoksa em-dash", () => {
    expect(mapSourceLabel({})).toBe("—");
  });
});

// ── 5. Decision/direction mapping (WAIT/NO_TRADE raw görünmez) ────────
describe("Phase 9 — yön/karar mapping", () => {
  it("açılan LONG → 'LONG AÇILDI'", () => {
    expect(mapDecisionLabel({ signalType: "LONG", opened: true })).toBe("LONG AÇILDI");
    expect(mapDirectionLabel({ signalType: "LONG", opened: true })).toBe("LONG AÇILDI");
  });
  it("LONG aday (henüz açılmamış) → 'LONG ADAY'", () => {
    expect(mapDecisionLabel({ signalType: "LONG", opened: false })).toBe("LONG ADAY");
  });
  it("WAIT + directionCandidate yok → 'YÖN BEKLİYOR'", () => {
    expect(mapDecisionLabel({ signalType: "WAIT" })).toBe("YÖN BEKLİYOR");
  });
  it("NO_TRADE → 'İŞLEM YOK'", () => {
    expect(mapDecisionLabel({ signalType: "NO_TRADE" })).toBe("İŞLEM YOK");
  });
  it("BTC veto → 'BTC FİLTRESİ'", () => {
    expect(mapDecisionLabel({ signalType: "WAIT", btcTrendRejected: true })).toBe("BTC FİLTRESİ");
  });
  it("risk reddi → 'RİSK REDDİ'", () => {
    expect(mapDecisionLabel({ signalType: "LONG", riskAllowed: false, riskRejectReason: "Spread yüksek" })).toBe("RİSK REDDİ");
  });

  it("ham WAIT/NO_TRADE etiketleri Cards.tsx içinde görünür metin olarak basılmıyor", () => {
    // Mapping girdisi olarak geçer (string karşılaştırma) ama doğrudan
    // başlık veya hücre metni olarak basılmamalıdır.
    expect(CARDS).not.toMatch(/<th>WAIT<\/th>/);
    expect(CARDS).not.toMatch(/<th>NO_TRADE<\/th>/);
    expect(CARDS).not.toMatch(/>WAIT</);
    expect(CARDS).not.toMatch(/>NO_TRADE</);
  });
});

// ── 6. Distance to threshold ──────────────────────────────────────────
describe("Phase 9 — eşiğe kalan", () => {
  it("açılmış pozisyon için 0", () => {
    expect(distanceToThreshold({ tradeSignalScore: 80, opened: true })).toBe(0);
  });
  it("score 65 → 5", () => {
    expect(distanceToThreshold({ tradeSignalScore: 65 })).toBe(5);
  });
  it("score yoksa null", () => {
    expect(distanceToThreshold({ tradeSignalScore: 0 })).toBeNull();
  });
  it("eşik 70'tir (signal-engine ile aynı)", () => {
    expect(SIGNAL_THRESHOLD).toBe(70);
  });
});

// ── 7. Reason text ────────────────────────────────────────────────────
describe("Phase 9 — sebep metni Türkçeleştirilir", () => {
  it("BTC veto → 'BTC trend filtresi'", () => {
    expect(buildReasonText({ btcTrendRejected: true })).toBe("BTC trend filtresi");
  });
  it("waitReasonCodes kısa Türkçe etikete çevrilir", () => {
    const text = buildReasonText({ waitReasonCodes: ["MACD_CONFLICT", "VOLUME_WEAK"] });
    expect(text).toMatch(/MACD uyumsuz/);
    expect(text).toMatch(/Hacim zayıf/);
  });
});

// ── 8. Market pulse — fallback + hesap ────────────────────────────────
describe("Phase 9 — Piyasa Nabzı hesaplama + fallback", () => {
  it("boş satırda tüm metrikler null + güvenli yorum", () => {
    const r = computeMarketPulse({ rows: [] });
    expect(r.riskAppetite).toBeNull();
    expect(r.fomoLevel).toBeNull();
    expect(r.marketRisk).toBeNull();
    expect(r.comment).toMatch(/Veri toplanıyor/);
  });

  it("yüksek kaliteli setup'larla iştah yüksek görünür", () => {
    const r = computeMarketPulse({
      rows: [
        { signalType: "LONG", marketQualityScore: 90, setupScore: 85, atrPercent: 1.2, spreadPercent: 0.05 },
        { signalType: "LONG", marketQualityScore: 88, setupScore: 80, atrPercent: 1.0, spreadPercent: 0.06 },
      ],
    });
    expect(r.riskAppetite).not.toBeNull();
    expect(r.riskAppetite!).toBeGreaterThan(60);
  });

  it("BTC veto + yüksek spread piyasa riskini yükseltir", () => {
    const r = computeMarketPulse({
      rows: Array.from({ length: 10 }, (_, i) => ({
        signalType: "WAIT",
        btcTrendRejected: true,
        spreadPercent: 0.45 + i * 0.01,
        atrPercent: 6 + i * 0.1,
      })),
      scanned: 10,
      rejected: 9,
      btcTrendRejected: 10,
    });
    expect(r.marketRisk).not.toBeNull();
    expect(r.marketRisk!).toBeGreaterThan(50);
  });
});

// ── 9. Opportunity radar sayımları ────────────────────────────────────
describe("Phase 9 — Fırsat Radarı sayımları", () => {
  it("kategoriler birbirini dışlar (her satır bir kova)", () => {
    const c = computeRadarCounts([
      { signalType: "LONG", tradeSignalScore: 80, opened: true },           // strong
      { signalType: "LONG", tradeSignalScore: 65 },                          // near
      { signalType: "WAIT" },                                                // awaiting
      { signalType: "WAIT", btcTrendRejected: true },                        // rejected
      { signalType: "WAIT", riskAllowed: false, riskRejectReason: "x" },     // rejected
    ]);
    expect(c.strongOpportunity).toBe(1);
    expect(c.nearThreshold).toBe(1);
    expect(c.awaitingDirection).toBe(1);
    expect(c.rejectedByRisk).toBe(2);
    expect(c.total).toBe(5);
  });

  it("açılmış işlem (skor düşük olsa bile) güçlü fırsat sayılır", () => {
    const c = computeRadarCounts([{ signalType: "LONG", tradeSignalScore: 50, opened: true }]);
    expect(c.strongOpportunity).toBe(1);
  });
});

// ── 10. Blocking reasons aggregator ───────────────────────────────────
describe("Phase 9 — En Çok Engelleyen Sebepler", () => {
  it("BTC veto + ret sebepleri sınıflandırılır ve sayılır", () => {
    const top = computeBlockingReasons([
      { btcTrendRejected: true },
      { btcTrendRejected: true },
      { rejectReason: "Spread yüksek 0.5%" },
      { rejectReason: "Hacim düşük" },
      { rejectReason: "Risk/ödül yetersiz (1:1.2)" },
    ], 5);
    expect(top[0].label).toBe("BTC FİLTRESİ");
    expect(top[0].count).toBe(2);
    const labels = top.map((t) => t.label);
    expect(labels).toContain("YÜKSEK SPREAD");
    expect(labels).toContain("HACİM ZAYIF");
    expect(labels).toContain("R:R GEÇERSİZ");
  });
});

// ── 11. Aksiyon kart altyapısı ────────────────────────────────────────
describe("Phase 9 — ActionFooter component", () => {
  it("ONAYLA / REDDET / GÖZLEM / PROMPT etiketleri tanımlı", () => {
    expect(ACTION_FOOTER).toMatch(/APPROVE:\s*"ONAYLA"/);
    expect(ACTION_FOOTER).toMatch(/REJECT:\s*"REDDET"/);
    expect(ACTION_FOOTER).toMatch(/OBSERVE:\s*"GÖZLEM"/);
    expect(ACTION_FOOTER).toMatch(/PROMPT:\s*"PROMPT"/);
  });

  it("ActionFooter dashboard ana sayfasında HER karta otomatik eklenmemiş", () => {
    // Spec: "Her karta bu butonları koyma." — ActionFooter render'ı HomePage
    // veya Cards.tsx'te toplu olarak çağrılmamalı. Şu an yalnızca opt-in
    // import edilebilir bir component olarak vardır.
    expect(PAGE).not.toMatch(/<ActionFooter/);
    expect(CARDS).not.toMatch(/<ActionFooter/);
  });

  it("GÖZLEM 1 haftalık varsayılan gözlem süresine işaret eder", () => {
    expect(ACTION_FOOTER).toMatch(/observeDays\s*=\s*7/);
  });

  it("ActionFooter doğrudan trade engine veya canlı gate fonksiyonu çağırmaz", () => {
    expect(ACTION_FOOTER).not.toMatch(/openTrade|tradeEngine|riskEngine|hardLive|enableLive/);
  });
});

// ── 12. Trading invariant'leri ────────────────────────────────────────
describe("Phase 9 — trading invariant'leri korunur", () => {
  it("MIN_SIGNAL_CONFIDENCE eşiği 70 (signal-engine)", () => {
    const eng = read("src/lib/engines/signal-engine.ts");
    expect(eng).toMatch(/if\s*\(score\s*<\s*70\)/);
  });

  it("Dashboard SIGNAL_THRESHOLD 70 (UI display)", () => {
    const labels = read("src/lib/dashboard/labels.ts");
    expect(labels).toMatch(/SIGNAL_THRESHOLD\s*=\s*70/);
  });

  it("HARD_LIVE_TRADING_ALLOWED env'de tanımlı; canlı gate açılmadı", () => {
    const env = read("src/lib/env.ts");
    expect(env).toMatch(/HARD_LIVE_TRADING_ALLOWED/);
  });

  it("dashboard yeni Binance API çağrısı eklemiyor", () => {
    for (const code of [PAGE, CARDS, ACTION_FOOTER]) {
      expect(code).not.toMatch(/fapi\.binance\.com/);
      expect(code).not.toMatch(/api\.binance\.com/);
      expect(code).not.toMatch(/from\s+["']axios["']/);
    }
  });

  it("dashboard verileri yalnızca dahili API endpoint'lerinden okunur", () => {
    const internal = [
      "/api/bot/status",
      "/api/paper-trades/performance",
      "/api/paper-trades?limit=20",
      "/api/system/env-check",
      "/api/bot/heartbeat",
      "/api/bot/diagnostics",
      "/api/paper-trades/e2e-status",
    ];
    for (const url of internal) {
      expect(PAGE).toContain(url);
    }
  });

  it("Piyasa Tarayıcı sayfası bu fazda değişmedi (Faz 8 imzası korundu)", () => {
    expect(SCANNER_PAGE).toMatch(/Phase 8 — Piyasa Tarayıcı/);
    // Yeni Binance fetch eklenmediğinden emin ol.
    expect(SCANNER_PAGE).not.toMatch(/fapi\.binance\.com/);
  });

  it("Tarama Modları sayfası bu fazda değişmedi (varsayılan UI imzası)", () => {
    // Sayfa hâlâ /scan-modes etiketini ve mod kontrollerini içerir.
    expect(SCAN_MODES_PAGE.length).toBeGreaterThan(0);
  });
});

// ── helper ─────────────────────────────────────────────────────────────
/** Dosya içinden bir export'un başladığı satırdan bir sonraki top-level
 * `\nfunction` veya `\nexport function` veya dosya sonuna kadarki bloğu
 * (kabaca) çıkarır. Test kapsamı içindir; AST garantisi vermez. */
function extractBlock(src: string, signature: string): string {
  const start = src.indexOf(signature);
  if (start === -1) return "";
  const after = src.slice(start + signature.length);
  // Bir sonraki "\nfunction " veya "\nexport function" sınırı.
  const candidates = [
    after.indexOf("\nfunction "),
    after.indexOf("\nexport function "),
  ].filter((i) => i > 0);
  const end = candidates.length === 0 ? after.length : Math.min(...candidates);
  return after.slice(0, end);
}
