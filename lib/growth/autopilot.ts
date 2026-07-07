import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOutreachEmail } from "@/lib/growth/email";
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
};

const READY_STATUSES = ["research_complete", "outreach_ready"];

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

  const { data: drafts } = await admin
    .from("ge_messages")
    .select("id, prospect_id, subject, body, status, created_at")
    .in("prospect_id", ids)
    .eq("channel", "email")
    .eq("direction", "outbound")
    .in("status", ["draft", "queued"])
    .order("created_at", { ascending: false });

  // Newest email draft per prospect wins (research refreshes in place, but
  // a studio draft may be newer and better-tuned).
  const draftByProspect = new Map<string, NonNullable<typeof drafts>[number]>();
  for (const d of drafts ?? []) {
    if (!draftByProspect.has(d.prospect_id)) draftByProspect.set(d.prospect_id, d);
  }

  const out: AutopilotCandidate[] = [];
  for (const p of prospects ?? []) {
    const d = draftByProspect.get(p.id);
    if (!d || !p.email) continue;
    out.push({
      messageId: d.id,
      prospectId: p.id,
      company: p.company,
      contactName: p.contact_name,
      email: p.email,
      subject: d.subject || `question about ${p.company}`,
      body: d.body,
      leadScore: p.lead_score ?? 0,
      industry: p.industry,
      queued: d.status === "queued",
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
    .select("id, scheduled_at")
    .eq("channel", "email")
    .eq("direction", "outbound")
    .eq("status", "queued")
    .order("created_at")
    .limit(50);
  const now = new Date().toISOString();
  const due = (queued ?? []).filter((m) => !m.scheduled_at || m.scheduled_at <= now);

  let sent = 0;
  const failures: string[] = [];
  for (const m of due) {
    const res = await sendAutopilotEmail({
      messageId: m.id,
      senderName: `${owner.name} (Jarvis autopilot)`,
      senderId: owner.id,
    });
    if (res.ok) sent += 1;
    else failures.push(`${res.company}: ${res.error}`);
    await new Promise((r) => setTimeout(r, 600));
  }
  return {
    sent,
    failed: failures.length,
    detail: failures.length ? failures.join("; ").slice(0, 500) : `${sent} sent`,
  };
}
