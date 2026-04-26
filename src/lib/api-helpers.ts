import { NextResponse } from "next/server";
import { ZodError, ZodTypeAny, z } from "zod";

export const ok = <T>(data: T, init?: ResponseInit) => NextResponse.json({ ok: true, data }, init);
export const fail = (message: string, status = 400, extra?: Record<string, unknown>) =>
  NextResponse.json({ ok: false, error: message, ...extra }, { status });

export async function parseBody<S extends ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S> | NextResponse> {
  try {
    const json = await req.json();
    return schema.parse(json) as z.infer<S>;
  } catch (e) {
    if (e instanceof ZodError) {
      return fail("Geçersiz istek", 400, { issues: e.issues });
    }
    return fail("Geçersiz JSON gövdesi", 400);
  }
}

export const isResponse = (v: unknown): v is NextResponse => v instanceof NextResponse;
