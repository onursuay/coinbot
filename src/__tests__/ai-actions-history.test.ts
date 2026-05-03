// AI Aksiyon Merkezi — Faz 4 history mapper birim testleri.
//
// Doğrulanan invaryantlar:
//   • Her event tip'i doğru category + status + title'a maplenir.
//   • metadata bozuk/null/string olsa bile mapper patlamaz.
//   • oldValue/newValue/actionType/confidence/source güvenli parse edilir.
//   • Bilinmeyen event_type için null veya defansif default döner.

import { describe, it, expect } from "vitest";
import {
  mapHistoryItem,
  mapHistoryItems,
  type BotLogRow,
} from "@/lib/ai-actions";

function row(overrides: Partial<BotLogRow>): BotLogRow {
  return {
    id: "log-1",
    event_type: "ai_action_applied",
    message: "test",
    metadata: {},
    created_at: "2026-05-03T14:00:00.000Z",
    level: "info",
    ...overrides,
  };
}

describe("history mapper — event type → category/status/title", () => {
  it("ai_action_applied → applied", () => {
    const r = mapHistoryItem(
      row({
        event_type: "ai_action_applied",
        message: "Risk %3 → %2",
        metadata: {
          actionType: "UPDATE_RISK_PER_TRADE_DOWN",
          oldValue: "%3.0",
          newValue: "%2.0",
          source: "ai_action_center",
        },
      }),
    );
    expect(r).not.toBeNull();
    expect(r!.category).toBe("action");
    expect(r!.status).toBe("applied");
    expect(r!.title).toBe("Aksiyon Uygulandı");
    expect(r!.actionType).toBe("UPDATE_RISK_PER_TRADE_DOWN");
    expect(r!.oldValue).toBe("%3.0");
    expect(r!.newValue).toBe("%2.0");
    expect(r!.source).toBe("ai_action_center");
  });

  it("ai_action_apply_blocked → blocked", () => {
    const r = mapHistoryItem(
      row({
        event_type: "ai_action_apply_blocked",
        metadata: { code: "FORBIDDEN_ACTION", actionType: "ENABLE_LIVE_TRADING" },
      }),
    );
    expect(r!.category).toBe("action");
    expect(r!.status).toBe("blocked");
    expect(r!.title).toBe("Aksiyon Bloke Edildi");
    expect(r!.actionType).toBe("ENABLE_LIVE_TRADING");
  });

  it("ai_action_apply_failed → failed", () => {
    const r = mapHistoryItem(row({ event_type: "ai_action_apply_failed" }));
    expect(r!.category).toBe("action");
    expect(r!.status).toBe("failed");
    expect(r!.title).toBe("Aksiyon Başarısız");
  });

  it("ai_action_apply_requested → requested", () => {
    const r = mapHistoryItem(row({ event_type: "ai_action_apply_requested" }));
    expect(r!.category).toBe("action");
    expect(r!.status).toBe("requested");
  });

  it("ai_action_observation_set → observed", () => {
    const r = mapHistoryItem(
      row({
        event_type: "ai_action_observation_set",
        metadata: { actionType: "SET_OBSERVATION_MODE" },
      }),
    );
    expect(r!.category).toBe("observation");
    expect(r!.status).toBe("observed");
  });

  it("ai_decision_refreshed → refreshed (decision)", () => {
    const r = mapHistoryItem(
      row({
        event_type: "ai_decision_refreshed",
        metadata: {
          status: "OBSERVE",
          actionType: "OBSERVE",
          confidence: 75,
          riskLevel: "MEDIUM",
        },
      }),
    );
    expect(r!.category).toBe("decision");
    expect(r!.status).toBe("refreshed");
    expect(r!.confidence).toBe(75);
    expect(r!.riskLevel).toBe("MEDIUM");
  });

  it("ai_decision_cache_hit → cache_hit", () => {
    const r = mapHistoryItem(row({ event_type: "ai_decision_cache_hit" }));
    expect(r!.category).toBe("decision");
    expect(r!.status).toBe("cache_hit");
  });

  it("ai_decision_cache_miss → cache_miss", () => {
    const r = mapHistoryItem(row({ event_type: "ai_decision_cache_miss" }));
    expect(r!.category).toBe("decision");
    expect(r!.status).toBe("cache_miss");
  });

  it("ai_decision_fallback_cached → fallback", () => {
    const r = mapHistoryItem(row({ event_type: "ai_decision_fallback_cached" }));
    expect(r!.category).toBe("decision");
    expect(r!.status).toBe("fallback");
  });
});

describe("history mapper — defensive metadata parsing", () => {
  it("metadata null ise patlamaz", () => {
    const r = mapHistoryItem(row({ metadata: null }));
    expect(r).not.toBeNull();
    expect(r!.metadataSafe).toEqual({});
    expect(r!.actionType).toBeNull();
  });

  it("metadata bozuk JSON string ise patlamaz", () => {
    const r = mapHistoryItem(row({ metadata: "not-json{{{" }));
    expect(r).not.toBeNull();
    expect(r!.metadataSafe).toEqual({});
  });

  it("metadata array (yanlış şema) ise sessizce yutulur", () => {
    const r = mapHistoryItem(row({ metadata: [1, 2, 3] as unknown }));
    expect(r).not.toBeNull();
    expect(r!.metadataSafe).toEqual({});
  });

  it("metadata JSON string olarak gelirse parse edilir", () => {
    const r = mapHistoryItem(
      row({
        metadata: JSON.stringify({
          actionType: "UPDATE_RISK_PER_TRADE_DOWN",
          oldValue: "%3.0",
        }),
      }),
    );
    expect(r!.actionType).toBe("UPDATE_RISK_PER_TRADE_DOWN");
    expect(r!.oldValue).toBe("%3.0");
  });

  it("event_type boş ise null döner", () => {
    expect(mapHistoryItem(row({ event_type: "" }))).toBeNull();
    expect(mapHistoryItem(row({ event_type: null }))).toBeNull();
  });

  it("snake_case fallback (action_type / old_value)", () => {
    const r = mapHistoryItem(
      row({
        metadata: {
          action_type: "UPDATE_RISK_PER_TRADE_DOWN",
          old_value: "%3.0",
          new_value: "%2.0",
        },
      }),
    );
    expect(r!.actionType).toBe("UPDATE_RISK_PER_TRADE_DOWN");
    expect(r!.oldValue).toBe("%3.0");
    expect(r!.newValue).toBe("%2.0");
  });

  it("confidence string olarak gelirse number'a çevrilir", () => {
    const r = mapHistoryItem(
      row({
        event_type: "ai_decision_refreshed",
        metadata: { confidence: "85" },
      }),
    );
    expect(r!.confidence).toBe(85);
  });

  it("created_at yoksa fallback ISO timestamp", () => {
    const r = mapHistoryItem(row({ created_at: null }));
    expect(r).not.toBeNull();
    // ISO 8601 timestamp format
    expect(r!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("mapHistoryItems — toplu mapping", () => {
  it("birden fazla satırı sırayla maplenir", () => {
    const rows: BotLogRow[] = [
      row({ id: "1", event_type: "ai_action_applied" }),
      row({ id: "2", event_type: "ai_decision_cache_hit" }),
      row({ id: "3", event_type: "ai_action_apply_blocked" }),
    ];
    const items = mapHistoryItems(rows);
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.status)).toEqual(["applied", "cache_hit", "blocked"]);
  });

  it("tek bir bozuk satır diğerlerini etkilemez", () => {
    const rows: BotLogRow[] = [
      row({ id: "1", event_type: "ai_action_applied" }),
      row({ id: "2", event_type: null }), // bozuk
      row({ id: "3", event_type: "ai_decision_cache_hit" }),
    ];
    const items = mapHistoryItems(rows);
    // null event_type olan satır skip edilir
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.id)).toEqual(["1", "3"]);
  });
});
