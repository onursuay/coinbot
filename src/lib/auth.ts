// Single-tenant scaffolding: a deterministic system user id is used until
// real Supabase auth is wired up. This keeps the dashboard usable in dev/demo
// while the schema is already shaped for multi-user (user_id columns).
const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";

export function getCurrentUserId(): string {
  return SYSTEM_USER_ID;
}
