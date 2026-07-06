"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireGrowth, loadGrowthSettings } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseCsv } from "@/lib/growth/csv";
import {
  computeLeadScore,
  qualificationFromScore,
  CRITERIA,
  type CriterionKey,
} from "@/lib/growth/scoring";
import { PROSPECT_STATUSES, PROSPECT_STATUS_META } from "@/lib/growth/constants";

type Result = { ok?: boolean; error?: string } | undefined;

const optional = (max = 300) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();

const prospectSchema = z.object({
  company: z.string().trim().min(1, "Company is required.").max(200),
  contact_name: z.string().trim().min(1, "Contact name is required.").max(200),
  job_title: optional(),
  industry: optional(),
  website: optional(),
  location: optional(),
  email: z
    .string()
    .trim()
    .max(300)
    .transform((v) => v || null)
    .nullable()
    .optional()
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Invalid email."),
  phone: optional(50),
  linkedin_url: optional(500),
  instagram_url: optional(500),
  notes: optional(4000),
  campaign_id: z
    .string()
    .trim()
    .transform((v) => v || null)
    .nullable()
    .optional(),
});

function fields(formData: FormData, keys: string[]) {
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = String(formData.get(k) ?? "");
  return out;
}

const PROSPECT_FIELD_KEYS = [
  "company",
  "contact_name",
  "job_title",
  "industry",
  "website",
  "location",
  "email",
  "phone",
  "linkedin_url",
  "instagram_url",
  "notes",
  "campaign_id",
];

export async function addProspect(_prev: Result, formData: FormData): Promise<Result> {
  const { member } = await requireGrowth();
  const parsed = prospectSchema.safeParse(fields(formData, PROSPECT_FIELD_KEYS));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const admin = createAdminClient();

  if (parsed.data.email) {
    const { data: existing } = await admin
      .from("ge_prospects")
      .select("id")
      .ilike("email", parsed.data.email)
      .maybeSingle();
    if (existing) return { error: "A prospect with this email already exists." };
  }

  const { data: created, error } = await admin
    .from("ge_prospects")
    .insert({ ...parsed.data, created_by: member.id, source: "manual" })
    .select("id")
    .single();
  if (error) return { error: error.message };

  await admin.from("ge_activities").insert({
    prospect_id: created.id,
    type: "system",
    content: `Prospect added by ${member.name}`,
    created_by: member.id,
  });

  revalidatePath("/growth/prospects");
  return { ok: true };
}

/**
 * Bulk import from pasted CSV. Expected header row (any order, extra columns
 * ignored): company, contact_name, job_title, industry, website, location,
 * email, phone, linkedin_url, instagram_url, notes.
 * Rows whose email already exists are skipped, not duplicated.
 */
export async function importProspects(_prev: Result, formData: FormData): Promise<Result & { imported?: number; skipped?: number }> {
  const { member } = await requireGrowth();
  const csv = String(formData.get("csv") ?? "").trim();
  const campaignId = String(formData.get("campaign_id") ?? "").trim() || null;
  if (!csv) return { error: "Paste CSV data first." };

  const rows = parseCsv(csv);
  if (rows.length < 2) {
    return { error: "Need a header row plus at least one data row." };
  }

  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = (name: string) => header.indexOf(name);
  if (col("company") === -1 || col("contact_name") === -1) {
    return { error: "CSV must include 'company' and 'contact_name' columns." };
  }

  const admin = createAdminClient();
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  let imported = 0;
  let skipped = 0;

  for (const row of rows.slice(1)) {
    const cell = (name: string) => {
      const i = col(name);
      return i === -1 ? null : row[i]?.trim() || null;
    };
    const company = cell("company");
    const contactName = cell("contact_name");
    if (!company || !contactName) {
      skipped++;
      continue;
    }
    const email = cell("email");
    if (email && !emailRe.test(email)) {
      skipped++;
      continue;
    }
    if (email) {
      const { data: existing } = await admin
        .from("ge_prospects")
        .select("id")
        .ilike("email", email)
        .maybeSingle();
      if (existing) {
        skipped++;
        continue;
      }
    }
    const { data: created, error } = await admin
      .from("ge_prospects")
      .insert({
        company,
        contact_name: contactName,
        job_title: cell("job_title"),
        industry: cell("industry"),
        website: cell("website"),
        location: cell("location"),
        email,
        phone: cell("phone"),
        linkedin_url: cell("linkedin_url"),
        instagram_url: cell("instagram_url"),
        notes: cell("notes"),
        campaign_id: campaignId,
        created_by: member.id,
        source: "import",
      })
      .select("id")
      .single();
    if (error) {
      skipped++;
      continue;
    }
    await admin.from("ge_activities").insert({
      prospect_id: created.id,
      type: "system",
      content: `Imported via CSV by ${member.name}`,
      created_by: member.id,
    });
    imported++;
  }

  revalidatePath("/growth/prospects");
  return { ok: true, imported, skipped };
}

export async function updateProspect(_prev: Result, formData: FormData): Promise<Result> {
  await requireGrowth();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing prospect." };

  const parsed = prospectSchema.safeParse(fields(formData, PROSPECT_FIELD_KEYS));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const nextFollowUp = String(formData.get("next_follow_up_at") ?? "").trim() || null;
  const pipelineRaw = String(formData.get("pipeline_value") ?? "").trim();
  const pipelineValue = pipelineRaw ? Number(pipelineRaw) : null;
  if (pipelineValue !== null && (!Number.isFinite(pipelineValue) || pipelineValue < 0)) {
    return { error: "Pipeline value must be a positive number." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("ge_prospects")
    .update({
      ...parsed.data,
      next_follow_up_at: nextFollowUp,
      pipeline_value: pipelineValue,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(`/growth/prospects/${id}`);
  revalidatePath("/growth/prospects");
  return { ok: true };
}

export async function setProspectStatus(_prev: Result, formData: FormData): Promise<Result> {
  const { member } = await requireGrowth();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !(PROSPECT_STATUSES as string[]).includes(status)) {
    return { error: "Invalid status." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("ge_prospects").update({ status }).eq("id", id);
  if (error) return { error: error.message };

  await admin.from("ge_activities").insert({
    prospect_id: id,
    type: "status_change",
    content: `Status changed to "${PROSPECT_STATUS_META[status as keyof typeof PROSPECT_STATUS_META].label}" by ${member.name}`,
    created_by: member.id,
  });

  revalidatePath(`/growth/prospects/${id}`);
  revalidatePath("/growth/prospects");
  return { ok: true };
}

/**
 * Saves the six qualification ratings and derives lead_score +
 * qualification status from them (see lib/growth/scoring.ts). A manual
 * "disqualify" checkbox overrides the derived status and sticks until
 * unchecked.
 */
export async function qualifyProspect(_prev: Result, formData: FormData): Promise<Result> {
  const { member } = await requireGrowth();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing prospect." };

  const ratings: Partial<Record<CriterionKey, number>> = {};
  for (const c of CRITERIA) {
    const v = Number(formData.get(c.key));
    if (!Number.isInteger(v) || v < 0 || v > 3) return { error: "Invalid rating." };
    ratings[c.key] = v;
  }
  const disqualified = formData.get("disqualified") === "on";

  const settings = await loadGrowthSettings();
  const score = computeLeadScore(ratings);
  const status = disqualified
    ? "disqualified"
    : qualificationFromScore(score, settings);

  const admin = createAdminClient();
  const { error } = await admin
    .from("ge_prospects")
    .update({ ...ratings, lead_score: score, qualification_status: status })
    .eq("id", id);
  if (error) return { error: error.message };

  await admin.from("ge_activities").insert({
    prospect_id: id,
    type: "system",
    content: `Qualification updated by ${member.name} — score ${score}/100 (${status.replace("_", " ")})`,
    created_by: member.id,
  });

  revalidatePath(`/growth/prospects/${id}`);
  revalidatePath("/growth/prospects");
  return { ok: true };
}

export async function addActivity(_prev: Result, formData: FormData): Promise<Result> {
  const { member } = await requireGrowth();
  const id = String(formData.get("id") ?? "");
  const type = String(formData.get("type") ?? "note");
  const content = String(formData.get("content") ?? "").trim();
  if (!id || !content) return { error: "Write something first." };
  if (!["note", "call", "meeting"].includes(type)) return { error: "Invalid type." };

  const admin = createAdminClient();
  const { error } = await admin.from("ge_activities").insert({
    prospect_id: id,
    type,
    content: content.slice(0, 4000),
    created_by: member.id,
  });
  if (error) return { error: error.message };

  revalidatePath(`/growth/prospects/${id}`);
  return { ok: true };
}

export async function addTask(_prev: Result, formData: FormData): Promise<Result> {
  const { member } = await requireGrowth();
  const prospectId = String(formData.get("prospect_id") ?? "").trim() || null;
  const title = String(formData.get("title") ?? "").trim();
  const dueAt = String(formData.get("due_at") ?? "").trim() || null;
  if (!title) return { error: "Task title is required." };

  const admin = createAdminClient();
  const { error } = await admin.from("ge_tasks").insert({
    prospect_id: prospectId,
    title: title.slice(0, 300),
    due_at: dueAt,
    created_by: member.id,
  });
  if (error) return { error: error.message };

  if (prospectId) revalidatePath(`/growth/prospects/${prospectId}`);
  revalidatePath("/growth");
  return { ok: true };
}

export async function completeTask(_prev: Result, formData: FormData): Promise<Result> {
  await requireGrowth();
  const id = String(formData.get("task_id") ?? "");
  if (!id) return { error: "Missing task." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("ge_tasks")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/growth");
  revalidatePath("/growth/prospects");
  return { ok: true };
}

export async function deleteProspect(_prev: Result, formData: FormData): Promise<Result> {
  const { member } = await requireGrowth();
  if (member.role !== "owner") {
    return { error: "Only owners can delete prospects." };
  }
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing prospect." };

  const admin = createAdminClient();
  const { error } = await admin.from("ge_prospects").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/growth/prospects");
  return { ok: true };
}
