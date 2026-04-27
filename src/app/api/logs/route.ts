import { ok } from "@/lib/api-helpers";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Filter = "last100" | "last500" | "last1000" | "last24h" | "last7d" | "error" | "kill_switch";

function parseFilter(raw: string | null): Filter {
  const valid: Filter[] = ["last100", "last500", "last1000", "last24h", "last7d", "error", "kill_switch"];
  return valid.includes(raw as Filter) ? (raw as Filter) : "last500";
}

function filterToLimit(f: Filter): number {
  if (f === "last100") return 100;
  if (f === "last1000") return 1000;
  if (f === "last24h" || f === "last7d" || f === "error" || f === "kill_switch") return 1000;
  return 500; // last500 default
}

function cutoffForFilter(f: Filter): string | null {
  if (f === "last24h") return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  if (f === "last7d") return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  return null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const filter = parseFilter(url.searchParams.get("filter"));

  if (!supabaseConfigured()) return ok({ logs: [], riskEvents: [], meta: { filter, total: 0 } });
  const limitOverride = url.searchParams.get("limit");
  const limit = limitOverride
    ? Math.min(1000, Math.max(1, Number(limitOverride) || 500))
    : filterToLimit(filter);
  const cutoff = cutoffForFilter(filter);

  const userId = getCurrentUserId();
  const sb = supabaseAdmin();

  let logsQuery = sb
    .from("bot_logs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  let riskQuery = sb
    .from("risk_events")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (filter === "error") {
    logsQuery = logsQuery.eq("level", "error");
    riskQuery = riskQuery.eq("severity", "critical");
  } else if (filter === "kill_switch") {
    logsQuery = logsQuery.ilike("event_type", "%kill_switch%");
    // risk_events don't have kill_switch events; return empty for that table
    riskQuery = riskQuery.ilike("event_type", "%kill_switch%");
  } else if (cutoff) {
    logsQuery = logsQuery.gte("created_at", cutoff);
    riskQuery = riskQuery.gte("created_at", cutoff);
  }

  const [{ data: logs }, { data: riskEvents }] = await Promise.all([logsQuery, riskQuery]);

  return ok({
    logs: logs ?? [],
    riskEvents: riskEvents ?? [],
    meta: { filter, limit, total: (logs?.length ?? 0) + (riskEvents?.length ?? 0) },
  });
}
