"use server";

import { escapeLike } from "@/lib/growth/db";
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

/**
 * Imports every contact the platform already knows about — review
 * customers, website leads, and quote recipients — into the CRM, deduped by
 * email, and logs a source activity for each. This is what makes the CRM a
 * live system on day one rather than an empty table. Idempotent.
 */
export async function importContacts(): Promise<
  { ok: true; imported: number } | { ok: false; error: string }
> {
  const { businessId, enabled, supabase } = await ctx();
  if (!enabled) return { ok: false, error: "ClientIQ is not enabled." };

  const [{ data: customers }, { data: leads }, { data: quotes }] =
    await Promise.all([
      supabase.from("ra_customers").select("name, email, created_at"),
      supabase.from("wa_leads").select("name, contact, created_at"),
      supabase.from("qa_quotes").select("customer_name, customer_email, total, created_at"),
    ]);

  type Incoming = {
    name: string;
    email: string | null;
    phone: string | null;
    source: string;
    activity: string;
    at: string;
  };
  const incoming: Incoming[] = [];
  for (const c of customers ?? [])
    incoming.push({
      name: c.name,
      email: c.email,
      phone: null,
      source: "ReputationIQ",
      activity: "Review request sent",
      at: c.created_at,
    });
  for (const l of leads ?? []) {
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
  for (const q of quotes ?? [])
    incoming.push({
      name: q.customer_name,
      email: q.customer_email,
      phone: null,
      source: "QuoteIQ",
      activity: `Quote created${q.total ? ` (${q.total})` : ""}`,
      at: q.created_at,
    });

  let imported = 0;
  for (const item of incoming) {
    // Find an existing contact by email (preferred) or name.
    let contactId: string | null = null;
    if (item.email) {
      const { data } = await supabase
        .from("crm_contacts")
        .select("id")
        .ilike("email", escapeLike(item.email))
        .maybeSingle();
      contactId = data?.id ?? null;
    }
    if (!contactId) {
      const { data } = await supabase
        .from("crm_contacts")
        .select("id")
        .eq("name", item.name)
        .is("email", item.email ? item.email : null)
        .maybeSingle();
      contactId = data?.id ?? null;
    }

    if (!contactId) {
      const { data, error } = await supabase
        .from("crm_contacts")
        .insert({
          business_id: businessId,
          name: item.name,
          email: item.email,
          phone: item.phone,
          source: item.source,
          last_activity_at: item.at,
        })
        .select("id")
        .single();
      if (error) {
        if (isMissingTableError(error)) {
          return { ok: false, error: reportMissingTable("ClientIQ", "supabase/manual_update_0008.sql", error) };
        }
        continue;
      }
      contactId = data.id;
      imported += 1;
    }

    // Log the source activity if this exact one isn't already recorded.
    const { data: existing } = await supabase
      .from("crm_activities")
      .select("id")
      .eq("contact_id", contactId)
      .eq("body", item.activity)
      .maybeSingle();
    if (!existing) {
      await supabase.from("crm_activities").insert({
        business_id: businessId,
        contact_id: contactId,
        type: "system",
        body: item.activity,
        created_at: item.at,
      });
    }
  }

  revalidatePath("/portal/crm-agent");
  return { ok: true, imported };
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
