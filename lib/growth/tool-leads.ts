import "server-only";
import { createClient } from "@supabase/supabase-js";
import { escapeLike } from "@/lib/growth/db";

/**
 * Free-tool results → the Growth Engine.
 *
 * Someone runs AutoSEO on their own site, gets a real score and a real list of
 * what's wrong, and leaves. `ge_prospects` never hears about them — the single
 * biggest hole in the funnel, and the one the free tools exist to fill.
 *
 * THE CONSENT LINE, which is the whole design:
 *
 *   The report itself stays free and completely ungated. Nothing here runs
 *   when someone merely uses a tool. It runs only when they ASK for something
 *   back — the report emailed to them, or us to do the work. That is the
 *   moment they've offered an address, and it's also the moment the tool
 *   copy already promises ("nothing is stored unless you ask us to email it
 *   to you"). Gating the result behind an email would earn more addresses and
 *   fewer customers, and would make that promise a lie.
 *
 * Deliberately NOT `createAdminClient()`: that helper's contract is "only call
 * from code already gated by requireAdmin()", which cannot hold on a public
 * endpoint. Same pattern as /api/lead.
 */

export type ToolLeadInput = {
  email: string;
  /** Catalog slug — "autoseo", "missed-calls", … */
  tool: string;
  /** Human name of the tool, for the note. */
  toolLabel: string;
  /** The site or business the tool was run against, when there is one. */
  subject?: string | null;
  /** Headline number the tool produced, already formatted ("42/100", "€56,441/yr"). */
  headline?: string | null;
  /** The single most useful finding, one line. */
  topFinding?: string | null;
};

export type ToolLeadResult =
  | { ok: true; created: boolean; prospectId: string }
  | { ok: false; error: string };

/**
 * The note that lands on the prospect. Pure, so it can be tested — and so the
 * exact words Jude reads before a call are pinned rather than incidental.
 *
 * Deliberately terse and factual. This is the first thing seen when the record
 * is opened, and a wall of prose there is a wall of prose on every cold call.
 */
export function buildToolLeadNote(input: ToolLeadInput, at: Date = new Date()): string {
  const day = at.toISOString().slice(0, 10);
  const lines = [`Came in from the free ${input.toolLabel} on ${day}.`];
  if (input.subject) lines.push(`Ran it on: ${input.subject}`);
  if (input.headline) lines.push(`Result: ${input.headline}`);
  if (input.topFinding) lines.push(`Biggest issue: ${input.topFinding}`);
  lines.push("They asked us to follow up — this is a warm inbound, not a cold list.");
  return lines.join("\n");
}

/**
 * Company name for the record.
 *
 * `ge_prospects.company` is NOT NULL and it's the first thing shown in every
 * list, so it has to be something. The site they ran the tool on is the best
 * guess available; the email domain is the fallback; a free-mail domain tells
 * us nothing, so those fall through to the local part rather than filing forty
 * unrelated people under "Gmail".
 */
const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.co.uk", "outlook.com",
  "outlook.ie", "live.com", "live.ie", "yahoo.com", "yahoo.co.uk", "yahoo.ie",
  "icloud.com", "me.com", "aol.com", "eircom.net", "proton.me", "protonmail.com",
]);

export function companyFromLead(input: { email: string; subject?: string | null }): string {
  const host = (input.subject ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
  if (host && host.includes(".")) return host;

  const domain = input.email.split("@")[1]?.toLowerCase() ?? "";
  if (domain && !FREE_MAIL.has(domain)) return domain.replace(/^www\./, "");

  const local = input.email.split("@")[0] ?? "";
  return local ? `${local} (free tools)` : "Free tools enquiry";
}

/** Every source string a free-tool lead can carry. Kept narrow on purpose. */
export const TOOL_LEAD_SOURCE = "freetools";

export async function captureToolLead(input: ToolLeadInput): Promise<ToolLeadResult> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, error: "not_configured" };

  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const email = input.email.trim();
  const note = buildToolLeadNote(input);

  // Dedupe case-INSENSITIVELY, same as addProspect. Someone who runs three
  // tools in an evening is one prospect with three notes, not three duplicate
  // rows Jude has to merge by hand before he can call anyone.
  const { data: existing } = await admin
    .from("ge_prospects")
    .select("id, notes")
    .ilike("email", escapeLike(email))
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Never overwrite an existing note — append. That record may already hold
    // research, call outcomes and a proposal history.
    const merged = [String(existing.notes ?? "").trim(), note]
      .filter(Boolean)
      .join("\n\n");
    await admin
      .from("ge_prospects")
      .update({ notes: merged.slice(0, 8000) })
      .eq("id", existing.id);
    await admin.from("ge_activities").insert({
      prospect_id: existing.id,
      type: "system",
      content: `Used the free ${input.toolLabel} again and asked us to follow up${
        input.headline ? ` — ${input.headline}` : ""
      }`,
    });
    return { ok: true, created: false, prospectId: existing.id };
  }

  const { data: created, error } = await admin
    .from("ge_prospects")
    .insert({
      company: companyFromLead(input),
      // Matches addProspect's default rather than inventing a name we don't
      // have. "Owner" is what the outreach templates fall back to.
      contact_name: "Owner",
      email,
      website: input.subject ?? null,
      source: TOOL_LEAD_SOURCE,
      status: "new",
      notes: note,
    })
    .select("id")
    .single();

  if (error || !created) return { ok: false, error: error?.message ?? "insert_failed" };

  await admin.from("ge_activities").insert({
    prospect_id: created.id,
    type: "system",
    content: `Inbound from the free ${input.toolLabel}${
      input.headline ? ` — ${input.headline}` : ""
    }`,
  });

  return { ok: true, created: true, prospectId: created.id };
}
