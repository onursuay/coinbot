import { ok } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "NOT_SET";
  // Proje ref'ini URL'den çıkar (ouuhfochadxsepovzdls gibi)
  const projectRef = supabaseUrl
    .replace("https://", "")
    .replace(".supabase.co", "")
    .replace(/\/.*$/, "");

  return ok({
    projectRef,
    supabaseUrlMasked: supabaseUrl.replace(/^(https:\/\/)([^.]+)(.*)$/, "$1***$3"),
    hasServiceKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  });
}
