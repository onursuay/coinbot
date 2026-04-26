import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";

export type LogLevel = "debug" | "info" | "warn" | "error";

export async function botLog(opts: {
  userId: string;
  exchange?: string;
  level?: LogLevel;
  eventType: string;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  const row = {
    user_id: opts.userId,
    exchange_name: opts.exchange ?? null,
    level: opts.level ?? "info",
    event_type: opts.eventType,
    message: opts.message,
    metadata: opts.metadata ?? {},
  };
  // Always console-log for ops visibility.
  // eslint-disable-next-line no-console
  console.log(`[bot:${row.level}] ${row.event_type} — ${row.message}`);
  if (!supabaseConfigured()) return;
  try {
    await supabaseAdmin().from("bot_logs").insert(row);
  } catch {
    // Swallow logger failures — never break the caller.
  }
}

export async function riskEvent(opts: {
  userId: string;
  exchange?: string;
  symbol?: string;
  eventType: string;
  severity?: "info" | "warning" | "critical";
  message: string;
  metadata?: Record<string, unknown>;
}) {
  const row = {
    user_id: opts.userId,
    exchange_name: opts.exchange ?? null,
    symbol: opts.symbol ?? null,
    event_type: opts.eventType,
    severity: opts.severity ?? "info",
    message: opts.message,
    metadata: opts.metadata ?? {},
  };
  // eslint-disable-next-line no-console
  console.log(`[risk:${row.severity}] ${row.event_type} — ${row.message}`);
  if (!supabaseConfigured()) return;
  try {
    await supabaseAdmin().from("risk_events").insert(row);
  } catch {
    // ignore
  }
}
