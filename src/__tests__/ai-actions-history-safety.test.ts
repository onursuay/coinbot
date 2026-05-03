// AI Aksiyon Merkezi — Faz 4 history endpoint + UI safety invariants.
//
// Doğrulanan invaryantlar:
//   • /api/ai-actions/history yalnızca GET handler tanımlar.
//   • DB write (insert/update/upsert/delete/rpc set_) yoktur.
//   • Binance private endpoint referansı yoktur.
//   • HARD_LIVE_TRADING_ALLOWED=true / enable_live_trading=true ataması yok.
//   • sanitizeMetadata: apiKey/secret/token/password/authorization/bearer
//     içeren metadata key'leri "[REDACTED]" ile değiştirir.
//   • UI'da "Karar ve Aksiyon Geçmişi" bölümü, filter UI ve empty state var.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { sanitizeMetadata } from "@/lib/ai-actions";

const ROOT = path.resolve(__dirname, "../..");
function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf-8");
}

describe("/api/ai-actions/history route — safety invariants", () => {
  const route = read("src/app/api/ai-actions/history/route.ts");

  it("yalnızca GET handler tanımlar", () => {
    expect(route).toMatch(/export\s+async\s+function\s+GET\s*\(/);
    expect(route).not.toMatch(/export\s+async\s+function\s+POST\s*\(/);
    expect(route).not.toMatch(/export\s+async\s+function\s+PUT\s*\(/);
    expect(route).not.toMatch(/export\s+async\s+function\s+PATCH\s*\(/);
    expect(route).not.toMatch(/export\s+async\s+function\s+DELETE\s*\(/);
  });

  it("DB write çağrısı yok (insert/update/upsert/delete)", () => {
    expect(route).not.toMatch(/\.insert\s*\(/);
    expect(route).not.toMatch(/\.update\s*\(/);
    expect(route).not.toMatch(/\.upsert\s*\(/);
    expect(route).not.toMatch(/\.delete\s*\(/);
    expect(route).not.toMatch(/\.rpc\s*\(\s*['"`]set_/);
  });

  it("Binance private endpoint referansı yok", () => {
    expect(route).not.toMatch(/\/fapi\/v1\/order/);
    expect(route).not.toMatch(/\/fapi\/v1\/leverage/);
  });

  it("HARD_LIVE_TRADING_ALLOWED=true veya enable_live_trading=true ataması yok", () => {
    expect(route).not.toMatch(/HARD_LIVE_TRADING_ALLOWED\s*=\s*true/);
    expect(route).not.toMatch(/enable_live_trading\s*=\s*true/);
    expect(route).not.toMatch(/trading_mode\s*=\s*['"]live['"]/);
  });

  it("limit clamp + valid kategori/status güvenli kabul listesi var", () => {
    expect(route).toMatch(/MAX_LIMIT/);
    expect(route).toMatch(/VALID_CATEGORIES/);
    expect(route).toMatch(/VALID_STATUSES/);
  });

  it("created_at cutoff (sinceDays) timeout koruması var — default 30, max 180", () => {
    // bot_logs büyüdükçe IN(event_type) + ORDER BY created_at DESC sorgusu
    // timeout veriyordu. .gte("created_at", cutoff) zorunlu.
    expect(route).toMatch(/\.gte\(["']created_at["']/);
    expect(route).toMatch(/DEFAULT_SINCE_DAYS/);
    expect(route).toMatch(/MAX_SINCE_DAYS/);
    expect(route).toMatch(/clampSinceDays/);
    expect(route).toMatch(/sinceDays/);
  });

  it("meta response'unda sinceDays döndürülüyor", () => {
    expect(route).toMatch(/sinceDays/);
  });

  it("sanitizeMetadata mapper içinde uygulanır (mapHistoryItems üzerinden)", () => {
    expect(route).toMatch(/mapHistoryItems/);
  });
});

describe("sanitizeMetadata — secret key filtering", () => {
  it("apiKey değeri redact edilir", () => {
    const out = sanitizeMetadata({
      apiKey: "sk-test-very-secret",
      hasOpenAiKey: true,
      foo: "bar",
    });
    expect(out.apiKey).toBe("[REDACTED]");
    expect(out.hasOpenAiKey).toBe(true); // boolean flag korunur
    expect(out.foo).toBe("bar");
  });

  it("api_key snake_case değeri redact edilir", () => {
    const out = sanitizeMetadata({ api_key: "secret123" });
    expect(out.api_key).toBe("[REDACTED]");
  });

  it("secret/token/password/authorization/bearer redact edilir", () => {
    const out = sanitizeMetadata({
      secret: "x",
      token: "y",
      password: "z",
      authorization: "Bearer abc",
      bearer: "tok-abc",
    });
    expect(out.secret).toBe("[REDACTED]");
    expect(out.token).toBe("[REDACTED]");
    expect(out.password).toBe("[REDACTED]");
    expect(out.authorization).toBe("[REDACTED]");
    expect(out.bearer).toBe("[REDACTED]");
  });

  it("nested objelerde de filtreler", () => {
    const out = sanitizeMetadata({
      outer: {
        apiKey: "sk-nested",
        deep: { secret: "s", ok: "value" },
      },
    });
    expect((out.outer as any).apiKey).toBe("[REDACTED]");
    expect(((out.outer as any).deep as any).secret).toBe("[REDACTED]");
    expect(((out.outer as any).deep as any).ok).toBe("value");
  });

  it("boolean has-flag'leri korunur", () => {
    const out = sanitizeMetadata({
      hasOpenAiKey: true,
      hasServiceRoleKey: false,
      hasSupabaseConfigured: true,
    });
    expect(out.hasOpenAiKey).toBe(true);
    expect(out.hasServiceRoleKey).toBe(false);
    expect(out.hasSupabaseConfigured).toBe(true);
  });

  it("null/undefined input için boş obje döner", () => {
    expect(sanitizeMetadata(null)).toEqual({});
    expect(sanitizeMetadata(undefined)).toEqual({});
    expect(sanitizeMetadata("string-input")).toEqual({});
    expect(sanitizeMetadata(42)).toEqual({});
  });

  it("array doğrudan top-level kabul edilmez (boş obje döner)", () => {
    expect(sanitizeMetadata([{ apiKey: "x" }])).toEqual({});
  });

  it("array içinde nested objeler de filtrelenir", () => {
    const out = sanitizeMetadata({
      list: [{ apiKey: "x", ok: 1 }, { ok: 2 }],
    });
    expect(((out.list as any[])[0] as any).apiKey).toBe("[REDACTED]");
    expect(((out.list as any[])[0] as any).ok).toBe(1);
    expect(((out.list as any[])[1] as any).ok).toBe(2);
  });

  it("ServiceRoleKey / service_role_key value redact", () => {
    const out = sanitizeMetadata({
      ServiceRoleKey: "abc",
      service_role_key: "def",
    });
    expect(out.ServiceRoleKey).toBe("[REDACTED]");
    expect(out.service_role_key).toBe("[REDACTED]");
  });
});

describe("/ai-actions UI — Karar ve Aksiyon Geçmişi", () => {
  const page = read("src/app/ai-actions/page.tsx");

  it("'Karar ve Aksiyon Geçmişi' bölümü mevcut", () => {
    expect(page).toMatch(/Karar ve Aksiyon Geçmişi/);
    expect(page).toMatch(/HistorySection/);
  });

  it("filter UI render edilir (Tümü / Uygulanan / Engellenen / Gözlem / AI Yorum)", () => {
    expect(page).toMatch(/Tümü/);
    expect(page).toMatch(/Uygulanan/);
    expect(page).toMatch(/Engellenen/);
    expect(page).toMatch(/Gözlem/);
    expect(page).toMatch(/AI Yorum/);
  });

  it("empty state mesajı 'Henüz aksiyon geçmişi yok'", () => {
    expect(page).toMatch(/Henüz aksiyon geçmişi yok/);
  });

  it("hata state mesajı içerir", () => {
    expect(page).toMatch(/Aksiyon geçmişi alınamadı/);
  });

  it("/api/ai-actions/history endpoint'ini fetch eder", () => {
    expect(page).toMatch(/\/api\/ai-actions\/history/);
  });

  it("Binance private endpoint referansı yok", () => {
    expect(page).not.toMatch(/\/fapi\/v1\/order/);
    expect(page).not.toMatch(/\/fapi\/v1\/leverage/);
  });

  it("HARD_LIVE_TRADING_ALLOWED=true ataması yok", () => {
    expect(page).not.toMatch(/HARD_LIVE_TRADING_ALLOWED\s*=\s*true/);
  });
});
