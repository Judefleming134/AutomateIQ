import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  sendOutreachEmail,
  sanitizeOutreachBody,
  draftLooksBroken,
  reviewOutreachEmail,
} from "@/lib/growth/email";
import { recordOutreachSent } from "@/lib/growth/outreach";
import { dublinDate } from "@/lib/growth/dates";

/**
 * Email autopilot: the one channel with a real sending API, made hands-off.
 * Candidates are researched prospects with an email address and a ready
 * first-touch email draft. From the Jarvis panel they can be fired
 * immediately or queued; queued emails are sent automatically by the daily
 * cron. Every autopilot send books identical CRM side-effects to a manual
 * send (recordOutreachSent), so tracking stays complete.
 */

/**
 * The send-time reply-race gate, shared with the inbox's manual Send button:
 * a message with one of these purposes is a COLD touch/chase, and it only
 * makes sense while the prospect is still in a PRE-reply status. Once they've
 * replied (or booked, won, opted out…), a queued cold touch is stale and must
 * be held, not sent — deliberate sends (replies, confirmations) pass through.
 */
export const COLD_PURPOSES: (string | null)[] = [
  null, "first", "follow_up", "second_follow_up",
];
export const PRE_REPLY_STATUSES = [
  "new", "researching", "research_failed", "research_complete",
  "outreach_ready", "contacted", "follow_up_sent",
];

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
  /** WHICH kind of staleness, so callers can treat them differently:
   *  "research" = the research changed under it (genuinely out of date);
   *  "age" = just old, but a cold first-touch intro doesn't rot, so it's
   *  still fine to auto-send. Null when fresh. */
  staleKind: "research" | "age" | null;
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
  // Not every ready prospect has an email draft yet, so scan well beyond
  // `limit` top-scored prospects to reliably fill up to `limit` DRAFTED
  // first-touches — a tight window (e.g. limit*2) under-fills whenever the
  // drafted prospects are spread deeper down the score-ranked list.
  const { data: prospects } = await admin
    .from("ge_prospects")
    .select("id, company, contact_name, email, industry, lead_score")
    .in("status", READY_STATUSES)
    .not("email", "is", null)
    .order("lead_score", { ascending: false, nullsFirst: false })
    .limit(Math.max(limit * 8, 200));
  const ids = (prospects ?? []).map((p) => p.id);
  if (ids.length === 0) return [];

  const [{ data: drafts }, { data: research }] = await Promise.all([
    admin
      .from("ge_messages")
      .select("id, prospect_id, subject, body, status, created_at, updated_at")
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

  // A prospect with an already-QUEUED email is handled — it goes out on the
  // 8am run and then moves to Contacted. It must NOT keep showing in the
  // "ready to send" list (that double-counts it and blocks the slot), so we
  // drop those prospects and let the list refill with the next uncontacted
  // drafts. The queued total is surfaced separately by the queued banner.
  const queuedProspectIds = new Set(
    (drafts ?? []).filter((d) => d.status === "queued").map((d) => d.prospect_id)
  );

  // Newest PLAIN draft per prospect wins (research refreshes in place, but a
  // studio draft may be newer and better-tuned). Queued rows are excluded —
  // they're no longer actionable here.
  const draftByProspect = new Map<string, NonNullable<typeof drafts>[number]>();
  for (const d of drafts ?? []) {
    if (d.status !== "draft") continue;
    if (!draftByProspect.has(d.prospect_id)) draftByProspect.set(d.prospect_id, d);
  }

  const staleBefore = Date.now() - STALE_AGE_DAYS * 24 * 3600 * 1000;

  const out: AutopilotCandidate[] = [];
  for (const p of prospects ?? []) {
    if (queuedProspectIds.has(p.id)) continue;
    const d = draftByProspect.get(p.id);
    if (!d || !p.email) continue;
    const body = sanitizeOutreachBody(d.body);
    // A draft's freshness is when its CONTENT was last written: research
    // refreshes and regenerates update rows in place (bumping updated_at),
    // so judging by created_at alone would flag a just-rewritten draft as
    // "stale" against the very research run that rewrote it.
    const draftAt = Math.max(
      new Date(d.created_at).getTime(),
      d.updated_at ? new Date(d.updated_at).getTime() : 0
    );
    const researchAt = researchUpdated.get(p.id);
    let stale: string | null = null;
    let staleKind: "research" | "age" | null = null;
    if (researchAt && new Date(researchAt).getTime() > draftAt + 60_000) {
      stale = "research updated since this draft was written";
      staleKind = "research";
    } else if (draftAt < staleBefore) {
      stale = `draft is over ${STALE_AGE_DAYS} days old`;
      staleKind = "age";
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
      staleKind,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Auto-queue: tops the 8am send queue up to a target with the BEST clean
 * drafts (top lead score, not broken, not stale, not already queued) so
 * "queue ~20 before bed" stops being a nightly chore. Runs from the 07:00
 * dispatch just before the send; anything Jude queued by hand counts toward
 * the target, so manual choices always take the slots first. Every email
 * still passes the hard pre-send review gate at send time.
 *
 * Tunable without a deploy: GROWTH_AUTOQUEUE_TARGET (default 20, "0"
 * disables the whole behaviour).
 */
export async function autoQueueTopDrafts(): Promise<{
  queued: number;
  detail: string;
}> {
  const raw = process.env.GROWTH_AUTOQUEUE_TARGET;
  const target = raw === undefined ? 20 : Number(raw);
  if (!Number.isFinite(target) || target <= 0) {
    return { queued: 0, detail: "auto-queue disabled" };
  }

  const admin = createAdminClient();
  const { count: already } = await admin
    .from("ge_messages")
    .select("id", { count: "exact", head: true })
    .eq("channel", "email")
    .eq("direction", "outbound")
    .eq("status", "queued");
  const need = target - (already ?? 0);
  if (need <= 0) {
    return { queued: 0, detail: `queue already at ${already} (target ${target})` };
  }

  // Over-fetch: some candidates come back flagged and are skipped. Auto-queue
  // top-scored drafts that are clean and not-out-of-date. Broken drafts and
  // research-STALE drafts (the research changed under them) are skipped — but
  // an AGE-stale draft (an old but still-valid cold first-touch) is fine to
  // send, and excluding it was starving the 8am run whenever a batch of
  // drafts aged past the 5-day mark. Every queued email still passes the full
  // reviewOutreachEmail gate at send time.
  const candidates = await listAutopilotCandidates(Math.min(need * 2, 50));
  const clean = candidates
    .filter((c) => !c.queued && !c.broken && c.staleKind !== "research")
    .slice(0, need);

  let queued = 0;
  for (const c of clean) {
    const { error } = await admin
      .from("ge_messages")
      .update({ status: "queued" })
      .eq("id", c.messageId)
      .eq("status", "draft");
    if (error) continue;
    queued += 1;
    await admin.from("ge_activities").insert({
      prospect_id: c.prospectId,
      type: "system",
      content: `Jarvis nightly: auto-queued the first-touch email for the morning run (score ${c.leadScore})`,
      created_by: null,
    });
  }
  return {
    queued,
    detail: `topped the queue up from ${already ?? 0} to ${(already ?? 0) + queued} (target ${target})`,
  };
}

/**
 * Closes the follow-up loop. The overnight worker DRAFTS a follow-up email
 * for every prospect whose chase date has arrived; this queues those clean
 * drafts for the 8am send, so the whole chase cycle runs itself:
 *   contacted → (3 days) chase due → drafted overnight → queued → sent →
 *   follow_up_sent, next chase in 3 days … up to a hard touch cap.
 *
 * Safety: only prospects still in a chase-eligible status get here (a reply
 * moves them to `replied`, a bounce nulled the email); a hard cap of
 * GROWTH_MAX_FOLLOWUPS *sent* follow-ups (default 2) stops it ever
 * harassing anyone; the pre-send review gate is re-run here AND at send
 * time; GROWTH_AUTOFOLLOWUP="0"/"off" disables the whole thing.
 */
export async function autoQueueDueFollowups(): Promise<{
  queued: number;
  detail: string;
}> {
  const flag = (process.env.GROWTH_AUTOFOLLOWUP ?? "").toLowerCase();
  if (flag === "0" || flag === "off") {
    return { queued: 0, detail: "auto follow-up disabled" };
  }
  const maxTouches = Math.max(1, Number(process.env.GROWTH_MAX_FOLLOWUPS ?? 2));
  const PER_RUN_CAP = 15;

  const admin = createAdminClient();
  const today = dublinDate();

  const { data: due } = await admin
    .from("ge_prospects")
    .select("id, company, email, lead_score")
    .in("status", ["contacted", "follow_up_sent"])
    .lte("next_follow_up_at", today)
    // 7-day freshness window: a chase more than a week overdue has gone cold —
    // auto-sending it now reads as spam, not persistence. Those leads park in
    // the dashboard's "Gone cold" section for a deliberate revive instead.
    .gte("next_follow_up_at", dublinDate(-7))
    .not("email", "is", null)
    .order("lead_score", { ascending: false, nullsFirst: false })
    .limit(80);

  let queued = 0;
  const names: string[] = [];
  for (const p of due ?? []) {
    if (queued >= PER_RUN_CAP) break;

    // Hard chase cap: stop once we've SENT this many follow-ups. Both chase
    // touches (follow_up = touch 2, second_follow_up = touch 3) count toward
    // it, so the 3-touch sequence can't run past GROWTH_MAX_FOLLOWUPS.
    const CHASE_PURPOSES = ["follow_up", "second_follow_up"];
    const { count: sentFollowups } = await admin
      .from("ge_messages")
      .select("id", { count: "exact", head: true })
      .eq("prospect_id", p.id)
      .eq("channel", "email")
      .eq("direction", "outbound")
      .in("purpose", CHASE_PURPOSES)
      .eq("status", "sent");
    if ((sentFollowups ?? 0) >= maxTouches) continue;

    // Already have one queued? leave it (don't double up).
    const { data: pending } = await admin
      .from("ge_messages")
      .select("id")
      .eq("prospect_id", p.id)
      .eq("channel", "email")
      .eq("direction", "outbound")
      .in("purpose", CHASE_PURPOSES)
      .eq("status", "queued")
      .limit(1)
      .maybeSingle();
    if (pending) continue;

    // The clean chase draft the worker wrote overnight (whichever touch is
    // next — the worker picks follow_up then second_follow_up in order).
    const { data: draft } = await admin
      .from("ge_messages")
      .select("id, subject, body")
      .eq("prospect_id", p.id)
      .eq("channel", "email")
      .eq("direction", "outbound")
      .in("purpose", CHASE_PURPOSES)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!draft) continue;

    const body = sanitizeOutreachBody(draft.body);
    if (draftLooksBroken(body)) continue;
    if (reviewOutreachEmail({ subject: draft.subject || "", body })) continue;

    const { error } = await admin
      .from("ge_messages")
      .update({ status: "queued" })
      .eq("id", draft.id)
      .eq("status", "draft");
    if (error) continue;
    queued += 1;
    names.push(p.company);
    await admin.from("ge_activities").insert({
      prospect_id: p.id,
      type: "system",
      content: `Jarvis nightly: auto-queued the follow-up email for the morning run (chase was due ${today})`,
      created_by: null,
    });
  }

  return {
    queued,
    detail: queued
      ? `queued ${queued} follow-ups: ${names.slice(0, 8).join(", ")}${names.length > 8 ? "…" : ""}`
      : "no due follow-ups ready",
  };
}

/**
 * On-demand twin of the follow-up autopilot: sends every DUE email follow-up
 * that already has a clean drafted reply, right now (the dashboard button),
 * through the exact same gates as the 8am run — per-send editorial review,
 * a LIVE status re-check (a lead who just replied is held, not chased), the
 * hard touch cap, and the 7-day freshness window (gone-cold leads stay parked).
 * Leads whose overnight draft isn't written yet are counted and left for the
 * 8am run rather than drafted on the spot. Bounded per click.
 */
export async function sendDueEmailFollowupsNow(
  senderName: string,
  senderId: string
): Promise<{ sent: number; held: number; noDraft: number; due: number }> {
  const flag = (process.env.GROWTH_AUTOFOLLOWUP ?? "").toLowerCase();
  if (flag === "0" || flag === "off") {
    return { sent: 0, held: 0, noDraft: 0, due: 0 };
  }
  const admin = createAdminClient();
  const today = dublinDate();
  const maxTouches = Math.max(1, Number(process.env.GROWTH_MAX_FOLLOWUPS ?? 2));

  const { data: due } = await admin
    .from("ge_prospects")
    .select("id, lead_score")
    .in("status", ["contacted", "follow_up_sent"])
    .lte("next_follow_up_at", today)
    // Same 7-day window as the 8am run: older chases are "gone cold" and stay
    // parked, never auto-fired — sending them now would read as spam.
    .gte("next_follow_up_at", dublinDate(-7))
    .not("email", "is", null)
    .order("lead_score", { ascending: false, nullsFirst: false })
    .limit(40);

  let sent = 0;
  let held = 0;
  let noDraft = 0;
  const dueList = due ?? [];
  // Same chase purposes as the 8am run (autoQueueDueFollowups): both touches
  // count toward the cap, and a drafted second_follow_up is sendable here.
  // Matching only "follow_up" made this button under-count sent chases AND
  // silently skip every drafted third-touch as "no draft".
  const CHASE_PURPOSES = ["follow_up", "second_follow_up"];
  for (const p of dueList) {
    if (sent >= 20) break; // bound the per-click send burst

    const { count: sentFollowups } = await admin
      .from("ge_messages")
      .select("id", { count: "exact", head: true })
      .eq("prospect_id", p.id)
      .eq("channel", "email")
      .eq("direction", "outbound")
      .in("purpose", CHASE_PURPOSES)
      .eq("status", "sent");
    if ((sentFollowups ?? 0) >= maxTouches) continue;

    const { data: draft } = await admin
      .from("ge_messages")
      .select("id")
      .eq("prospect_id", p.id)
      .eq("channel", "email")
      .eq("direction", "outbound")
      .in("purpose", CHASE_PURPOSES)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!draft) {
      noDraft += 1;
      continue;
    }

    const res = await sendAutopilotEmail({
      messageId: draft.id,
      senderName,
      senderId,
    });
    if (res.ok) sent += 1;
    else held += 1;
  }
  return { sent, held, noDraft, due: dueList.length };
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

  // A cold touch or chase must never fire at someone who has moved past it:
  // a reply can land AFTER the 07:00 queueing but BEFORE the 8am send, and
  // sending the queued chase then reads as ignoring what they just wrote.
  // Re-check the LIVE status at send time; only cold purposes are held —
  // deliberate sends (replies, meeting confirmations) pass through.
  if (
    COLD_PURPOSES.includes(message.purpose as string | null) &&
    !PRE_REPLY_STATUSES.includes(prospect.status)
  ) {
    // Back to draft so tomorrow's run doesn't retry it forever.
    await admin.from("ge_messages").update({ status: "draft" }).eq("id", message.id);
    return {
      ok: false,
      company: prospect.company,
      error: `held, not sent (they're now '${prospect.status}' — the queued cold touch was cancelled)`,
    };
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
