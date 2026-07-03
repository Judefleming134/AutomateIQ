import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client — bypasses RLS entirely. Only ever call this from
 * code already gated by requireAdmin() (see lib/auth/require-admin.ts).
 * The `server-only` import above makes any accidental client-component
 * import of this module a build-time error instead of a leaked key.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
