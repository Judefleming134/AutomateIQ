"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireGrowth, loadGrowthSettings } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseCsv } from "@/lib/growth/csv";
import { dublinDate } from "@/lib/growth/dates";
import { estimatedFirstYearValue } from "@/lib/growth/pricing";
import { cleanSocialUrl, fetchWebsiteText, runCompanyResearch } from "@/lib/growth/research";
import { NO_PROVIDER_MESSAGE } from "@/lib/ai/config";
import {
  computeLeadScore,
  qualificationFromScore,
  CRITERIA,
  type CriterionKey,
} from "@/lib/growth/scoring";
import {
  CLOSED_STATUSES,
  PROSPECT_STATUSES,
  PROSPECT_STATUS_META,
} from "@/lib/growth/constants";

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
  contact_name: z
    .string()
    .trim()
    .max(200)
    .transform((v) => v || "Owner"),
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
  facebook_url: optional(500),
  notes: optional(4000),
  campaign_id: z
    .string()
    .trim()
    .transform((v) => v || null)
    .nullable()
    .optional(),
});

/** A prospect must be reachable somehow — company name alone is not a lead. */
function hasContactMethod(p: {
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
  instagram_url?: string | null;
  facebook_url?: string | null;
}): boolean {
  return Boolean(
    p.website || p.email || p.phone || p.linkedin_url || p.instagram_url || p.facebook_url
  );
}

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
  "facebook_url",
  "notes",
  "campaign_id",
];

export async function addProspect(_prev: Result, formData: FormData): Promise<Result> {
  const { member } = await requireGrowth();
  const parsed = prospectSchema.safeParse(fields(formData, PROSPECT_FIELD_KEYS));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  if (!hasContactMethod(parsed.data)) {
    return {
      error:
        "Add at least one way to contact them — website, email, phone, or a social profile.",
    };
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
  const campaignSel = String(formData.get("campaign_id") ?? "").trim();
  // "__auto__": one mixed paste, rows grouped by their industry column —
  // matched to an existing campaign or a new one created on the fly.
  const autoGroup = campaignSel === "__auto__";
  const fixedCampaignId = autoGroup ? null : campaignSel || null;
  if (!csv) return { error: "Paste CSV data first." };

  const rows = parseCsv(csv);
  if (rows.length < 2) {
    return { error: "Need a header row plus at least one data row." };
  }

  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = (name: string) => header.indexOf(name);
  if (col("company") === -1) {
    return { error: "CSV must include a 'company' column." };
  }

  const admin = createAdminClient();
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  let imported = 0;
  let skipped = 0;

  // Auto-grouping: campaign per industry value, resolved once per industry.
  // Match order: campaign.industry (case-insensitive) → campaign name
  // contains the industry → create a fresh active campaign named after it.
  const campaignCache = new Map<string, string | null>();
  async function campaignForIndustry(industryRaw: string | null): Promise<string | null> {
    const industry = (industryRaw ?? "").trim();
    if (!industry) return null;
    const cacheKey = industry.toLowerCase();
    if (campaignCache.has(cacheKey)) return campaignCache.get(cacheKey)!;

    const safe = industry.replace(/[%_]/g, "");
    let id: string | null = null;
    const { data: byIndustry } = await admin
      .from("ge_campaigns")
      .select("id")
      .ilike("industry", safe)
      .limit(1)
      .maybeSingle();
    id = byIndustry?.id ?? null;
    if (!id) {
      const { data: byName } = await admin
        .from("ge_campaigns")
        .select("id")
        .ilike("name", `%${safe}%`)
        .limit(1)
        .maybeSingle();
      id = byName?.id ?? null;
    }
    if (!id) {
      const title = industry.replace(/\b\w/g, (c) => c.toUpperCase());
      const { data: created } = await admin
        .from("ge_campaigns")
        .insert({
          name: title,
          industry,
          status: "active",
          created_by: member.id,
        })
        .select("id")
        .single();
      id = created?.id ?? null;
    }
    campaignCache.set(cacheKey, id);
    return id;
  }

  // Load existing emails + company names ONCE for in-memory dedupe — a
  // per-row DB lookup would be ~1,500 round trips on a 750-lead import and
  // blow the function time budget. The sets also catch duplicates within
  // the CSV itself as rows are reserved.
  const { data: existingRows } = await admin
    .from("ge_prospects")
    .select("email, company");
  const seenEmails = new Set<string>();
  const seenCompanies = new Set<string>();
  for (const r of existingRows ?? []) {
    if (r.email) seenEmails.add(String(r.email).toLowerCase());
    if (r.company) seenCompanies.add(String(r.company).trim().toLowerCase());
  }

  type NewProspect = Record<string, unknown>;
  const toInsert: NewProspect[] = [];

  for (const row of rows.slice(1)) {
    const cell = (name: string) => {
      const i = col(name);
      return i === -1 ? null : row[i]?.trim() || null;
    };
    const company = cell("company");
    if (!company) {
      skipped++;
      continue;
    }
    const email = cell("email");
    if (email && !emailRe.test(email)) {
      skipped++;
      continue;
    }
    // A lead must be reachable: company alone (no website/email/phone/social)
    // is not actionable, so the row is skipped rather than imported.
    if (
      !hasContactMethod({
        website: cell("website"),
        email,
        phone: cell("phone"),
        linkedin_url: cell("linkedin_url"),
        instagram_url: cell("instagram_url"),
        facebook_url: cell("facebook_url"),
      })
    ) {
      skipped++;
      continue;
    }
    // Dedupe: by email when present, otherwise by company name — so
    // importing the same sheet twice (or overlapping sheets) never creates
    // duplicate prospects. Reserve the key so intra-CSV dupes are caught too.
    const emailKey = email?.toLowerCase() ?? null;
    const companyKey = company.trim().toLowerCase();
    if (emailKey) {
      if (seenEmails.has(emailKey)) {
        skipped++;
        continue;
      }
      seenEmails.add(emailKey);
    } else {
      if (seenCompanies.has(companyKey)) {
        skipped++;
        continue;
      }
      seenCompanies.add(companyKey);
    }
    toInsert.push({
      company,
      contact_name: cell("contact_name") ?? "Owner",
      job_title: cell("job_title"),
      industry: cell("industry"),
      website: cell("website"),
      location: cell("location"),
      email,
      phone: cell("phone"),
      linkedin_url: cell("linkedin_url"),
      instagram_url: cell("instagram_url"),
      facebook_url: cell("facebook_url"),
      notes: cell("notes"),
      campaign_id: autoGroup
        ? await campaignForIndustry(cell("industry"))
        : fixedCampaignId,
      created_by: member.id,
      source: "import",
    });
  }

  // Bulk insert in chunks; if a whole chunk fails (one bad row poisons it),
  // fall back to row-by-row for just that chunk so one bad lead can't sink
  // the batch. Activities are collected and bulk-inserted at the end.
  const activityRows: Record<string, unknown>[] = [];
  const pushActivity = (id: string) =>
    activityRows.push({
      prospect_id: id,
      type: "system",
      content: `Imported via CSV by ${member.name}`,
      created_by: member.id,
    });
  const CHUNK = 100;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    const { data: inserted, error } = await admin
      .from("ge_prospects")
      .insert(chunk)
      .select("id");
    if (error) {
      for (const one of chunk) {
        const { data: created, error: e2 } = await admin
          .from("ge_prospects")
          .insert(one)
          .select("id")
          .single();
        if (e2 || !created) {
          skipped++;
          continue;
        }
        pushActivity(created.id as string);
        imported++;
      }
    } else {
      for (const r of inserted ?? []) pushActivity(r.id as string);
      imported += (inserted ?? []).length;
    }
  }
  for (let i = 0; i < activityRows.length; i += 500) {
    await admin.from("ge_activities").insert(activityRows.slice(i, i + 500));
  }

  revalidatePath("/growth/prospects");
  revalidatePath("/growth/campaigns");
  if (imported === 0) {
    return {
      error: `Nothing imported (${skipped} row${skipped === 1 ? "" : "s"} skipped) — every row needs a company plus at least one contact method (website, email, phone or social URL), and emails that already exist are skipped.`,
    };
  }
  return { ok: true, imported, skipped };
}

/**
 * One prospect's research, callable from the client-side "Research all"
 * queue — each call is its own request, so each gets the route's full
 * execution window instead of one action trying to research 60 companies.
 */
export async function researchOne(
  prospectId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const fd = new FormData();
  fd.set("id", prospectId);
  const result = await researchProspect(undefined, fd);
  return result?.error ? { ok: false, error: result.error } : { ok: true };
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
  const assignedTo = String(formData.get("assigned_to") ?? "").trim() || null;
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
      assigned_to: assignedTo,
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

  // Stage automation: each transition does its CRM bookkeeping so nothing
  // has to be remembered manually.
  const update: Record<string, unknown> = { status };
  if (status === "contacted" || status === "follow_up_sent") {
    update.last_contact_at = new Date().toISOString();
    update.next_follow_up_at = followUpDate(status === "contacted" ? 3 : 4);
  } else if (status === "replied") {
    // They're engaged — pull the follow-up in close.
    update.next_follow_up_at = followUpDate(1);
  } else if (status === "negotiation") {
    update.next_follow_up_at = followUpDate(3);
  } else if (status === "future_opportunity") {
    // Nurture list: resurface automatically in ~3 months.
    update.next_follow_up_at = followUpDate(90);
  } else if ((CLOSED_STATUSES as string[]).includes(status)) {
    update.next_follow_up_at = null; // closed — nothing left to chase
  }

  const admin = createAdminClient();
  const { error } = await admin.from("ge_prospects").update(update).eq("id", id);
  if (error) return { error: error.message };

  await admin.from("ge_activities").insert({
    prospect_id: id,
    type: "status_change",
    content: `Status changed to "${PROSPECT_STATUS_META[status as keyof typeof PROSPECT_STATUS_META].label}" by ${member.name}`,
    created_by: member.id,
  });

  revalidatePath(`/growth/prospects/${id}`);
  revalidatePath("/growth/prospects");
  revalidatePath("/growth");
  return { ok: true };
}

function followUpDate(days: number): string {
  return dublinDate(days);
}

/**
 * The heart of the workflow: researches the prospect's company and saves the
 * complete package — report, solution recommendations, suggested lead score
 * and a first-touch draft for every channel — then moves the prospect to
 * "Research complete". Re-running replaces the report and refreshes the
 * unsent first-touch drafts (sent messages are never touched).
 */
export async function researchProspect(_prev: Result, formData: FormData): Promise<Result> {
  const { member } = await requireGrowth();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing prospect." };

  const admin = createAdminClient();
  const { data: prospect } = await admin
    .from("ge_prospects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!prospect) return { error: "Prospect not found." };

  let result;
  try {
    result = await runCompanyResearch(prospect);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "NO_PROVIDER") return { error: NO_PROVIDER_MESSAGE };
    if (message === "BAD_JSON") {
      return { error: "The research came back malformed — run it again." };
    }
    // Make throttling distinguishable so the batch queue can pace itself
    // and the user sees the true reason, not a generic shrug.
    if (message.startsWith("HTTP 429")) {
      const daily = /perday|per_day|per day|daily|quota/i.test(message);
      return {
        error: daily
          ? "DAILY AI QUOTA reached — the free tier has used its calls for today. It resets daily; adding ANTHROPIC_API_KEY in Vercel removes the cap."
          : "AI rate limit — pausing a minute fixes this.",
      };
    }
    if (/^HTTP 5\d\d/.test(message)) {
      return { error: "AI service briefly overloaded — retry in a minute." };
    }
    return {
      error: `Research failed${message.startsWith("HTTP") ? ` (${message.slice(0, 80)})` : ""} — try again in a moment.`,
    };
  }

  const { error: researchError } = await admin.from("ge_research").upsert(
    {
      prospect_id: id,
      // engine rides inside the report jsonb so the UI can show which model
      // produced this research without a schema change.
      report: { ...result.report, engine: result.engine },
      solutions: result.solutions,
      website_fetched: result.websiteFetched,
      created_by: member.id,
    },
    { onConflict: "prospect_id" }
  );
  if (researchError) return { error: researchError.message };

  // Lead score: AI ratings fill in criteria nobody has rated yet; a human's
  // existing non-zero rating always wins over the model's estimate.
  const ratings: Partial<Record<CriterionKey, number>> = {};
  for (const c of CRITERIA) {
    const current = Number(prospect[c.key] ?? 0);
    ratings[c.key] = current > 0 ? current : (result.ratings[c.key] ?? 0);
  }
  const settings = await loadGrowthSettings();
  const score = computeLeadScore(ratings);

  const update: Record<string, unknown> = {
    ...ratings,
    lead_score: score,
    qualification_status: qualificationFromScore(
      score,
      settings,
      prospect.qualification_status
    ),
  };
  if (!prospect.industry && result.report.industry) {
    update.industry = result.report.industry;
  }
  // Ground pipeline € in the price book: conservative first-year value of
  // the top recommendations. Never overwrites a figure a human entered.
  if (prospect.pipeline_value == null && result.solutions.length > 0) {
    const estimate = estimatedFirstYearValue(result.solutions.map((s) => s.key));
    if (estimate > 0) update.pipeline_value = estimate;
  }
  if (["new", "researching"].includes(prospect.status)) {
    update.status = "research_complete";
  }
  // Contact details harvested from the company's own website fill any blank
  // CRM fields — a human-entered value is never overwritten. Social links
  // are the exception: a saved link that fails cleanSocialUrl is machine
  // junk (bare facebook.com, fbml tags, share links), so it's replaced
  // with a fresh find or cleared rather than left as a dead DM target.
  for (const key of ["email", "phone"] as const) {
    if (!prospect[key] && result.found[key]) update[key] = result.found[key];
  }
  for (const key of ["instagram_url", "facebook_url", "linkedin_url"] as const) {
    const existingDead = prospect[key] && cleanSocialUrl(prospect[key]) === null;
    if ((!prospect[key] || existingDead) && result.found[key]) {
      update[key] = result.found[key];
    } else if (existingDead) {
      update[key] = null;
    }
  }
  await admin.from("ge_prospects").update(update).eq("id", id);

  // First-touch drafts per channel: refresh existing unsent drafts in place,
  // create the missing ones.
  const draftFor: Record<string, { subject: string | null; body: string }> = {
    linkedin: { subject: null, body: result.drafts.linkedin },
    instagram: { subject: null, body: result.drafts.instagram },
    facebook: { subject: null, body: result.drafts.facebook },
    email: { subject: result.drafts.email.subject, body: result.drafts.email.body },
    sms: { subject: null, body: result.drafts.sms },
  };
  for (const [channel, draft] of Object.entries(draftFor)) {
    if (!draft.body) continue;
    const { data: existing } = await admin
      .from("ge_messages")
      .select("id")
      .eq("prospect_id", id)
      .eq("channel", channel)
      .eq("purpose", "first")
      .eq("status", "draft")
      .maybeSingle();
    if (existing) {
      await admin
        .from("ge_messages")
        .update({ subject: draft.subject, body: draft.body, tone: "professional" })
        .eq("id", existing.id);
    } else {
      await admin.from("ge_messages").insert({
        prospect_id: id,
        campaign_id: prospect.campaign_id,
        channel,
        direction: "outbound",
        status: "draft",
        purpose: "first",
        tone: "professional",
        subject: draft.subject,
        body: draft.body,
        created_by: member.id,
      });
    }
  }

  await admin.from("ge_activities").insert({
    prospect_id: id,
    type: "system",
    content: `Company research completed by ${member.name} (${
      result.websiteFetched ? "website analysed" : "website unreachable — inferred from details"
    }) — ${result.solutions.length} solutions recommended, lead score ${score}/100, outreach drafts prepared`,
    created_by: member.id,
  });

  revalidatePath(`/growth/prospects/${id}`);
  revalidatePath("/growth/prospects");
  revalidatePath("/growth");
  return { ok: true };
}

/**
 * Contact harvest for ONE prospect: reads their website and fills any blank
 * email/phone/social fields — no AI call, so it costs nothing and takes a
 * couple of seconds. Driven in a loop by the ContactHarvest queue on the
 * prospects page to backfill leads researched before harvesting existed.
 */
export async function harvestOne(
  id: string
): Promise<{ ok: true; found: string } | { ok: false; error: string }> {
  await requireGrowth();
  const admin = createAdminClient();
  const { data: p } = await admin
    .from("ge_prospects")
    .select("id, website, email, phone, instagram_url, facebook_url, linkedin_url")
    .eq("id", id)
    .maybeSingle();
  if (!p) return { ok: false, error: "Prospect not found." };
  if (!p.website) return { ok: false, error: "No website on file." };

  const site = await fetchWebsiteText(p.website);
  if (!site) return { ok: true, found: "site unreachable" };

  const update: Record<string, string | null> = {};
  for (const key of ["email", "phone"] as const) {
    if (!p[key] && site.found[key]) update[key] = site.found[key];
  }
  // Dead saved social links (bare domains, share links, fbml tags) get
  // replaced with a fresh find or cleared — never left as dead DM targets.
  for (const key of ["instagram_url", "facebook_url", "linkedin_url"] as const) {
    const existingDead = p[key] && cleanSocialUrl(p[key]) === null;
    if ((!p[key] || existingDead) && site.found[key]) update[key] = site.found[key];
    else if (existingDead) update[key] = null;
  }
  if (Object.keys(update).length > 0) {
    const { error } = await admin.from("ge_prospects").update(update).eq("id", id);
    if (error) return { ok: false, error: error.message };
    // No revalidate here on purpose: the sweep runs this in a loop, and a
    // page refresh per hit makes the driving component's list shrink mid-run
    // (progress read 64/40). The queue does one refresh when it finishes.
  }
  return {
    ok: true,
    found:
      Object.keys(update)
        .map((k) => k.replace("_url", ""))
        .join(", ") || "nothing new on the site",
  };
}

/**
 * The "paste a website, get a researched prospect" entry point (dashboard +
 * prospects screen). Creates the prospect, runs the full research pipeline,
 * then lands in the prospect workspace. If research itself fails, the
 * prospect still exists and the workspace offers a retry with the reason.
 */
export async function quickResearch(_prev: Result, formData: FormData): Promise<Result> {
  const { member } = await requireGrowth();

  // Website is optional: no-website businesses are prime prospects for the
  // Website with Lead Capture pitch. Without one we just need the name.
  const website = String(formData.get("website") ?? "").trim();
  const emailRaw = String(formData.get("email") ?? "").trim();
  if (emailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
    return { error: "Invalid email." };
  }

  let company = String(formData.get("company") ?? "").trim().slice(0, 200);
  if (!company && website) {
    // Derive a starting name from the domain: "www.murphy-plumbing.ie" →
    // "Murphy Plumbing". The research pass refines it; the user can edit.
    try {
      const host = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`)
        .hostname.replace(/^www\./, "");
      company = host
        .split(".")[0]
        .split(/[-_]/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    } catch {
      return { error: "That doesn't look like a valid website address." };
    }
  }
  if (!company) {
    return { error: "Enter the company website, or the company name if they don't have one." };
  }

  const admin = createAdminClient();
  if (emailRaw) {
    const { data: existing } = await admin
      .from("ge_prospects")
      .select("id")
      .ilike("email", emailRaw)
      .maybeSingle();
    if (existing) redirect(`/growth/prospects/${existing.id}`);
  }

  const { data: created, error } = await admin
    .from("ge_prospects")
    .insert({
      company,
      contact_name: String(formData.get("contact_name") ?? "").trim().slice(0, 200) || "Owner",
      website: website || null,
      email: emailRaw || null,
      phone: String(formData.get("phone") ?? "").trim().slice(0, 50) || null,
      linkedin_url: String(formData.get("linkedin_url") ?? "").trim().slice(0, 500) || null,
      instagram_url: String(formData.get("instagram_url") ?? "").trim().slice(0, 500) || null,
      facebook_url: String(formData.get("facebook_url") ?? "").trim().slice(0, 500) || null,
      status: "researching",
      source: "quick-research",
      created_by: member.id,
      assigned_to: member.id,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  await admin.from("ge_activities").insert({
    prospect_id: created.id,
    type: "system",
    content: `Prospect created via quick research by ${member.name}`,
    created_by: member.id,
  });

  const researchForm = new FormData();
  researchForm.set("id", created.id);
  const research = await researchProspect(undefined, researchForm);

  revalidatePath("/growth/prospects");
  redirect(
    research?.error
      ? `/growth/prospects/${created.id}?notice=${encodeURIComponent(research.error)}`
      : `/growth/prospects/${created.id}`
  );
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

  // A logged call or meeting IS contact — mirror a sent message: stamp the
  // last-contact date and schedule the +3-day follow-up so a called lead
  // can't leak, and nudge an untouched prospect to "Contacted". Notes never
  // change the pipeline. Later stages are never regressed.
  if (type === "call" || type === "meeting") {
    const { data: p } = await admin
      .from("ge_prospects")
      .select("status")
      .eq("id", id)
      .maybeSingle();
    if (p) {
      const bump: Record<string, unknown> = {
        last_contact_at: new Date().toISOString(),
        next_follow_up_at: dublinDate(3),
      };
      if (
        ["new", "researching", "research_complete", "outreach_ready"].includes(
          p.status
        )
      ) {
        bump.status = "contacted";
      }
      await admin.from("ge_prospects").update(bump).eq("id", id);
    }
  }

  revalidatePath(`/growth/prospects/${id}`);
  revalidatePath("/growth");
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

/**
 * Bulk table actions: archive keeps the record + history but clears it out
 * of every working list; delete removes the prospect and (via FK cascade)
 * all research, messages, activities, tasks and meetings — owners only.
 */
export async function bulkProspectAction(_prev: Result, formData: FormData): Promise<Result> {
  const { member } = await requireGrowth();
  const intent = String(formData.get("intent") ?? "");
  const ids = formData.getAll("ids").map(String).filter(Boolean).slice(0, 500);
  if (ids.length === 0) return { error: "Tick at least one prospect first." };

  const admin = createAdminClient();

  if (intent === "delete") {
    if (member.role !== "owner") return { error: "Only owners can delete prospects." };
    const { error } = await admin.from("ge_prospects").delete().in("id", ids);
    if (error) return { error: error.message };
  } else if (intent === "archive") {
    const { error } = await admin
      .from("ge_prospects")
      .update({ status: "archived", next_follow_up_at: null })
      .in("id", ids);
    if (error) return { error: error.message };
  } else {
    return { error: "Unknown action." };
  }

  revalidatePath("/growth/prospects");
  revalidatePath("/growth");
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
