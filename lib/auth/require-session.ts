import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveHomeRoute } from "@/lib/auth/home-route";

/**
 * Portal-side equivalent of requireAdmin() — re-checked in every /portal
 * Server Action and Route Handler, not just the layout. Returns the
 * verified user plus their profile (role, business_id).
 */
export async function requireSession() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, business_id")
    .eq("id", user.id)
    .single();

  if (!profile?.business_id) {
    // Was: an unconditional redirect("/admin"), on the assumption that only
    // admins lack a business_id. They don't — and the assumption produced an
    // infinite redirect:
    //
    //   /portal → requireSession → /admin → requireAdmin → /portal → …
    //
    // because requireAdmin sends a non-admin back to /portal, and its one
    // escape hatch (role === 'growth' → /growth) can never fire: the CHECK
    // constraint on profiles.role only permits 'admin' and 'customer'.
    //
    // The account shape that hits it is common, not exotic. TradeIQ and
    // Finance both have self-serve signup, and the auth trigger creates
    // role='customer' with no business_id when the metadata carries none. So
    // any TradeIQ or Finance customer reaching /portal — including straight
    // from the main /login form, which defaults to /portal — got
    // ERR_TOO_MANY_REDIRECTS instead of their own product.
    //
    // Now it resolves where the account actually belongs. The two lookups run
    // only on this branch (a portal customer never reaches it) and use the
    // admin client, gated by the session already verified above — the same
    // pattern requireGrowth uses, because ge_team_members is not readable
    // under the caller's own RLS scope.
    const admin = createAdminClient();
    const [{ data: growthMember }, { data: tradesAccount }] = await Promise.all([
      admin
        .from("ge_team_members")
        .select("id")
        .eq("auth_user_id", user.id)
        .eq("status", "active")
        .maybeSingle(),
      admin
        .from("trades_accounts")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    redirect(
      resolveHomeRoute({
        role: profile?.role,
        businessId: profile?.business_id,
        isGrowthMember: Boolean(growthMember),
        hasTradesAccount: Boolean(tradesAccount),
      })
    );
  }

  return { user, profile };
}
