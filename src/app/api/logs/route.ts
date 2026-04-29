import { ok } from "@/lib/api-helpers";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Filter = "last100" | "last500" | "last1000" | "last24h" | "last7d" | "error" | "kill_switch";

const VALID_FILTERS: Filter[] = ["last100", "last500", "last1000", "last24h", "last7d", "error", "kill_switch"];
const VALID_LEVELS = ["debug", "info", "warn", "error"];
const MAX_LIMIT = 1000;

function parseFilter(raw: string | null): Filter {
  return VALID_FILTERS.includes(raw as Filter) ? (raw as Filter) : "last500";
}

function filterToLimit(f: Filter): number {
  if (f === "last100") return 100;
  if (f === "last1000") return 1000;
  if (f === "last24h" || f === "last7d" || f === "error" || f === "kill_switch") return 1000;
  return 500;
}

function cutoffForFilter(f: Filter): string | null {
  if (f === "last24h") return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  if (f === "last7d") return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  return null;
}

/** Arama terimindeki % ve _ karakterlerini escape eder; SQL injection önlenir. */
function buildIlikePattern(term: string): string {
  return `%${term.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const filter = parseFilter(url.searchParams.get("filter"));

  if (!supabaseConfigured()) return ok({ logs: [], riskEvents: [], meta: { filter, total: 0 } });

  const limitOverride = url.searchParams.get("limit");
  const limit = limitOverride
    ? Math.min(MAX_LIMIT, Math.max(1, Number(limitOverride) || 500))
    : filterToLimit(filter);
  const cutoff = cutoffForFilter(filter);

  // ── Arama parametreleri ────────────────────────────────────────────────
  const rawQ = url.searchParams.get("q")?.trim() ?? null;
  const q = rawQ && rawQ.length > 0 ? rawQ.slice(0, 100) : null;

  const rawLevel = url.searchParams.get("level") ?? null;
  const levelFilter = rawLevel && VALID_LEVELS.includes(rawLevel) ? rawLevel : null;

  const rawEvent = url.searchParams.get("event")?.trim() ?? null;
  const eventFilter = rawEvent && rawEvent.length > 0 ? rawEvent.slice(0, 100) : null;

  const errorsOnly = url.searchParams.get("errorsOnly") === "true";
  const killSwitchOnly = url.searchParams.get("killSwitch") === "true";

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

  // ── Temel filtre (zaman / seviye) ──────────────────────────────────────
  if (filter === "error" || errorsOnly) {
    logsQuery = logsQuery.eq("level", "error");
    riskQuery = riskQuery.eq("severity", "critical");
  } else if (filter === "kill_switch" || killSwitchOnly) {
    logsQuery = logsQuery.ilike("event_type", "%kill_switch%");
    riskQuery = riskQuery.ilike("event_type", "%kill_switch%");
  } else if (cutoff) {
    logsQuery = logsQuery.gte("created_at", cutoff);
    riskQuery = riskQuery.gte("created_at", cutoff);
  }

  // ── Keyword arama (q) — event_type ve message üzerinde case-insensitive ─
  if (q) {
    const pattern = buildIlikePattern(q);
    logsQuery = logsQuery.or(`event_type.ilike.${pattern},message.ilike.${pattern}`);
    riskQuery = riskQuery.or(`event_type.ilike.${pattern},message.ilike.${pattern}`);
  }

  // ── Level filtresi ──────────────────────────────────────────────────────
  if (levelFilter && !errorsOnly && filter !== "error") {
    logsQuery = logsQuery.eq("level", levelFilter);
  }

  // ── Event-type filtresi ─────────────────────────────────────────────────
  if (eventFilter) {
    const evtPattern = buildIlikePattern(eventFilter);
    logsQuery = logsQuery.ilike("event_type", evtPattern);
    riskQuery = riskQuery.ilike("event_type", evtPattern);
  }

  const [{ data: logs }, { data: riskEvents }] = await Promise.all([logsQuery, riskQuery]);

  return ok({
    logs: logs ?? [],
    riskEvents: riskEvents ?? [],
    meta: {
      filter,
      limit,
      q: q ?? null,
      total: (logs?.length ?? 0) + (riskEvents?.length ?? 0),
    },
  });
}
