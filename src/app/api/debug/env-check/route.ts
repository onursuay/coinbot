import { ok } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hangi DB bağlantı env var'larının SET olduğunu göster (değerleri değil).
export async function GET() {
  const vars = [
    "DATABASE_URL",
    "DIRECT_URL",
    "POSTGRES_URL",
    "POSTGRES_PRISMA_URL",
    "POSTGRES_URL_NON_POOLING",
    "SUPABASE_DB_URL",
    "POSTGRES_HOST",
    "POSTGRES_PASSWORD",
    "DB_URL",
  ];

  const result: Record<string, boolean> = {};
  for (const v of vars) {
    result[v] = Boolean(process.env[v]);
  }

  return ok(result);
}
