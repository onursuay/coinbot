import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

let _admin: SupabaseClient | null = null;
let _anon: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    // Returning a dummy client would mask config errors; throw a clear error.
    throw new Error("Supabase admin client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
  _admin = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}

export function supabaseAnon(): SupabaseClient {
  if (_anon) return _anon;
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw new Error("Supabase anon client requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  _anon = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _anon;
}

export function supabaseConfigured(): boolean {
  return Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
}
