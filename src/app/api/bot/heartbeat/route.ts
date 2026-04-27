// Heartbeat endpoint — VPS/cloud worker POSTs periodically; dashboard GETs.
import { ok, fail } from "@/lib/api-helpers";
import { recordHeartbeat, getWorkerHealth, type HeartbeatPayload } from "@/lib/engines/heartbeat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await getWorkerHealth();
    return ok(snapshot);
  } catch (e: any) {
    return fail(e?.message ?? "heartbeat read failed", 500);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Partial<HeartbeatPayload>;
    const payload: HeartbeatPayload = {
      workerId: body.workerId,
      status: (body.status ?? "running_paper") as any,
      activeMode: body.activeMode,
      activeExchange: body.activeExchange,
      websocketStatus: body.websocketStatus,
      binanceApiStatus: body.binanceApiStatus,
      openPositionsCount: body.openPositionsCount,
      lastError: body.lastError ?? null,
    };
    const res = await recordHeartbeat(payload);
    if (!res.ok) return fail(res.error ?? "heartbeat write failed", 500);
    return ok({ recorded: true });
  } catch (e: any) {
    return fail(e?.message ?? "heartbeat post failed", 500);
  }
}
