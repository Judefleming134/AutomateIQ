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
  // SELECT *, not a column list.
  //
  // The list named daily_send_target, which arrives with a migration. Naming a
  // column that isn't there yet doesn't degrade — PostgREST 400s the whole
  // request, supabase-js hands back { data: null }, and because every field
  // below reads through `data?.`, ALL FOUR settings quietly become defaults.
  // The comment underneath this used to claim the opposite ("falls back if the
  // column isn't there yet, so the engine keeps sending through a migration
  // gap") and it was the one thing the code couldn't do. The real cost isn't
  // the send target: bookingUrl is pasted into outreach emails, so a schema
  // gap silently swaps Jude's booking link for the generic one in everything
  // that goes out. Verified against Postgres 16 in the scratchpad.
  //
  // ge_settings is a single-row config table, so * is free, and a column that
  // hasn't landed yet is simply an absent key — which is what `??` is for.
  const { data, error } = await admin
    .from("ge_settings")
    .select("*")
    .eq("id", true)
    .maybeSingle();
  if (error) {
    // Never silent. Defaults are about to be used for everything, and that is
    // a fact worth finding in the logs rather than in a customer's inbox.
    console.error("loadGrowthSettings: falling back to defaults —", error.message);
  }
  return {
    bookingUrl: data?.booking_url ?? "https://automateiq.ie/book",
    qualifyThreshold: data?.qualify_threshold ?? 70,
    reviewThreshold: data?.review_threshold ?? 40,
    // Destination for daily outreach, not a daily quota — the ramp paces the
    // climb toward it. 50/day is the number Jude set on 2026-07-31; see
    // migration 0031, which also writes it to the row.
    dailySendTarget: data?.daily_send_target ?? 50,
  };
}
