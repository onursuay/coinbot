import { ok, fail } from "@/lib/api-helpers";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  if (!supabaseConfigured()) return fail("Veritabanı yapılandırılmamış", 503);

  const { id } = params;
  if (!id) return fail("Geçersiz id", 400);

  const userId = getCurrentUserId();
  const sb = supabaseAdmin();

  // Verify the record belongs to this user and is a paper trade.
  const { data: existing, error: fetchErr } = await sb
    .from("paper_trades")
    .select("id, user_id, status")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (fetchErr || !existing) return fail("Kayıt bulunamadı", 404);

  const { error: deleteErr } = await sb
    .from("paper_trades")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (deleteErr) return fail("Silinemedi: " + deleteErr.message, 500);

  return ok({ deleted: true, id });
}
