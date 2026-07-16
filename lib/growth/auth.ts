import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type GrowthMember = {
  id: string;
  auth_user_id: string | null;
  email: string;
  name: string;
  role: "owner" | "member";
  status: "active" | "suspended";
};

/**
 * The Growth Engine's requireAdmin() equivalent — re-checked inside EVERY
 * /growth Server Action and Route Handler, not just the layout (middleware
 * and layouts are UX routing, not the security boundary).
 *
 * Access rules:
 *   1. Anyone already in ge_team_members (active) is in. A member row created
 *      by email invite is linked to its auth user on first login.
 *   2. Platform admins (profiles.role = 'admin') are auto-provisioned as
 *      Growth Engine owners on first visit — the business owner is never
 *      locked out of their own internal sales system, and no manual
 *      bootstrap step exists to forget.
 * Everyone else is redirected to the Growth Engine's own login.
 */
export async function requireGrowth(): Promise<{
  user: { id: string; email?: string };
  member: GrowthMember;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/growth/login");
  }

  // ge_ tables are deny-all under RLS; membership checks and writes go
  // through the service-role client, gated by the verified session above.
  const admin = createAdminClient();

  let { data: member } = await admin
    .from("ge_team_members")
    .select("id, auth_user_id, email, name, role, status")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  // Invited-by-email member logging in for the first time: link the row.
  if (!member && user.email) {
    // Escape LIKE wildcards: ilike is used only for case-insensitivity, but
    // % and _ are legal in email local parts — an unescaped pattern could
    // match (and claim) a DIFFERENT pending invite row than the literal
    // address. Backslash-escaping keeps the match exact.
    const emailPattern = user.email.replace(/([%_\\])/g, "\\$1");
    const { data: byEmail } = await admin
      .from("ge_team_members")
      .select("id, auth_user_id, email, name, role, status")
      .ilike("email", emailPattern)
      .is("auth_user_id", null)
      .maybeSingle();
    if (byEmail) {
      await admin
        .from("ge_team_members")
        .update({ auth_user_id: user.id })
        .eq("id", byEmail.id);
      member = { ...byEmail, auth_user_id: user.id };
    }
  }

  // Platform admin without a membership row yet → provision as owner.
  if (!member) {
    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.role === "admin" && user.email) {
      const { data: created } = await admin
        .from("ge_team_members")
        .insert({
          auth_user_id: user.id,
          email: user.email.toLowerCase(),
          name: user.email.split("@")[0],
          role: "owner",
        })
        .select("id, auth_user_id, email, name, role, status")
        .single();
      member = created;
    }
  }

  if (!member || member.status !== "active") {
    redirect("/growth/login?denied=1");
  }

  return {
    user: { id: user.id, email: user.email ?? undefined },
    member: member as GrowthMember,
  };
}

/** Growth Engine settings with safe defaults if the row is missing. */
export async function loadGrowthSettings() {
  const admin = createAdminClient();
  const { data } = await admin
    .from("ge_settings")
    .select("booking_url, qualify_threshold, review_threshold")
    .eq("id", true)
    .maybeSingle();
  return {
    bookingUrl: data?.booking_url ?? "https://automateiq.ie/book",
    qualifyThreshold: data?.qualify_threshold ?? 70,
    reviewThreshold: data?.review_threshold ?? 40,
  };
}
