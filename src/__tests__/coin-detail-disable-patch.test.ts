// Coin Detail Disable Patch — pin the regression.
//
// Coin Detay sayfası piyasa/mum/sinyal verisi güvenilir hale gelene kadar
// kullanıcıya gösterilmiyor. Bu test:
//   • Sidebar'da "Coin Detayı" entry'si bulunmadığını,
//   • Scanner'da coin sembolünün artık /coins linki olmadığını,
//   • /coins ve /coins/[symbol] route'larının "devre dışı" mesajı
//     gösterip yönlendirme verdiğini,
//   • Coin detail sayfalarının ticker/candles/signal generate çağrısı
//     yapmadığını,
//   • Trade/live gate invariant'larının değişmediğini doğrular.
//
// Trade engine, signal engine, risk engine ve canlı trading gate bu
// patch'ten etkilenmez.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf-8");

describe("Coin Detail Disable Patch", () => {
  it("Sidebar'da 'Coin Detayı' entry'si yok", () => {
    const sidebar = read("src/components/Sidebar.tsx");
    expect(sidebar).not.toMatch(/label:\s*['"]Coin Detayı['"]/);
    expect(sidebar).not.toMatch(/href:\s*['"]\/coins['"]/);
  });

  it("Scanner coin sembolü artık /coins linki içermez", () => {
    const scanner = read("src/app/scanner/page.tsx");
    // Hiçbir <Link href="/coins/..."> yok
    expect(scanner).not.toMatch(/href=\{?[^}]*\/coins\//);
    // r.symbol artık <span> içinde, <Link> içinde değil
    expect(scanner).not.toMatch(/<Link[^>]*\/coins/);
    // next/link import'u kaldırıldı (başka kullanımı yoktu)
    expect(scanner).not.toMatch(/from\s+["']next\/link["']/);
  });

  it("/coins/[symbol] route'u devre dışı mesajı gösterir", () => {
    const page = read("src/app/coins/[symbol]/page.tsx");
    expect(page).toMatch(/Coin Detay geçici olarak devre dışı/);
    expect(page).toMatch(/Piyasa Tarayıcıya dön/);
    expect(page).toMatch(/href="\/scanner"/);
  });

  it("/coins index sayfası devre dışı mesajı gösterir", () => {
    const page = read("src/app/coins/page.tsx");
    expect(page).toMatch(/Coin Detay geçici olarak devre dışı/);
    expect(page).toMatch(/Piyasa Tarayıcıya dön/);
    expect(page).toMatch(/href="\/scanner"/);
  });

  it("Coin detail sayfaları ticker/candles/funding/signal generate çağırmaz", () => {
    const symbolPage = read("src/app/coins/[symbol]/page.tsx");
    const indexPage = read("src/app/coins/page.tsx");

    // Hiçbir API endpoint'i fetch edilmiyor
    for (const src of [symbolPage, indexPage]) {
      expect(src).not.toMatch(/\/api\/market\/klines/);
      expect(src).not.toMatch(/\/api\/market\/ticker/);
      expect(src).not.toMatch(/\/api\/market\/funding-rate/);
      expect(src).not.toMatch(/\/api\/market\/symbols/);
      expect(src).not.toMatch(/\/api\/signals\/generate/);
      // useEffect ile fetch tetiklenmiyor
      expect(src).not.toMatch(/fetch\(/);
    }
  });

  it("Trade engine + live gate invariant'ları değişmedi", () => {
    const env = read("src/lib/env.ts");
    expect(env).toMatch(/HARD_LIVE_TRADING_ALLOWED/);

    const exec = read("src/lib/live-execution/index.ts");
    expect(exec).toMatch(/LIVE_EXECUTION_NOT_IMPLEMENTED/);

    const sigEng = read("src/lib/engines/signal-engine.ts");
    expect(sigEng).toMatch(/if\s*\(score\s*<\s*70\)/);

    // Coin detail sayfası Binance order/leverage endpoint çağırmıyor
    const symbolPage = read("src/app/coins/[symbol]/page.tsx");
    const indexPage = read("src/app/coins/page.tsx");
    for (const src of [symbolPage, indexPage]) {
      expect(src).not.toMatch(/\/fapi\/v1\/order/);
      expect(src).not.toMatch(/\/fapi\/v1\/leverage/);
    }
  });
});
