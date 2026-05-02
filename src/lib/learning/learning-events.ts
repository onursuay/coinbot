// trade_learning_events writer.
//
// Each row captures one phase in the learning lifecycle of a paper trade:
// opened → updated → closed → outcome_analyzed → lesson_created.
// All operations are best-effort: failures are logged but never block trade
// flow. The table can be missing (migration not applied yet) and writers
// degrade gracefully to a no-op so paper trading is unaffected.

import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";

export type TradeLearningEventType =
  | "opened"
  | "updated"
  | "closed"
  | "outcome_analyzed"
  | "lesson_created"
  | "rule_suggestion_created";

export interface TradeLearningEventInput {
  paperTradeId: string | null;
  symbol: string | null;
  direction: "LONG" | "SHORT" | null;
  eventType: TradeLearningEventType;
  eventJson: Record<string, unknown>;
  llmSummary?: string | null;
}

let tableMissingLogged = false;

/**
 * Insert a row into trade_learning_events.
 * Returns the inserted id on success, null on any failure (table missing,
 * supabase not configured, etc). Never throws.
 */
export async function recordLearningEvent(
  input: TradeLearningEventInput,
): Promise<string | null> {
  if (!supabaseConfigured()) return null;
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("trade_learning_events")
      .insert({
        paper_trade_id: input.paperTradeId,
        symbol: input.symbol,
        direction: input.direction,
        event_type: input.eventType,
        event_json: input.eventJson,
        llm_summary: input.llmSummary ?? null,
      })
      .select("id")
      .single();
    if (error) {
      // Table missing / RLS / etc — log once, then silently degrade.
      if (!tableMissingLogged) {
        // eslint-disable-next-line no-console
        console.warn("[learning] trade_learning_events insert failed:", error.message);
        tableMissingLogged = true;
      }
      return null;
    }
    return (data?.id as string | undefined) ?? null;
  } catch (e) {
    if (!tableMissingLogged) {
      // eslint-disable-next-line no-console
      console.warn("[learning] trade_learning_events unexpected:", (e as Error).message);
      tableMissingLogged = true;
    }
    return null;
  }
}

/**
 * Read recent learning events. Returns empty array on any failure.
 */
export async function listRecentLearningEvents(
  limit = 50,
): Promise<Array<Record<string, unknown>>> {
  if (!supabaseConfigured()) return [];
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("trade_learning_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data ?? []) as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
}
