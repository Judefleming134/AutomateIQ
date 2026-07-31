import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/require-session";

/**
 * The tenant guard: a verified session PLUS the business it belongs to.
 *
 * requireSession() answers "is someone logged in, and do they belong to a
 * business?" — it checks that profile.business_id is set and stops there. It
 * never loads the business, so it cannot tell an ACTIVE tenant from a
 * suspended or soft-deleted one.
 *
 * That gap had a visible cost. The portal layout loaded the business through
 * the RLS-scoped client, and the RLS helper (is_active_tenant_member) requires
 * `status = 'active' AND deleted_at IS NULL`. For a suspended customer the row
 * simply came back null, the layout fell back to the placeholder name "Your
 * business", and the portal rendered in full with every panel empty — because
 * the same RLS predicate hid all their data too. A customer suspended for
 * non-payment saw what looked exactly like their data being deleted, with
 * nothing on screen to say otherwise. That is a support call and a trust
 * problem, and the honest message costs one page.
 *
 * requireSession is deliberately left EXACTLY as it was — 51 call sites depend
 * on its current shape and redirect behaviour, and several are Server Actions
 * and Route Handlers where a new redirect would be a behaviour change. This
 * builds on top of it rather than altering it.
 */

export type TenantBusiness = {
  id: string;
  name: string;
  status: string | null;
};

/**
 * Why a session can't be served as an active tenant. Kept as a pure function so
 * the decision is testable without a database or a Next request context.
 */
export function tenantAccessState(input: {
  businessId: string | null | undefined;
  business: { id: string } | null | undefined;
}): "ok" | "no_business" | "inactive" {
  if (!input.businessId) return "no_business";
  // The business row is read through the CALLER'S OWN RLS-scoped client, so a
  // null here doesn't mean "missing" — it means "you are not an active member
  // of it". Suspended, soft-deleted and genuinely absent all land here, and
  // that is the correct grouping: in every one of them the portal has nothing
  // truthful to show.
  if (!input.business) return "inactive";
  return "ok";
}

/**
 * Verified session + the caller's active business. Redirects rather than
 * throwing, matching requireSession/requireAdmin.
 */
export async function requireTenant(): Promise<{
  user: Awaited<ReturnType<typeof requireSession>>["user"];
  profile: Awaited<ReturnType<typeof requireSession>>["profile"];
  business: TenantBusiness;
}> {
  const { user, profile } = await requireSession();
  const supabase = await createClient();

  const { data: business } = await supabase
    .from("businesses")
    .select("id, name, status")
    .eq("id", profile.business_id)
    .maybeSingle();

  const state = tenantAccessState({
    businessId: profile.business_id,
    business,
  });

  if (state !== "ok") {
    // /account-unavailable sits OUTSIDE the /portal tree on purpose. Inside it,
    // the portal layout would guard the page that exists to explain why the
    // guard fired, and the redirect would loop forever.
    redirect("/account-unavailable");
  }

  return {
    user,
    profile,
    business: business as TenantBusiness,
  };
}
