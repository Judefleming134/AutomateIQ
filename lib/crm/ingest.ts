import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeLike } from "@/lib/growth/db";

/**
 * Every customer and lead in one place — automatically.
 *
 * ClientIQ is sold as "every customer and lead in one place, searchable and up
 * to date". It was neither automatic nor up to date: the only way anything
 * reached it was `importContacts()`, a button somebody had to remember to
 * press. A lead that came in through the website at 3am did not exist in the
 * CRM until a human clicked Import — so the answer to "is this person in the
 * system?" was "maybe, depending on when you last synced".
 *
 * That is the difference between a list you maintain and a record you can
 * trust. This is the shared write every source calls the moment something
 * happens, so the CRM is current by construction rather than by discipline.
 *
 * Sources: SiteIQ/LeadIQ web leads, ReputationIQ review customers, QuoteIQ
 * quotes and invoices. The manual import stays for backfilling history.
 */

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

export type CrmStage = "new" | "contacted" | "qualified" | "won" | "lost";

/**
 * Pipeline order. A contact only ever moves FORWARD through it.
 *
 * This is the rule that makes automatic ingestion safe. Without it, a won
 * customer who fills in the website form again — asking about a second job —
 * would be reset to 'new', wiping the fact that they have already bought from
 * you. The most valuable thing the CRM knows would be destroyed by the very
 * automation meant to keep it current.
 *
 * 'lost' sits below 'won' deliberately: someone who declined once and later
 * bought is won, and nothing should push them back.
 */
const STAGE_ORDER: CrmStage[] = ["new", "contacted", "qualified", "lost", "won"];

export function highestStage(current: string | null | undefined, incoming: CrmStage): CrmStage {
  const a = STAGE_ORDER.indexOf((current ?? "new") as CrmStage);
  const b = STAGE_ORDER.indexOf(incoming);
  if (a < 0) return incoming;
  if (b < 0) return (current as CrmStage) ?? "new";
  return STAGE_ORDER[Math.max(a, b)];
}

export type CrmIngestInput = {
  businessId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  /** Which product this came from — shown on the contact. */
  source: string;
  /** One line for the timeline. Deduped, so re-ingesting never spams it. */
  activity: string;
  /** Only applied if it is FURTHER along than where they already are. */
  stage?: CrmStage;
  /** Deal value in cents. Only ever raised, never lowered. */
  valueCents?: number | null;
  /** When it happened. Defaults to now. */
  at?: string;
};

export type CrmIngestResult =
  | { ok: true; contactId: string; created: boolean; stage: CrmStage }
  | { ok: false; reason: string };

/** A contact needs SOMETHING to identify it by, or it is noise in the list. */
function usable(input: CrmIngestInput): boolean {
  return Boolean(input.businessId && (input.name?.trim() || input.email?.trim()));
}

/**
 * Creates or updates the ClientIQ contact for whatever just happened.
 *
 * Never throws. Every caller is a live path — a customer submitting a form, a
 * review request going out — where the CRM write is the least important thing
 * happening and must never be able to break the thing that matters.
 */
export async function ingestCrmContact(
  admin: Client,
  input: CrmIngestInput
): Promise<CrmIngestResult> {
  if (!usable(input)) return { ok: false, reason: "nothing to identify the contact by" };

  try {
    const email = input.email?.trim() || null;
    const phone = input.phone?.trim() || null;
    const name = input.name?.trim() || email || "Customer";
    const at = input.at ?? new Date().toISOString();
    const stage: CrmStage = input.stage ?? "new";

    // Match on email first — the same key the table's unique index uses — then
    // fall back to an exact name within the business for contacts that have
    // never given one. Both scoped by business_id: two tenants can legitimately
    // share a customer, and matching across them would leak one's data to the
    // other.
    let existing: { id: string; stage: string; value: number | null; phone: string | null } | null =
      null;
    if (email) {
      const { data } = await admin
        .from("crm_contacts")
        .select("id, stage, value, phone")
        .eq("business_id", input.businessId)
        .ilike("email", escapeLike(email))
        .maybeSingle();
      existing = data ?? null;
    }
    if (!existing) {
      const { data } = await admin
        .from("crm_contacts")
        .select("id, stage, value, phone")
        .eq("business_id", input.businessId)
        .ilike("name", escapeLike(name))
        .is("email", null)
        .maybeSingle();
      existing = data ?? null;
    }

    let contactId: string;
    let created = false;
    let finalStage: CrmStage;

    if (existing) {
      finalStage = highestStage(existing.stage, stage);
      const update: Record<string, unknown> = {
        stage: finalStage,
        last_activity_at: at,
      };
      // Fill a blank, never overwrite. A phone number already on the record
      // was probably typed by a human and is likelier to be right than one
      // scraped off a form.
      if (phone && !existing.phone) update.phone = phone;
      if (input.valueCents != null) {
        update.value = Math.max(input.valueCents, Number(existing.value ?? 0));
      }
      const { error } = await admin.from("crm_contacts").update(update).eq("id", existing.id);
      if (error) return { ok: false, reason: error.message };
      contactId = existing.id;
    } else {
      const { data, error } = await admin
        .from("crm_contacts")
        .insert({
          business_id: input.businessId,
          name,
          email,
          phone,
          stage,
          source: input.source,
          value: input.valueCents ?? null,
          last_activity_at: at,
        })
        .select("id")
        .single();
      if (error || !data) {
        return { ok: false, reason: error?.message ?? "insert returned no row" };
      }
      contactId = data.id;
      created = true;
      finalStage = stage;
    }

    // Deduped on the exact line, so the manual import and the automatic path
    // can both run over the same event without doubling the timeline.
    const { data: dupe } = await admin
      .from("crm_activities")
      .select("id")
      .eq("contact_id", contactId)
      .eq("body", input.activity)
      .maybeSingle();
    if (!dupe) {
      const { error } = await admin.from("crm_activities").insert({
        business_id: input.businessId,
        contact_id: contactId,
        type: "system",
        body: input.activity,
        created_at: at,
      });
      if (error) {
        return { ok: false, reason: `contact saved, activity failed: ${error.message}` };
      }
    }

    return { ok: true, contactId, created, stage: finalStage };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "unknown error" };
  }
}
