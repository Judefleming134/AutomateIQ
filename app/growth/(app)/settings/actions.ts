"use server";

import { revalidatePath } from "next/cache";
import { requireGrowth, loadGrowthSettings } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { qualificationFromScore } from "@/lib/growth/scoring";
import { CHANNELS } from "@/lib/growth/constants";

type Result = { ok?: boolean; error?: string } | undefined;

export async function saveGrowthSettings(_prev: Result, formData: FormData): Promise<Result> {
  const { member } = await requireGrowth();
  if (member.role !== "owner") return { error: "Only owners can change settings." };

  const bookingUrl = String(formData.get("booking_url") ?? "").trim();
  const qualifyThreshold = Number(formData.get("qualify_threshold"));
  const reviewThreshold = Number(formData.get("review_threshold"));

  if (!/^https?:\/\/.+/.test(bookingUrl)) {
    return { error: "Booking URL must start with http(s)://" };
  }
  if (
    !Number.isInteger(qualifyThreshold) ||
    !Number.isInteger(reviewThreshold) ||
    qualifyThreshold < 1 ||
    qualifyThreshold > 100 ||
    reviewThreshold < 0 ||
    reviewThreshold >= qualifyThreshold
  ) {
    return { error: "Thresholds must be whole numbers with review below qualify (1–100)." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("ge_settings").upsert({
    id: true,
    booking_url: bookingUrl,
    qualify_threshold: qualifyThreshold,
    review_threshold: reviewThreshold,
  });
  if (error) return { error: error.message };

  // Re-derive every prospect's qualification status under the new rules so
  // the pipeline never shows stale verdicts (manual disqualifications stick).
  const { data: prospects } = await admin
    .from("ge_prospects")
    .select("id, lead_score, qualification_status")
    .neq("qualification_status", "disqualified");
  const thresholds = { qualifyThreshold, reviewThreshold };
  for (const p of prospects ?? []) {
    const next = qualificationFromScore(p.lead_score, thresholds);
    if (next !== p.qualification_status) {
      await admin
        .from("ge_prospects")
        .update({ qualification_status: next })
        .eq("id", p.id);
    }
  }

  revalidatePath("/growth/settings");
  revalidatePath("/growth/prospects");
  return { ok: true };
}

// --- Templates ---------------------------------------------------------------

const TEMPLATE_CATEGORIES = ["initial", "follow_up", "re_engagement", "confirmation", "reply"];

function templateFields(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim().slice(0, 200),
    channel: String(formData.get("channel") ?? "email"),
    category: String(formData.get("category") ?? "initial"),
    subject: String(formData.get("subject") ?? "").trim().slice(0, 300) || null,
    body: String(formData.get("body") ?? "").trim().slice(0, 10000),
  };
}

export async function saveTemplate(_prev: Result, formData: FormData): Promise<Result> {
  await requireGrowth();
  const id = String(formData.get("template_id") ?? "").trim();
  const t = templateFields(formData);
  if (!t.name || !t.body) return { error: "Template name and body are required." };
  if (!(CHANNELS as string[]).includes(t.channel)) return { error: "Invalid channel." };
  if (!TEMPLATE_CATEGORIES.includes(t.category)) return { error: "Invalid category." };

  const admin = createAdminClient();
  const { error } = id
    ? await admin.from("ge_templates").update(t).eq("id", id)
    : await admin.from("ge_templates").insert(t);
  if (error) {
    return {
      error: error.message.includes("duplicate")
        ? "A template with that name already exists."
        : error.message,
    };
  }

  revalidatePath("/growth/settings");
  return { ok: true };
}

export async function deleteTemplate(_prev: Result, formData: FormData): Promise<Result> {
  await requireGrowth();
  const id = String(formData.get("template_id") ?? "");
  if (!id) return { error: "Missing template." };

  const admin = createAdminClient();
  const { error } = await admin.from("ge_templates").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/growth/settings");
  return { ok: true };
}

// --- Team --------------------------------------------------------------------

function getSiteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL || "https://automateiq.ie";
}

/**
 * Adds a team member by email. If they don't have an account yet they get a
 * Supabase invite (role 'growth' — no business, no admin rights on the
 * customer platform); if they already have one, the membership row simply
 * links to it on their first Growth Engine login.
 */
export async function addTeamMember(_prev: Result, formData: FormData): Promise<Result> {
  const { member } = await requireGrowth();
  if (member.role !== "owner") return { error: "Only owners can manage the team." };

  const name = String(formData.get("name") ?? "").trim().slice(0, 200);
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "member");
  if (!name) return { error: "Name is required." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Invalid email." };
  if (!["owner", "member"].includes(role)) return { error: "Invalid role." };

  const admin = createAdminClient();
  const { data: created, error } = await admin
    .from("ge_team_members")
    .insert({ name, email, role })
    .select("id")
    .single();
  if (error) {
    return {
      error: error.message.includes("duplicate")
        ? "That email is already on the team."
        : error.message,
    };
  }

  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { role: "growth" },
    redirectTo: `${getSiteUrl()}/auth/set-password`,
  });
  // "Already registered" is fine — they'll sign in with their existing
  // password and the membership links itself. Anything else is a real
  // failure: roll back so the team list never shows someone who can't get in.
  if (inviteError && !/already/i.test(inviteError.message)) {
    await admin.from("ge_team_members").delete().eq("id", created.id);
    return { error: `Invite failed: ${inviteError.message}` };
  }

  revalidatePath("/growth/settings");
  return { ok: true };
}

export async function setMemberStatus(_prev: Result, formData: FormData): Promise<Result> {
  const { member } = await requireGrowth();
  if (member.role !== "owner") return { error: "Only owners can manage the team." };

  const id = String(formData.get("member_id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !["active", "suspended"].includes(status)) return { error: "Invalid request." };
  if (id === member.id && status === "suspended") {
    return { error: "You can't suspend your own account." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("ge_team_members").update({ status }).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/growth/settings");
  return { ok: true };
}

export async function removeTeamMember(_prev: Result, formData: FormData): Promise<Result> {
  const { member } = await requireGrowth();
  if (member.role !== "owner") return { error: "Only owners can manage the team." };

  const id = String(formData.get("member_id") ?? "");
  if (!id) return { error: "Missing member." };
  if (id === member.id) return { error: "You can't remove your own account." };

  const admin = createAdminClient();
  const { error } = await admin.from("ge_team_members").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/growth/settings");
  return { ok: true };
}
