import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What happens when a customer accepts a quote.
 *
 * Until now: nothing. The status flipped to 'accepted', an email told the owner
 * "time to get the job booked in", and that was the end of it. The single
 * highest-value event in the whole platform — a customer saying YES to a
 * price — produced no record anywhere except the quote row itself.
 *
 * So ClientIQ, sold as "every customer and lead in one place, searchable and
 * up to date", did not know about the customer who had just agreed to pay.
 * You could win five jobs in a week and the CRM would show nothing. That is
 * the gap between a set of separate tools and a platform, and it sits on the
 * exact event that matters most.
 *
 * This closes it: an accepted quote creates or updates the ClientIQ contact,
 * moves them to `won`, records the value, and writes the decision into their
 * activity timeline. A declined quote is recorded too — a lost job is worth
 * knowing about, and it is still a real customer record for the next attempt.
 *
 * EVERYTHING HERE IS BEST-EFFORT. It runs inside the public accept endpoint,
 * where the customer has already made their decision and the quote is already
 * updated. A CRM write must never be able to fail that, so every path returns
 * a result rather than throwing, and the caller ignores it.
 */

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

export type QuoteDecision = "accepted" | "declined";

export type QuoteForCrm = {
  id: string;
  business_id: string;
  customer_name: string;
  customer_email: string | null;
  /** TEXT in the schema — "€1,250", "1250", "from €900", anything. */
  total: string | null;
  job_description?: string | null;
};

export type CrmSyncResult =
  | { ok: true; contactId: string; created: boolean; stage: string }
  | { ok: false; reason: string };

/**
 * Stages a decision may move a contact INTO.
 *
 * Deliberately not symmetric. Accepting always wins them; declining only marks
 * a loss for a contact that hasn't already won something. A customer who
 * accepted a bathroom quote in March and declines a boiler quote in June is
 * still a won customer — flipping them to 'lost' would delete that fact from
 * the only place it is recorded.
 */
const STAGE_FOR: Record<QuoteDecision, "won" | "lost"> = {
  accepted: "won",
  declined: "lost",
};

/** Stages a DECLINE is allowed to overwrite. 'won' is deliberately absent. */
const DECLINE_MAY_OVERWRITE = ["new", "contacted", "qualified", "lost"];

/**
 * Pulls a number out of the free-text total.
 *
 * `qa_quotes.total` is TEXT and holds whatever the generator produced —
 * "€1,250.00", "1250", "from €900", "TBC". `crm_contacts.value` is numeric, so
 * anything unparseable has to become null rather than a guess: a wrong deal
 * value silently inflates the pipeline every dashboard reads.
 */
export function parseQuoteTotal(total: string | null | undefined): number | null {
  if (!total) return null;
  // Strip currency symbols, spaces and thousands separators; keep one decimal
  // point. A range ("900-1200") takes the FIRST number: committing to the
  // lower end understates the pipeline, which is the safe direction.
  const cleaned = total.replace(/[^\d.,-]/g, "").trim();
  const firstChunk = cleaned.split(/(?<=\d)\s*-\s*(?=\d)/)[0] ?? cleaned;
  const noThousands = firstChunk.replace(/,(?=\d{3}\b)/g, "");
  const match = noThousands.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/** The line written into the contact's timeline. */
export function decisionNote(
  decision: QuoteDecision,
  quote: Pick<QuoteForCrm, "total" | "job_description">
): string {
  const amount = quote.total?.trim();
  const job = quote.job_description?.trim();
  const forJob = job ? ` for ${job.slice(0, 120)}${job.length > 120 ? "…" : ""}` : "";
  return decision === "accepted"
    ? `Quote accepted${amount ? ` (${amount})` : ""}${forJob} — won through QuoteIQ.`
    : `Quote declined${amount ? ` (${amount})` : ""}${forJob}.`;
}

/**
 * Creates or updates the ClientIQ contact for a decided quote.
 *
 * Matching, in order: email (case-insensitive, the same key the table's own
 * unique index uses), then name within the business. A quote sent without an
 * email still produces a real contact — the alternative is losing the record
 * of a won job because nobody typed an address.
 */
export async function syncQuoteDecisionToCrm(
  admin: Client,
  quote: QuoteForCrm,
  decision: QuoteDecision
): Promise<CrmSyncResult> {
  try {
    const email = quote.customer_email?.trim() || null;
    const name = quote.customer_name?.trim() || "Customer";
    const stage = STAGE_FOR[decision];
    const value = parseQuoteTotal(quote.total);

    let existing: { id: string; stage: string; notes: string; value: number | null } | null =
      null;

    if (email) {
      const { data } = await admin
        .from("crm_contacts")
        .select("id, stage, notes, value")
        .eq("business_id", quote.business_id)
        .ilike("email", email)
        .maybeSingle();
      existing = data ?? null;
    }
    if (!existing) {
      const { data } = await admin
        .from("crm_contacts")
        .select("id, stage, notes, value")
        .eq("business_id", quote.business_id)
        .ilike("name", name)
        .is("email", null)
        .maybeSingle();
      existing = data ?? null;
    }

    const note = decisionNote(decision, quote);
    let contactId: string;
    let created = false;
    let finalStage: string;

    if (existing) {
      // A decline never overwrites a contact who has already won work.
      finalStage =
        decision === "accepted" || DECLINE_MAY_OVERWRITE.includes(existing.stage)
          ? stage
          : existing.stage;
      const update: Record<string, unknown> = {
        stage: finalStage,
        last_activity_at: new Date().toISOString(),
      };
      // Only raise the recorded value on a win, and never lower an existing
      // one — a second smaller job doesn't shrink what the customer is worth.
      if (decision === "accepted" && value !== null) {
        update.value = Math.max(value, Number(existing.value ?? 0));
      }
      const { error } = await admin
        .from("crm_contacts")
        .update(update)
        .eq("id", existing.id);
      if (error) return { ok: false, reason: error.message };
      contactId = existing.id;
    } else {
      const { data, error } = await admin
        .from("crm_contacts")
        .insert({
          business_id: quote.business_id,
          name,
          email,
          stage,
          value,
          source: "QuoteIQ",
          notes: "",
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

    // The timeline entry is the point: "won through QuoteIQ" with the amount,
    // sitting on the customer record where anyone would look for it.
    const { error: actError } = await admin.from("crm_activities").insert({
      business_id: quote.business_id,
      contact_id: contactId,
      type: decision === "accepted" ? "won" : "note",
      body: note,
    });
    if (actError) {
      // The contact landed; only the timeline line failed. Report it rather
      // than claiming a clean sync, but don't undo the useful half.
      return { ok: false, reason: `contact saved, activity failed: ${actError.message}` };
    }

    return { ok: true, contactId, created, stage: finalStage };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "unknown error",
    };
  }
}
