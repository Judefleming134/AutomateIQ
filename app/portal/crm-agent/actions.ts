"use server";

import { escapeLike, selectAllRows } from "@/lib/growth/db";
import {
  planImport,
  contactKey,
  chunk,
  type SourceRow,
  type ExistingContact,
  type ExistingActivity,
} from "@/lib/crm/import-plan";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/require-session";
import { requireProductEnabled } from "@/lib/auth/require-product";
import { createClient } from "@/lib/supabase/server";
import { isMissingTableError, reportMissingTable } from "@/lib/db/errors";

async function ctx() {
  const { profile } = await requireSession();
  const businessId = profile.business_id!;
  const enabled = await requireProductEnabled(businessId, "crm-agent");
  const supabase = await createClient();
  return { businessId, enabled, supabase };
}

/** Rows per bulk insert. Well inside PostgREST's request-body limits. */
const INSERT_CHUNK = 500;

/**
 * Imports every contact the platform already knows about — review
 * customers, website leads, and quote recipients — into the CRM, deduped by
 * email, and logs a source activity for each. This is what makes the CRM a
 * live system on day one rather than an empty table. Idempotent.
 *
 * FERRARI PASS. This used to ask the database three-to-five questions about
 * every single source record, one after another: find by email, find by name,
 * does this activity exist, insert the contact, insert the activity. At 415
 * records (a year of a real trade business) that is ~2,000 sequential queries
 * — roughly 52 seconds of pure round trips, past the Server Action limit. The
 * button spun and then failed on precisely the businesses with enough history
 * to need it, and there was no way to tell that from "Importing…".
 *
 * It is now five reads in ONE wave, planned in memory (lib/crm/import-plan.ts),
 * then bulk inserts in chunks of 500 — seven queries for that same import.
 *
 * The two reads it gained also fix a silent truncation: the three source
 * selects had no paging, so PostgREST's 1,000-row cap meant a business past a
 * thousand review customers imported the first thousand and reported success.
 * `selectAllRows` pages past it.
 */
export async function importContacts(): Promise<
  { ok: true; imported: number; failed: number } | { ok: false; error: string }
> {
  const { businessId, enabled, supabase } = await ctx();
  if (!enabled) return { ok: false, error: "ClientIQ is not enabled." };

  type RaCustomer = { name: string; email: string | null; created_at: string };
  type WaLead = { name: string; contact: string | null; created_at: string };
  type QaQuote = {
    customer_name: string;
    customer_email: string | null;
    total: string | null;
    created_at: string;
  };

  let customers: RaCustomer[];
  let leads: WaLead[];
  let quotes: QaQuote[];
  let existingContacts: ExistingContact[];
  let existingActivities: ExistingActivity[];
  try {
    [customers, leads, quotes, existingContacts, existingActivities] = await Promise.all([
      selectAllRows<RaCustomer>(() =>
        supabase.from("ra_customers").select("name, email, created_at")
      ),
      selectAllRows<WaLead>(() =>
        supabase.from("wa_leads").select("name, contact, created_at")
      ),
      selectAllRows<QaQuote>(() =>
        supabase
          .from("qa_quotes")
          .select("customer_name, customer_email, total, created_at")
      ),
      selectAllRows<ExistingContact>(() =>
        supabase.from("crm_contacts").select("id, name, email")
      ),
      selectAllRows<ExistingActivity>(() =>
        supabase.from("crm_activities").select("contact_id, body")
      ),
    ]);
  } catch (err) {
    // selectAllRows throws rather than return a short list, because a short
    // list here would re-import contacts that already exist. Surface it.
    const message = err instanceof Error ? err.message : String(err);
    if (/crm_contacts|crm_activities/.test(message) && /does not exist/i.test(message)) {
      return {
        ok: false,
        error: reportMissingTable("ClientIQ", "supabase/manual_update_0008.sql", { message }),
      };
    }
    return { ok: false, error: `Couldn't read your existing records — ${message}` };
  }

  const incoming: SourceRow[] = [];
  for (const c of customers)
    incoming.push({
      name: c.name,
      email: c.email,
      phone: null,
      source: "ReputationIQ",
      activity: "Review request sent",
      at: c.created_at,
    });
  for (const l of leads) {
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l.contact ?? "");
    incoming.push({
      name: l.name,
      email: isEmail ? l.contact : null,
      phone: isEmail ? null : l.contact,
      source: "SiteIQ",
      activity: "Captured as a website lead",
      at: l.created_at,
    });
  }
  for (const q of quotes)
    incoming.push({
      name: q.customer_name,
      email: q.customer_email,
      phone: null,
      source: "QuoteIQ",
      activity: `Quote created${q.total ? ` (${q.total})` : ""}`,
      at: q.created_at,
    });

  const plan = planImport(incoming, existingContacts, existingActivities);

  // ---- create the new contacts -------------------------------------------
  const idByKey = new Map<string, string>();
  let imported = 0;
  let failed = 0;

  for (const batch of chunk(plan.create, INSERT_CHUNK)) {
    const rows = batch.map((c) => ({
      business_id: businessId,
      name: c.name,
      email: c.email,
      phone: c.phone,
      source: c.source,
      last_activity_at: c.last_activity_at,
    }));
    const { data, error } = await supabase
      .from("crm_contacts")
      .insert(rows)
      .select("id, name, email");

    if (!error && data) {
      for (const r of data as ExistingContact[]) idByKey.set(contactKey(r.name, r.email), r.id);
      imported += data.length;
      continue;
    }

    if (error && isMissingTableError(error)) {
      return {
        ok: false,
        error: reportMissingTable("ClientIQ", "supabase/manual_update_0008.sql", error),
      };
    }

    // One bad row must not cost the other 499. Fall back to per-row inserts
    // for this chunk only — the slow path, on the rare path.
    for (const c of batch) {
      const { data: one, error: oneErr } = await supabase
        .from("crm_contacts")
        .insert({
          business_id: businessId,
          name: c.name,
          email: c.email,
          phone: c.phone,
          source: c.source,
          last_activity_at: c.last_activity_at,
        })
        .select("id, name, email")
        .single();
      if (!oneErr && one) {
        idByKey.set(contactKey(one.name, one.email), one.id);
        imported += 1;
        continue;
      }
      // Already there (unique index on lower(email)) — adopt it rather than
      // counting it as an import, so the activity below still lands.
      if (oneErr?.code === "23505" && c.email) {
        const { data: found } = await supabase
          .from("crm_contacts")
          .select("id, name, email")
          .ilike("email", escapeLike(c.email))
          .maybeSingle();
        if (found) {
          idByKey.set(contactKey(found.name, found.email), found.id);
          continue;
        }
      }
      failed += 1;
    }
  }

  // ---- write the timeline entries ----------------------------------------
  const activityRows = [
    ...plan.forExisting.map((a) => ({
      business_id: businessId,
      contact_id: a.contact_id,
      type: "system",
      body: a.body,
      created_at: a.created_at,
    })),
    // Contacts whose insert failed have no id — their activities are dropped
    // rather than orphaned, and the failure is already counted above.
    ...plan.forNew.flatMap((a) => {
      const id = idByKey.get(a.key);
      return id
        ? [{
            business_id: businessId,
            contact_id: id,
            type: "system",
            body: a.body,
            created_at: a.created_at,
          }]
        : [];
    }),
  ];

  for (const batch of chunk(activityRows, INSERT_CHUNK)) {
    const { error } = await supabase.from("crm_activities").insert(batch);
    if (error) console.error("[crm-import] activity batch failed:", error.message);
  }

  revalidatePath("/portal/crm-agent");
  return { ok: true, imported, failed };
}

const contactSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(160),
  email: z.string().trim().email("Enter a valid email").or(z.literal("")).optional(),
  phone: z.string().trim().max(40).optional(),
  company: z.string().trim().max(160).optional(),
});

export async function addContact(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
) {
  const { businessId, enabled, supabase } = await ctx();
  if (!enabled) return { error: "ClientIQ is not enabled." };

  const parsed = contactSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email") || "",
    phone: formData.get("phone") || undefined,
    company: formData.get("company") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const { error } = await supabase.from("crm_contacts").insert({
    business_id: businessId,
    name: parsed.data.name,
    email: parsed.data.email || null,
    phone: parsed.data.phone || null,
    company: parsed.data.company || null,
    source: "Added manually",
  });
  if (error) {
    if (error.code === "23505") return { error: "A contact with that email already exists." };
    if (isMissingTableError(error))
      return { error: reportMissingTable("ClientIQ", "supabase/manual_update_0008.sql", error) };
    return { error: error.message };
  }
  revalidatePath("/portal/crm-agent");
  return { ok: true };
}

const STAGES = ["new", "contacted", "qualified", "won", "lost"] as const;

export async function updateStage(contactId: string, stage: string) {
  const { businessId, enabled, supabase } = await ctx();
  if (!enabled) return { ok: false as const, error: "Not enabled." };
  if (!STAGES.includes(stage as (typeof STAGES)[number])) {
    return { ok: false as const, error: "Invalid stage." };
  }
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("crm_contacts")
    .update({ stage, last_activity_at: now })
    .eq("id", contactId);
  if (error) return { ok: false as const, error: error.message };
  await supabase.from("crm_activities").insert({
    business_id: businessId,
    contact_id: contactId,
    type: "system",
    body: `Stage changed to ${stage}`,
  });
  revalidatePath("/portal/crm-agent");
  revalidatePath(`/portal/crm-agent/${contactId}`);
  return { ok: true as const };
}

export async function addNote(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
) {
  const { businessId, enabled, supabase } = await ctx();
  if (!enabled) return { error: "Not enabled." };
  const contactId = String(formData.get("contactId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!contactId || body.length < 1) return { error: "Write a note first." };
  if (body.length > 4000) return { error: "Note too long." };

  const { error } = await supabase.from("crm_activities").insert({
    business_id: businessId,
    contact_id: contactId,
    type: "note",
    body,
  });
  if (error) return { error: error.message };
  await supabase
    .from("crm_contacts")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", contactId);
  revalidatePath(`/portal/crm-agent/${contactId}`);
  return { ok: true };
}

export async function addTask(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
) {
  const { businessId, enabled, supabase } = await ctx();
  if (!enabled) return { error: "Not enabled." };
  const title = String(formData.get("title") ?? "").trim();
  const dueDate = String(formData.get("dueDate") ?? "").trim();
  const contactId = String(formData.get("contactId") ?? "") || null;
  if (title.length < 1) return { error: "Give the task a title." };

  const { error } = await supabase.from("crm_tasks").insert({
    business_id: businessId,
    contact_id: contactId,
    title: title.slice(0, 300),
    due_date: dueDate || null,
  });
  if (error) {
    if (isMissingTableError(error))
      return { error: reportMissingTable("ClientIQ", "supabase/manual_update_0008.sql", error) };
    return { error: error.message };
  }
  revalidatePath("/portal/crm-agent");
  if (contactId) revalidatePath(`/portal/crm-agent/${contactId}`);
  return { ok: true };
}

export async function toggleTask(taskId: string, done: boolean) {
  const { enabled, supabase } = await ctx();
  if (!enabled) return { ok: false as const };
  await supabase.from("crm_tasks").update({ done }).eq("id", taskId);
  revalidatePath("/portal/crm-agent");
  return { ok: true as const };
}
