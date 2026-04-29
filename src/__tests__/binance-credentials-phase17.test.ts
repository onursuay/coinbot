// Faz 17 — Binance Credential / Permission / IP Validation testleri.
//
// Kapsam:
//   • API key masking
//   • Credential presence (boş env güvenli)
//   • recommendedVpsIp = 72.62.146.159
//   • Checklist state tipleri
//   • Validator/route dosyalarında /fapi/v1/order yok
//   • Checklist endpoint API key/secret kabul etmiyor (statik kontrol)
//   • Status route order endpoint çağırmıyor (statik kontrol)
//   • Korunan invariantlar (HARD_LIVE_TRADING_ALLOWED, MIN_SIGNAL_CONFIDENCE, vb.)

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  maskApiKey,
  checkCredentialPresence,
  EXPECTED_VPS_IP,
  DEFAULT_CHECKLIST,
} from "@/lib/binance-credentials";

// ── Grup 1: API key masking ───────────────────────────────────────────────────

describe("Faz 17 — maskApiKey", () => {
  it("returns null for empty string", () => {
    expect(maskApiKey("")).toBeNull();
  });

  it("masks middle of a long key, keeps first 4 and last 4", () => {
    const masked = maskApiKey("ABCD1234567890XYZW");
    expect(masked).toMatch(/^ABCD\*+XYZW$/);
  });

  it("never returns the raw key", () => {
    const raw = "SECRET_KEY_PLAINTEXT_VALUE_12345";
    const masked = maskApiKey(raw);
    expect(masked).not.toBe(raw);
    expect(masked).not.toContain("PLAINTEXT");
  });

  it("masks short keys without leaking", () => {
    const masked = maskApiKey("ABCD");
    expect(masked).not.toContain("ABCD");
  });

  it("masks 8-char key fully", () => {
    const masked = maskApiKey("12345678");
    expect(masked).not.toContain("3456");
  });
});

// ── Grup 2: Credential presence ───────────────────────────────────────────────

describe("Faz 17 — checkCredentialPresence (test env)", () => {
  it("returns safe defaults when credentials missing", () => {
    const presence = checkCredentialPresence();
    // Test env typically has no Binance creds; if present they must be masked.
    expect(typeof presence.apiKeyPresent).toBe("boolean");
    expect(typeof presence.apiSecretPresent).toBe("boolean");
    expect(typeof presence.credentialConfigured).toBe("boolean");
    expect(typeof presence.usingTestnet).toBe("boolean");
    expect(typeof presence.baseUrl).toBe("string");
  });

  it("apiKeyMasked is null when key absent, masked when present", () => {
    const presence = checkCredentialPresence();
    if (presence.apiKeyPresent) {
      expect(presence.apiKeyMasked).toMatch(/\*/);
    } else {
      expect(presence.apiKeyMasked).toBeNull();
    }
  });

  it("never exposes raw secret in returned shape", () => {
    const presence = checkCredentialPresence();
    const json = JSON.stringify(presence);
    expect(json).not.toMatch(/apiSecret"\s*:\s*"[^*]/);
    expect(json).not.toContain("\"secret\":\"");
  });
});

// ── Grup 3: VPS IP / checklist defaults ───────────────────────────────────────

describe("Faz 17 — Constants", () => {
  it("EXPECTED_VPS_IP is 72.62.146.159", () => {
    expect(EXPECTED_VPS_IP).toBe("72.62.146.159");
  });

  it("DEFAULT_CHECKLIST has all four fields = unknown", () => {
    expect(DEFAULT_CHECKLIST.withdrawPermissionDisabled).toBe("unknown");
    expect(DEFAULT_CHECKLIST.ipRestrictionConfigured).toBe("unknown");
    expect(DEFAULT_CHECKLIST.futuresPermissionConfirmed).toBe("unknown");
    expect(DEFAULT_CHECKLIST.extraPermissionsReviewed).toBe("unknown");
  });

  it("DEFAULT_CHECKLIST states are limited to confirmed/failed/unknown", () => {
    const allowed = ["unknown", "confirmed", "failed"];
    expect(allowed).toContain(DEFAULT_CHECKLIST.withdrawPermissionDisabled);
    expect(allowed).toContain(DEFAULT_CHECKLIST.ipRestrictionConfigured);
    expect(allowed).toContain(DEFAULT_CHECKLIST.futuresPermissionConfirmed);
    expect(allowed).toContain(DEFAULT_CHECKLIST.extraPermissionsReviewed);
  });
});

// ── Grup 4: Static file invariants — no order endpoint, no secret leaks ──────

describe("Faz 17 — Güvenlik invariantları", () => {
  const validatorPath = path.resolve(__dirname, "../lib/binance-credentials/validator.ts");
  const typesPath = path.resolve(__dirname, "../lib/binance-credentials/types.ts");
  const statusRoutePath = path.resolve(__dirname, "../app/api/binance-credentials/status/route.ts");
  const checklistRoutePath = path.resolve(__dirname, "../app/api/binance-credentials/checklist/route.ts");
  const envTsPath = path.resolve(__dirname, "../lib/env.ts");
  const adapterPath = path.resolve(__dirname, "../lib/live-execution/adapter.ts");

  let validator: string;
  let types: string;
  let statusRoute: string;
  let checklistRoute: string;
  let envTs: string;
  let adapter: string;

  beforeAll(() => {
    validator = fs.readFileSync(validatorPath, "utf8");
    types = fs.readFileSync(typesPath, "utf8");
    statusRoute = fs.readFileSync(statusRoutePath, "utf8");
    checklistRoute = fs.readFileSync(checklistRoutePath, "utf8");
    envTs = fs.readFileSync(envTsPath, "utf8");
    adapter = fs.readFileSync(adapterPath, "utf8");
  });

  it("validator.ts contains no /fapi/v1/order reference", () => {
    expect(validator).not.toMatch(/\/fapi\/v1\/order/);
  });

  it("validator.ts only references read-only paths", () => {
    expect(validator).toMatch(/\/fapi\/v2\/account/);
    expect(validator).toMatch(/\/fapi\/v1\/time/);
  });

  it("validator.ts uses GET for signed requests only", () => {
    expect(validator).not.toMatch(/method:\s*["']POST["']/);
    expect(validator).not.toMatch(/method:\s*["']DELETE["']/);
  });

  it("status route does not contain order endpoint", () => {
    expect(statusRoute).not.toMatch(/\/fapi\/v1\/order/);
  });

  it("checklist route does not contain order endpoint", () => {
    expect(checklistRoute).not.toMatch(/\/fapi\/v1\/order/);
  });

  it("checklist route rejects api key / secret keys", () => {
    expect(checklistRoute).toMatch(/SECRET_LIKE_KEYS/);
    expect(checklistRoute).toMatch(/API key\/secret kabul etmez/);
  });

  it("checklist route uses .strict() schema", () => {
    expect(checklistRoute).toMatch(/\.strict\(\)/);
  });

  it("status route returns recommendedVpsIp", () => {
    expect(statusRoute).toMatch(/recommendedVpsIp/);
  });

  it("status route imports EXPECTED_VPS_IP", () => {
    expect(statusRoute).toMatch(/EXPECTED_VPS_IP/);
  });

  it("validator.ts has safeErrorMessage that strips long tokens", () => {
    expect(validator).toMatch(/signature=\*\*\*/);
    expect(validator).toMatch(/safeErrorMessage/);
  });

  // Korunan değişmezler
  it("env.ts hardLiveTradingAllowed defaults to false", () => {
    expect(envTs).toMatch(/hardLiveTradingAllowed.*HARD_LIVE_TRADING_ALLOWED.*false/);
  });

  it("env.ts defaultTradingMode defaults to paper", () => {
    expect(envTs).toMatch(/defaultTradingMode.*DEFAULT_TRADING_MODE.*"paper"/);
  });

  it("live-execution adapter still returns LIVE_EXECUTION_NOT_IMPLEMENTED", () => {
    expect(adapter).toMatch(/LIVE_EXECUTION_NOT_IMPLEMENTED/);
    expect(adapter).not.toMatch(/\bfetch\s*\(/);
  });
});

// ── Grup 5: Type system structure ────────────────────────────────────────────

describe("Faz 17 — Type structure", () => {
  it("BinanceSecurityChecklist has 4 manual gates + updatedAt", () => {
    const keys = Object.keys(DEFAULT_CHECKLIST);
    expect(keys).toContain("withdrawPermissionDisabled");
    expect(keys).toContain("ipRestrictionConfigured");
    expect(keys).toContain("futuresPermissionConfirmed");
    expect(keys).toContain("extraPermissionsReviewed");
    expect(keys).toContain("updatedAt");
  });

  it("CredentialPresence safe-shape: no `apiSecret` / `secret` field present", () => {
    const presence = checkCredentialPresence();
    expect("apiSecret" in (presence as any)).toBe(false);
    expect("secret" in (presence as any)).toBe(false);
  });
});
