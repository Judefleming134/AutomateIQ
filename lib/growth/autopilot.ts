import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllRows, selectAllRowsByIds } from "@/lib/growth/db";
import {
  sendOutreachEmail,
  sanitizeOutreachBody,
  draftLooksBroken,
  reviewOutreachEmail,
} from "@/lib/growth/email";
import { recordOutreachSent } from "@/lib/growth/outreach";
import { dublinDate } from "@/lib/growth/dates";
import { loadGrowthSettings } from "@/lib/growth/auth";
import { DELIVERY_COMPLAINT_PATTERN } from "@/lib/growth/constants";

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

/**
 * Whether a candidate can be auto-queued for the 07:00 send.
 *
 * Broken drafts (leftover placeholder, invented sender name) and drafts whose
 * RESEARCH changed underneath them are skipped. An AGE-stale draft is fine: a
 * cold first-touch intro doesn't rot, and excluding it starved the run
 * whenever a batch of drafts crossed the 5-day mark together.
 *
 * Pure and exported so the widening below can be tested without a database —
 * and so the rule lives in one place rather than inline in the caller.
 */
export function isAutoQueueable(
  c: Pick<AutopilotCandidate, "queued" | "broken" | "staleKind">
): boolean {
  return !c.queued && !c.broken && c.staleKind !== "research";
}

/**
 * How far down the score-ranked list to look, in widening steps.
 *
 * WHY THIS EXISTS. `listAutopilotCandidates(limit)` caps at `limit` candidates
 * BEFORE anything knows which of them are sendable — the broken/stale flags are
 * computed, but the truncation is on the raw score order. The caller then
 * filtered that fixed slice. So a night where many top-scored drafts came back
 * flagged produced a short queue while perfectly clean drafts sat just below
 * the cut, unreachable. That is the exact "score-ordered cap applied before the
 * still-to-work filter" shape this codebase has now hit four times.
 *
 * It is not hypothetical here: a research refresh marks every draft written
 * before it as research-stale, and Jarvis refreshes research nightly — so the
 * flags arrive in BATCHES, precisely when the queue needs filling.
 *
 * The first window is the old behaviour, so an ordinary night does exactly one
 * fetch and costs nothing new. The wider ones are only paid for on a night that
 * is actually starved, which is the night worth paying for.
 */
export function autoQueueWindows(need: number): number[] {
  return [Math.min(need * 2, 50), Math.min(need * 6, 150), 300];
}

/**
 * Collects up to `need` auto-queueable drafts, widening the search until it
 * has enough or widening stops finding anything new.
 *
 * `fetchCandidates` is injected so this is testable against a fake pool; the
 * caller passes `listAutopilotCandidates`.
 */
export async function collectQueueableDrafts(
  need: number,
  fetchCandidates: (limit: number) => Promise<AutopilotCandidate[]>
): Promise<{ clean: AutopilotCandidate[]; scanned: number; passes: number }> {
  let clean: AutopilotCandidate[] = [];
  let scanned = 0;
  let passes = 0;
  let previousScanned = -1;
  for (const window of autoQueueWindows(need)) {
    // A later window can be no wider than one already tried (need*2 and need*6
    // both clamp to their ceilings on a big target) — re-fetching it would be
    // pure latency for an identical answer.
    if (window <= previousScanned) continue;
    const candidates = await fetchCandidates(window);
    passes += 1;
    scanned = candidates.length;
    clean = candidates.filter(isAutoQueueable);
    if (clean.length >= need) break;
    // Nothing at all came back: there are no drafted, uncontacted prospects to
    // find, and a wider window can only return the same empty list.
    if (scanned === 0) break;
    // Widening returned no additional candidates, so the pool really is
    // exhausted and looking further is wasted work rather than a missed draft.
    if (scanned === previousScanned) break;
    previousScanned = scanned;
  }
  return { clean: clean.slice(0, need), scanned, passes };
}

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

  // CHUNKED + PAGED, both of which this needed and had neither.
  //
  // `ids` is up to max(limit * 8, 200) prospects — 400 on the auto-queue path.
  // Every id is serialised into the request URL at roughly 40 characters per
  // UUID, so 400 of them built a ~16KB URL: over the usual server limit, and
  // the request simply fails. `data` comes back null, no candidates are found,
  // and the 07:00 auto-queue quietly tops up nothing at all. A silent morning
  // with no send is far worse than a loud error.
  //
  // The same call was also capped at PostgREST's ~1,000 rows: 400 prospects
  // with ~5 drafts each is 2,000 messages, so prospects past the cap lost their
  // drafts and could never be auto-queued no matter how well they scored.
  //
  // Chunk order doesn't matter here — the winning draft is chosen by content
  // time below, not by the order rows arrive in.
  type DraftRow = {
    id: string;
    prospect_id: string;
    subject: string | null;
    body: string;
    status: string;
    created_at: string;
    updated_at: string | null;
  };
  const [drafts, research] = await Promise.all([
    selectAllRowsByIds<DraftRow>(ids, (chunk) =>
      admin
        .from("ge_messages")
        .select("id, prospect_id, subject, body, status, created_at, updated_at")
        .in("prospect_id", chunk)
        .eq("channel", "email")
        .eq("direction", "outbound")
        .in("status", ["draft", "queued"])
        .order("created_at", { ascending: false })
    ),
    selectAllRowsByIds<{ prospect_id: string; updated_at: string | null }>(
      ids,
      (chunk) =>
        admin.from("ge_research").select("prospect_id, updated_at").in("prospect_id", chunk)
    ),
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

  // When a draft's CONTENT was last written. Regenerating in the Studio and a
  // research refresh both rewrite the row in place — bumping updated_at while
  // created_at stays put — so created_at alone is not when the text was
  // written. Used for BOTH picking the winning draft and judging staleness, so
  // the two can't disagree.
  const contentAt = (d: { created_at: string; updated_at?: string | null }) =>
    Math.max(
      new Date(d.created_at).getTime(),
      d.updated_at ? new Date(d.updated_at).getTime() : 0
    );

  // Newest PLAIN draft per prospect wins, by CONTENT time. This used to take
  // the first row of a created_at-ordered list, which silently disagreed with
  // the freshness rule right below it: a draft created 10 days ago but
  // regenerated by Jude this morning lost to an untouched one created 2 days
  // ago — so the older text was the one auto-queued and sent at 07:00, and his
  // rewrite never went out. Queued rows are excluded (no longer actionable).
  const draftByProspect = new Map<string, DraftRow>();
  for (const d of drafts ?? []) {
    if (d.status !== "draft") continue;
    const current = draftByProspect.get(d.prospect_id);
    if (!current || contentAt(d) > contentAt(current)) {
      draftByProspect.set(d.prospect_id, d);
    }
  }

  const staleBefore = Date.now() - STALE_AGE_DAYS * 24 * 3600 * 1000;

  const out: AutopilotCandidate[] = [];
  for (const p of prospects ?? []) {
    if (queuedProspectIds.has(p.id)) continue;
    const d = draftByProspect.get(p.id);
    if (!d || !p.email) continue;
    const body = sanitizeOutreachBody(d.body);
    // Same content clock the winner was chosen with, so a draft can never be
    // selected as "newest" and then judged stale on a different measure.
    const draftAt = contentAt(d);
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

/** Never ramp below this — it's the long-standing default, so turning the
 *  ramp on can never make the engine send LESS than it already did. */
const RAMP_FLOOR = 20;
/** How much bigger than the recent daily peak one day is allowed to be.
 *  +50% a day is the conventional warm-up step; it reaches 200/day from 20
 *  in about six days, which is far faster than anyone ramps by hand. */
const RAMP_STEP = 1.5;
/** Doubling, once the list has PROVED itself: 40+ sends at under 1% bounces. */
const RAMP_STEP_CLEAN = 2.0;
/** Deliverability limits. Above either of these, growth stops dead. Mailbox
 *  providers act on exactly these ratios, and a domain that gets filtered is
 *  far more expensive to fix than a few slow days. */
const MAX_BOUNCE_RATE = 0.05;
const RAMP_WINDOW_DAYS = 14;

/**
 * The hard ceiling on ONE morning run — and, since there is one run a day, on
 * a day.
 *
 * This exists because the 07:00 dispatch has a 60-second budget it shares with
 * the booking sync, both queue steps, the invoice-chaser settle and the brief's
 * AI call. Thirty paced sends is what fits with the brief still going out, and
 * the brief is the thing CLAUDE.md says can never be left broken.
 *
 * IT WAS A BARE `30` INSIDE runQueuedEmailAutopilot AND NOTHING ELSE KNEW.
 * resolveSendRamp derives its ceiling from `recentPeak`, which is measured from
 * sends — so the cap fed back into the ramp and the whole thing converged on 30
 * while the reason line, the morning brief and the settings help text all
 * described a climb to whatever number was in the box.
 *
 * On the DEFAULT target of 50 that reads, from the third morning onward:
 *
 *     "at your target of 50/day (peak 30)"
 *
 * every morning, for ever, while thirty emails go out. Not "ramping" — it
 * claims to have ARRIVED. Twenty emails a day, six hundred a month, that the
 * engine says it sent and did not.
 *
 * Exported so the queue side and the send side read the same number. Raising it
 * is a real piece of work (the 350ms pacing alone is 10.5s of the budget) and
 * is logged in docs/OUTSTANDING.md rather than done here.
 */
export const MAX_SENDS_PER_RUN = 30;

export type RampDecision = {
  /** What the engine will actually queue today. */
  target: number;
  /** What was asked for via GROWTH_AUTOQUEUE_TARGET. */
  requested: number;
  recentPeak: number;
  sent: number;
  bounced: number;
  complaints: number;
  bounceRate: number;
  /** Plain-English why, for the brief and the queue detail line. */
  reason: string;
  /** True when the requested target is above what one morning run can send,
   *  so `target` is MAX_SENDS_PER_RUN rather than the number in the box.
   *  Additive — existing callers read target/reason and are unaffected. */
  cappedByRun: boolean;
};

/**
 * The last word on every ramp decision: nothing may be queued above what the
 * morning run can actually send, and if that bites, the reason has to say so.
 *
 * Applied on ALL paths — including the two hold paths, where `recentPeak` can
 * legitimately sit above 30 because it counts Jude's manual sends from the
 * inbox as well as the autopilot's.
 *
 * Throughput is unchanged by the clamp: the send loop was already stopping at
 * 30. What changes is that the surplus stops being queued — and a queued cold
 * draft is not free. `listAutopilotCandidates` drops any prospect with a queued
 * email from the "ready to send" list, so twenty prospects were parked in a
 * limbo where they neither went out nor showed up as available, and their
 * drafts aged past the 5-day staleness line while they waited.
 */
function capToRun(d: Omit<RampDecision, "cappedByRun">): RampDecision {
  if (d.target <= MAX_SENDS_PER_RUN) return { ...d, cappedByRun: false };
  return {
    ...d,
    target: MAX_SENDS_PER_RUN,
    cappedByRun: true,
    reason:
      `${d.reason} — capped at ${MAX_SENDS_PER_RUN}/day, because one morning run ` +
      `sends at most ${MAX_SENDS_PER_RUN} emails inside its time budget (which also ` +
      `has to fit your brief). Your target of ${d.requested} can't be reached by ` +
      `raising that number alone.`,
  };
}

/**
 * Decides how many first-touch emails it is SAFE to queue today.
 *
 * Owning a domain for a while is not the same as having a warmed sending
 * reputation — mailbox providers judge the ramp and the engagement, not the
 * calendar. Jumping from 20 a day to 200 is the single fastest way to get a
 * domain filtered, and once outreach lands in spam the channel that earns the
 * money is gone until it's rebuilt.
 *
 * So GROWTH_AUTOQUEUE_TARGET becomes a DESTINATION rather than a daily number:
 * set it to 200 and the engine walks itself up ~50% a day from whatever it has
 * actually been sending, stopping instantly if bounces or complaints appear.
 * It can only ever hold volume DOWN — never below RAMP_FLOOR, so this can't
 * make the engine quieter than it already was.
 */
export async function resolveSendRamp(
  admin: SupabaseClient,
  requested: number
): Promise<RampDecision> {
  const since = new Date(Date.now() - RAMP_WINDOW_DAYS * 86_400_000).toISOString();
  // Outbound email that actually left (or bounced) in the window. One tiny
  // row each; paged because a busy fortnight can exceed PostgREST's 1,000.
  const rows = await selectAllRows<{ status: string; sent_at: string | null; created_at: string }>(
    () =>
      admin
        .from("ge_messages")
        .select("status, sent_at, created_at")
        .eq("channel", "email")
        .eq("direction", "outbound")
        .in("status", ["sent", "failed"])
        .gte("created_at", since)
  ).catch(() => [] as { status: string; sent_at: string | null; created_at: string }[]);

  const byDay = new Map<string, number>();
  let sent = 0;
  let bounced = 0;
  for (const r of rows) {
    if (r.status === "failed") bounced++;
    else sent++;
    const day = (r.sent_at ?? r.created_at).slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  const recentPeak = byDay.size ? Math.max(...byDay.values()) : 0;
  const total = sent + bounced;
  const bounceRate = total > 0 ? bounced / total : 0;

  // Spam complaints are logged by the Resend webhook as delivery activities.
  // Any complaint at all is a stop signal — the acceptable rate is ~0.1%, far
  // below what a small sender can measure, so treat one as one too many.
  //
  // THIS PATTERN USED TO MATCH NOTHING. It was the hand-written literal
  // "Email delivery:%COMPLAINED%", while the webhook writes "SPAM COMPLAINT".
  // "SPAM COMPLAINT" does not contain "COMPLAINED", so the count was always 0
  // and the hold below was unreachable — the ramp climbed through every spam
  // complaint the domain ever got. Now built from the same constants the
  // webhook composes its message from, so the two cannot drift again.
  const { count: complaintCount } = await admin
    .from("ge_activities")
    .select("id", { count: "exact", head: true })
    .ilike("content", DELIVERY_COMPLAINT_PATTERN)
    .gte("created_at", since);
  const complaints = complaintCount ?? 0;

  if (complaints > 0) {
    // Order matters: clamp to the requested number LAST, so a hold can never
    // send MORE than was asked for. Max-first would raise a deliberately low
    // target up to the floor at the exact moment volume should be falling.
    const target = Math.min(requested, Math.max(RAMP_FLOOR, recentPeak));
    return capToRun({
      target, requested, recentPeak, sent, bounced, complaints, bounceRate,
      reason: `HOLDING at ${Math.min(target, MAX_SENDS_PER_RUN)}/day — ${complaints} spam complaint${complaints === 1 ? "" : "s"} in the last ${RAMP_WINDOW_DAYS} days. Volume will not grow until that's clean. Check who's being emailed and how they got on the list.`,
    });
  }
  if (total >= 20 && bounceRate > MAX_BOUNCE_RATE) {
    // Order matters: clamp to the requested number LAST, so a hold can never
    // send MORE than was asked for. Max-first would raise a deliberately low
    // target up to the floor at the exact moment volume should be falling.
    const target = Math.min(requested, Math.max(RAMP_FLOOR, recentPeak));
    return capToRun({
      target, requested, recentPeak, sent, bounced, complaints, bounceRate,
      reason: `HOLDING at ${Math.min(target, MAX_SENDS_PER_RUN)}/day — ${(bounceRate * 100).toFixed(1)}% of the last ${total} emails bounced (limit ${(MAX_BOUNCE_RATE * 100).toFixed(0)}%). Clean the list before sending more; bounces damage the domain faster than volume builds it.`,
    });
  }

  // A list that is demonstrably clean earns a faster climb. Under 1% bounces
  // across a real sample is the evidence that the addresses are good and the
  // domain is being accepted — doubling from there is still well inside
  // conventional warm-up guidance, and it halves the time to full volume.
  const proven = total >= 40 && bounceRate < 0.01;
  const step = proven ? RAMP_STEP_CLEAN : RAMP_STEP;
  const ceiling = Math.max(RAMP_FLOOR, Math.ceil(recentPeak * step));
  const target = Math.min(requested, ceiling);
  // The climb is toward whichever comes first: the number in the box, or what a
  // morning run can carry. Estimating days to a destination the run can never
  // reach is how "Reaches your target in about 1 more days" got printed every
  // morning for ever.
  const destination = Math.min(requested, MAX_SENDS_PER_RUN);
  const effective = Math.min(target, MAX_SENDS_PER_RUN);
  // Days to whichever comes first, and by the step actually in use. The old
  // estimate divided by `requested` with RAMP_STEP regardless, so on a target
  // above the ceiling it printed "reaches your target in about 1 more days"
  // every morning for ever — a promise that could not come true.
  const days = Math.max(
    1,
    Math.ceil(Math.log(destination / Math.max(effective, 1)) / Math.log(step))
  );
  const stats = `peak ${recentPeak}, ${(bounceRate * 100).toFixed(1)}% bounces`;
  const reason =
    effective >= destination
      ? // Unchanged wording whenever the target is genuinely reached — the
        // line Jude already reads on a working morning.
        target >= requested
        ? `at your target of ${requested}/day (${stats})`
        : `at ${effective}/day (${stats})`
      : `ramping to ${effective}/day on the way to ${destination} — ${proven ? "doubling" : "up to +50%"} on the recent peak of ${recentPeak}/day, ${(bounceRate * 100).toFixed(1)}% bounces${proven ? " (clean list, so it's climbing faster)" : ""}. Reaches it in about ${days} more days.`;
  return capToRun({ target, requested, recentPeak, sent, bounced, complaints, bounceRate, reason });
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
 * disables the whole behaviour). It is a DESTINATION, not a daily number —
 * resolveSendRamp paces the climb so the domain isn't burned getting there.
 */
export async function autoQueueTopDrafts(): Promise<{
  queued: number;
  detail: string;
  /** Drafted prospects looked at. Additive — existing callers read queued/detail. */
  scanned?: number;
  /** How many widening passes it took. 1 on an ordinary night. */
  passes?: number;
  /** How far short of today's target the queue came up. 0 when it filled. */
  shortfall?: number;
}> {
  // WHERE THE DESTINATION COMES FROM.
  //
  // This defaulted to RAMP_FLOOR (20) when GROWTH_AUTOQUEUE_TARGET was unset,
  // which quietly made the ramp pointless: the target WAS the old daily
  // number, so `min(requested, ceiling)` could never exceed 20 and volume
  // never grew unless someone edited an environment variable in Vercel. The
  // one number that decides how much outreach goes out has to be changeable
  // from the engine itself.
  //
  // Settings first, env var as an explicit override for anyone who wants to
  // pin it without touching the UI.
  const settings = await loadGrowthSettings();
  const raw = process.env.GROWTH_AUTOQUEUE_TARGET;
  const requested = raw === undefined ? settings.dailySendTarget : Number(raw);
  if (!Number.isFinite(requested) || requested <= 0) {
    return { queued: 0, detail: "auto-queue disabled" };
  }

  const admin = createAdminClient();
  // Pace the climb toward the requested number rather than jumping to it.
  const ramp = await resolveSendRamp(admin, requested);
  const target = ramp.target;

  const { count: already } = await admin
    .from("ge_messages")
    .select("id", { count: "exact", head: true })
    .eq("channel", "email")
    .eq("direction", "outbound")
    .eq("status", "queued");
  const need = target - (already ?? 0);
  if (need <= 0) {
    return { queued: 0, detail: `queue already at ${already} — ${ramp.reason}` };
  }

  // Auto-queue top-scored drafts that are clean and not out of date. The
  // over-fetch used to be a single fixed window (need * 2), filtered
  // afterwards — so a night where many of the top-scored drafts came back
  // flagged queued short while clean drafts sat just below the cut. See
  // collectQueueableDrafts: it now widens until it has enough or the pool
  // genuinely runs out. Every queued email still passes the full
  // reviewOutreachEmail gate at send time.
  const { clean, scanned, passes } = await collectQueueableDrafts(
    need,
    listAutopilotCandidates
  );
  const shortfall = need - clean.length;

  let queued = 0;
  for (const c of clean) {
    const { error } = await admin
      .from("ge_messages")
      .update({ status: "queued" })
      .eq("id", c.messageId)
      .eq("status", "draft");
    if (error) continue;
    queued += 1;
    // The FIRST line of the run also carries the ramp decision, so the pacing
    // shows up in the nightly section of the morning brief rather than only in
    // the cron response. ge_activities.prospect_id is NOT NULL, so a standalone
    // note would need a migration — this rides along on a real prospect
    // instead, and it's true of that prospect's send either way.
    await admin.from("ge_activities").insert({
      prospect_id: c.prospectId,
      type: "system",
      content:
        `Jarvis nightly: auto-queued the first-touch email for the morning run (score ${c.leadScore})` +
        (queued === 1 ? ` — send volume ${ramp.reason}` : ""),
      created_by: null,
    });
  }
  // Say what actually happened. "topped the queue up from 12 to 12" reads as
  // work done, so a run that queued NOTHING was indistinguishable in the
  // morning brief from one that filled the queue — and a shortfall is the one
  // thing worth knowing about, because it means the day's send is smaller than
  // the target and nothing else says so.
  const from = already ?? 0;
  let detail: string;
  if (queued === 0) {
    detail =
      scanned === 0
        ? `nothing to queue — no researched prospect has a clean email draft waiting (queue still at ${from}) — ${ramp.reason}`
        : `nothing queued — scanned ${scanned} drafted prospect${scanned === 1 ? "" : "s"} and none were sendable (queue still at ${from}) — ${ramp.reason}`;
  } else {
    detail = `topped the queue up from ${from} to ${from + queued} — ${ramp.reason}`;
    if (shortfall > 0) {
      detail += ` (${shortfall} short of today's ${target}: only ${clean.length} sendable draft${clean.length === 1 ? "" : "s"} in ${scanned} scanned — regenerate the flagged ones or research more prospects)`;
    }
  }
  return { queued, detail, scanned, passes, shortfall: Math.max(0, shortfall) };
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
    // MOST OVERDUE FIRST, then best score. Ordering by score alone leaked
    // leads: only PER_RUN_CAP chases are queued a night, so with a real
    // backlog (Jude has had 90+ due at once) a low-scoring chase lost its slot
    // to whatever higher-scoring chase came due that day — every night, until
    // it crossed the 7-day line above and was parked as gone cold. It never
    // got a single send.
    //
    // A chase is time-boxed in a way a score isn't: the one due 6 days ago has
    // ONE night of runway left, while a chase due today has seven. Runway has
    // to win, or the queue quietly reorders itself into a leak. Same reasoning
    // as the send-order fix in runQueuedEmailAutopilot — this is the layer
    // above it, and it was still sorting the old way.
    .order("next_follow_up_at", { ascending: true })
    .order("lead_score", { ascending: false, nullsFirst: false })
    .limit(80);

  // Both chase touches (follow_up = touch 2, second_follow_up = touch 3) count
  // toward GROWTH_MAX_FOLLOWUPS, so the 3-touch sequence can't run past it.
  const CHASE_PURPOSES = ["follow_up", "second_follow_up"];

  // ONE round trip per question instead of one per prospect. This loop used to
  // issue three sequential queries for EVERY candidate — sent-count, queued
  // check, draft lookup — so an 80-candidate list meant ~240 serial round trips
  // inside the 07:00 dispatch, ahead of the sends AND the morning brief. That
  // is pure latency in the one function whose budget must not run out: the
  // brief runs last, so an overrun costs Jude his brief. Same three questions,
  // asked once for the whole batch and answered from memory below; the
  // per-prospect decisions and their order are unchanged.
  const dueIds = (due ?? []).map((p) => p.id);
  const [{ data: chaseSent }, { data: chaseQueued }, { data: chaseDrafts }] = dueIds.length
    ? await Promise.all([
        admin
          .from("ge_messages")
          .select("prospect_id")
          .in("prospect_id", dueIds)
          .eq("channel", "email")
          .eq("direction", "outbound")
          .in("purpose", CHASE_PURPOSES)
          .eq("status", "sent"),
        admin
          .from("ge_messages")
          .select("prospect_id")
          .in("prospect_id", dueIds)
          .eq("channel", "email")
          .eq("direction", "outbound")
          .in("purpose", CHASE_PURPOSES)
          .eq("status", "queued"),
        admin
          .from("ge_messages")
          .select("id, prospect_id, subject, body, created_at")
          .in("prospect_id", dueIds)
          .eq("channel", "email")
          .eq("direction", "outbound")
          .in("purpose", CHASE_PURPOSES)
          .eq("status", "draft")
          .order("created_at", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const sentCountByProspect = new Map<string, number>();
  for (const m of chaseSent ?? []) {
    sentCountByProspect.set(m.prospect_id, (sentCountByProspect.get(m.prospect_id) ?? 0) + 1);
  }
  const hasQueuedChase = new Set((chaseQueued ?? []).map((m) => m.prospect_id));
  // Rows arrive newest-first, so the first sighting per prospect is the latest
  // draft — exactly what the old `order(created_at desc).limit(1)` returned.
  const latestDraftByProspect = new Map<string, { id: string; subject: string | null; body: string }>();
  for (const m of chaseDrafts ?? []) {
    if (!latestDraftByProspect.has(m.prospect_id)) {
      latestDraftByProspect.set(m.prospect_id, { id: m.id, subject: m.subject, body: m.body });
    }
  }

  let queued = 0;
  const names: string[] = [];
  for (const p of due ?? []) {
    if (queued >= PER_RUN_CAP) break;

    // Hard chase cap: stop once we've SENT this many follow-ups.
    if ((sentCountByProspect.get(p.id) ?? 0) >= maxTouches) continue;

    // Already have one queued? leave it (don't double up).
    if (hasQueuedChase.has(p.id)) continue;

    // The clean chase draft the worker wrote overnight (whichever touch is
    // next — the worker picks follow_up then second_follow_up in order).
    const draft = latestDraftByProspect.get(p.id);
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
    // MOST OVERDUE FIRST, then best score — the same order autoQueueDueFollowups
    // uses, and for the same reason. This button is its on-demand twin and
    // never got the fix.
    //
    // Ordering by score alone leaks leads: only 20 are sent per click out of 40
    // fetched, so with a real backlog (Jude has had 90+ due at once) a
    // low-scoring chase loses its slot to whatever higher-scoring chase came
    // due that day — every click — until it crosses the 7-day line above and is
    // parked as gone cold, never having been chased once.
    //
    // A chase is time-boxed in a way a score is not: the one due 6 days ago has
    // ONE day of runway left, the one due today has seven. Runway has to win.
    //
    // Replayed over 90 due chases: by score, 10 of the 12 leads on their last
    // day went unsent and aged out the next morning. By overdue-ness, 0 did.
    .order("next_follow_up_at", { ascending: true })
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
  const cleanBody = sanitizeOutreachBody(message.body);
  const held = reviewOutreachEmail({
    subject: message.subject || `question about ${prospect.company}`,
    body: cleanBody,
  });
  if (held) {
    return {
      ok: false,
      company: prospect.company,
      error: `held, not sent (${held}) — fix or regenerate in the Studio`,
    };
  }

  // SEND THE TEXT THE GATE REVIEWED: the review ran on the sanitized body, so
  // sending the raw one could deliver the very placeholder the sanitizer
  // quietly fixed. Persist it too, so history shows what actually went out.
  if (cleanBody !== message.body) {
    await admin.from("ge_messages").update({ body: cleanBody }).eq("id", message.id);
  }

  const sent = await sendOutreachEmail({
    to: prospect.email,
    subject: message.subject || `question about ${prospect.company}`,
    body: cleanBody,
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
    .select("id, prospect_id, body, purpose, scheduled_at, ge_prospects(company, lead_score)")
    .eq("channel", "email")
    .eq("direction", "outbound")
    .eq("status", "queued")
    .order("created_at")
    // Wide enough that the PRIORITY SORT below sees the whole queue.
    //
    // This was `.limit(50)` — a cap on `created_at` order, applied before the
    // scheduled_at filter and before the chase-first/best-score sort that
    // decides who actually goes. With a queue past 50 the sort could only
    // reorder the OLDEST 50 rows, so a chase drafted last night — newest
    // created_at, and the one with a 7-day clock on it — was never in the pool
    // to be prioritised. The exact "score-ordered cap applied before the
    // still-to-work filter" shape CLAUDE.md lists.
    //
    // Costs nothing: these are tiny rows, one query, and the send count is
    // capped separately below. Today's queue does not reach 50, so this changes
    // no behaviour now — it stops the sort silently narrowing if it ever does.
    .limit(Math.max(200, MAX_SENDS_PER_RUN * 4));
  const now = new Date().toISOString();
  // Cap the morning batch: keeps the whole dispatch (reminders + sends +
  // brief) safely inside the 60s function budget and inside sensible daily
  // volume for a young domain — anything beyond the cap simply goes
  // tomorrow. WITHIN the cap, due CHASES outrank cold first touches: a chase
  // is time-boxed (7 days overdue = parked as gone-cold), so ranking purely
  // by lead score let low-score chases lose the budget race day after day
  // until they aged out — a silent lead leak. Fresh first touches have no
  // clock; they just go tomorrow. Then best score first within each group.
  const chaseRank = (m: { purpose?: string | null }) =>
    m.purpose === "follow_up" || m.purpose === "second_follow_up" ? 0 : 1;
  const due = (queued ?? [])
    .filter((m) => !m.scheduled_at || m.scheduled_at <= now)
    .sort(
      (a, b) =>
        chaseRank(a) - chaseRank(b) ||
        Number((b.ge_prospects as { lead_score?: number } | null)?.lead_score ?? 0) -
          Number((a.ge_prospects as { lead_score?: number } | null)?.lead_score ?? 0)
    )
    .slice(0, MAX_SENDS_PER_RUN);

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
