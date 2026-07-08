import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  sendOutreachEmail,
  sanitizeOutreachBody,
  draftLooksBroken,
  reviewOutreachEmail,
} from "@/lib/growth/email";
import { recordOutreachSent } from "@/lib/growth/outreach";

/**
 * Email autopilot: the one channel with a real sending API, made hands-off.
 * Candidates are researched prospects with an email address and a ready
 * first-touch email draft. From the Jarvis panel they can be fired
 * immediately or queued; queued emails are sent automatically by the daily
 * cron. Every autopilot send books identical CRM side-effects to a manual
 * send (recordOutreachSent), so tracking stays complete.
 */

export type AutopilotCandidate = {
  messageId: string;
  prospectId: string;
  company: string;
  contactName: string;
  email: string;
  subject: string;
  body: string;
  leadScore: number;
  industry: string | null;
  queued: boolean;
  /** Why this draft can't be auto-sent (old placeholder/invented-name
   *  drafts) — regenerate in the Studio first. Null when clean. */
  broken: string | null;
  /** Why this draft is likely out of date (research changed since it was
   *  written, or it's simply old) — regenerate for the freshest angle.
   *  Unlike `broken`, a stale draft is still sendable if Jude chooses. */
  stale: string | null;
};

const READY_STATUSES = ["research_complete", "outreach_ready"];
/** Drafts older than this are flagged for a refresh even if research
 *  hasn't changed — an outreach angle written days ago goes off the boil. */
const STALE_AGE_DAYS = 5;

/** Researched, uncontacted, has an address, has an email draft — top scores first. */
export async function listAutopilotCandidates(
  limit = 25
): Promise<AutopilotCandidate[]> {
  const admin = createAdminClient();
  const { data: prospects } = await admin
    .from("ge_prospects")
    .select("id, company, contact_name, email, industry, lead_score")
    .in("status", READY_STATUSES)
    .not("email", "is", null)
    .order("lead_score", { ascending: false, nullsFirst: false })
    .limit(limit * 2);
  const ids = (prospects ?? []).map((p) => p.id);
  if (ids.length === 0) return [];

  const [{ data: drafts }, { data: research }] = await Promise.all([
    admin
      .from("ge_messages")
      .select("id, prospect_id, subject, body, status, created_at")
      .in("prospect_id", ids)
      .eq("channel", "email")
      .eq("direction", "outbound")
      .in("status", ["draft", "queued"])
      .order("created_at", { ascending: false }),
    admin
      .from("ge_research")
      .select("prospect_id, updated_at")
      .in("prospect_id", ids),
  ]);

  // When was each prospect's research last refreshed? A draft written before
  // that is built on analysis that has since changed.
  const researchUpdated = new Map<string, string>();
  for (const r of research ?? []) {
    if (r.updated_at) researchUpdated.set(r.prospect_id, r.updated_at);
  }

  // Newest email draft per prospect wins (research refreshes in place, but
  // a studio draft may be newer and better-tuned).
  const draftByProspect = new Map<string, NonNullable<typeof drafts>[number]>();
  for (const d of drafts ?? []) {
    if (!draftByProspect.has(d.prospect_id)) draftByProspect.set(d.prospect_id, d);
  }

  const staleBefore = Date.now() - STALE_AGE_DAYS * 24 * 3600 * 1000;

  const out: AutopilotCandidate[] = [];
  for (const p of prospects ?? []) {
    const d = draftByProspect.get(p.id);
    if (!d || !p.email) continue;
    const body = sanitizeOutreachBody(d.body);
    const draftAt = new Date(d.created_at).getTime();
    const researchAt = researchUpdated.get(p.id);
    let stale: string | null = null;
    if (researchAt && new Date(researchAt).getTime() > draftAt + 60_000) {
      stale = "research updated since this draft was written";
    } else if (draftAt < staleBefore) {
      stale = `draft is over ${STALE_AGE_DAYS} days old`;
    }
    out.push({
      messageId: d.id,
      prospectId: p.id,
      company: p.company,
      contactName: p.contact_name,
      email: p.email,
      subject: d.subject || `question about ${p.company}`,
      body,
      leadScore: p.lead_score ?? 0,
      industry: p.industry,
      queued: d.status === "queued",
      broken: draftLooksBroken(body),
      stale,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Sends ONE draft/queued email message with full CRM bookkeeping. */
export async function sendAutopilotEmail(params: {
  messageId: string;
  senderName: string;
  senderId: string;
}): Promise<{ ok: true; company: string } | { ok: false; company: string; error: string }> {
  const admin = createAdminClient();
  const { data: message } = await admin
    .from("ge_messages")
    .select("id, prospect_id, channel, subject, body, status, direction, purpose")
    .eq("id", params.messageId)
    .maybeSingle();
  if (!message || message.direction !== "outbound" || message.channel !== "email") {
    return { ok: false, company: "unknown", error: "Not a sendable email draft." };
  }
  if (!["draft", "queued", "failed"].includes(message.status)) {
    return { ok: false, company: "unknown", error: "Already sent." };
  }

  const { data: prospect } = await admin
    .from("ge_prospects")
    .select("id, company, email, status")
    .eq("id", message.prospect_id)
    .maybeSingle();
  if (!prospect?.email) {
    return { ok: false, company: prospect?.company ?? "unknown", error: "No email address on file." };
  }

  // Hard gate: the full editorial review runs on every unattended send —
  // identity, length, subject quality, links. A held draft stays a draft
  // (never sent, never marked failed); regenerating in the Studio produces
  // a clean one under current rules.
  const held = reviewOutreachEmail({
    subject: message.subject || `question about ${prospect.company}`,
    body: sanitizeOutreachBody(message.body),
  });
  if (held) {
    return {
      ok: false,
      company: prospect.company,
      error: `held, not sent (${held}) — fix or regenerate in the Studio`,
    };
  }

  const sent = await sendOutreachEmail({
    to: prospect.email,
    subject: message.subject || `question about ${prospect.company}`,
    body: message.body,
  });
  if (!sent.ok) {
    await admin.from("ge_messages").update({ status: "failed" }).eq("id", message.id);
    return { ok: false, company: prospect.company, error: sent.error };
  }

  await recordOutreachSent(
    prospect,
    message.id,
    "email",
    params.senderName,
    params.senderId,
    message.purpose
  );
  return { ok: true, company: prospect.company };
}

/**
 * The cron half: fire every queued outbound email whose schedule (if any)
 * has arrived. Attributed to the first active owner so activity history
 * shows who the sender identity is. Paced to stay inside Resend's rate
 * limit. Returns counts for the dispatcher's log.
 */
export async function runQueuedEmailAutopilot(): Promise<{
  sent: number;
  failed: number;
  detail: string;
}> {
  const admin = createAdminClient();
  const { data: owner } = await admin
    .from("ge_team_members")
    .select("id, name")
    .eq("role", "owner")
    .eq("status", "active")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!owner) return { sent: 0, failed: 0, detail: "no active owner" };

  const { data: queued } = await admin
    .from("ge_messages")
    .select("id, prospect_id, body, scheduled_at, ge_prospects(company, lead_score)")
    .eq("channel", "email")
    .eq("direction", "outbound")
    .eq("status", "queued")
    .order("created_at")
    .limit(50);
  const now = new Date().toISOString();
  // Cap the morning batch: keeps the whole dispatch (reminders + sends +
  // brief) safely inside the 60s function budget and inside sensible daily
  // volume for a young domain — anything beyond the cap simply goes
  // tomorrow. Best lead scores send first.
  const due = (queued ?? [])
    .filter((m) => !m.scheduled_at || m.scheduled_at <= now)
    .sort(
      (a, b) =>
        Number((b.ge_prospects as { lead_score?: number } | null)?.lead_score ?? 0) -
        Number((a.ge_prospects as { lead_score?: number } | null)?.lead_score ?? 0)
    )
    .slice(0, 30);

  // Cross-contamination check: an email whose body names ANOTHER company in
  // this batch but not its own prospect is a mis-merged draft — held.
  const companyOf = (m: (typeof due)[number]) =>
    (m.ge_prospects as { company?: string } | null)?.company ?? "";
  const batchCompanies = due
    .map(companyOf)
    .filter((c) => c.length >= 4);

  let sent = 0;
  const failures: string[] = [];
  for (const m of due) {
    const own = companyOf(m);
    const body = (m.body ?? "").toLowerCase();
    const foreign = batchCompanies.find(
      (c) => c !== own && body.includes(c.toLowerCase())
    );
    let result: { ok: boolean; company: string; error?: string };
    if (foreign && own && !body.includes(own.toLowerCase())) {
      result = {
        ok: false,
        company: own,
        error: `held, not sent (mentions "${foreign}" instead of ${own})`,
      };
    } else {
      const res = await sendAutopilotEmail({
        messageId: m.id,
        senderName: `${owner.name} (Jarvis autopilot)`,
        senderId: owner.id,
      });
      result = res.ok ? { ok: true, company: res.company } : { ok: false, company: res.company, error: res.error };
    }
    if (result.ok) {
      sent += 1;
    } else {
      failures.push(`${result.company}: ${result.error}`);
      // Surface every held email in the morning brief's routine section.
      await admin.from("ge_activities").insert({
        prospect_id: m.prospect_id,
        type: "system",
        content: `Jarvis nightly: ${result.error}`,
        created_by: null,
      });
    }
    // Pacing: stays under the email provider's 2 req/s while keeping a
    // 30-email batch + the brief inside the function budget.
    await new Promise((r) => setTimeout(r, 350));
  }
  return {
    sent,
    failed: failures.length,
    detail: failures.length ? failures.join("; ").slice(0, 500) : `${sent} sent`,
  };
}
