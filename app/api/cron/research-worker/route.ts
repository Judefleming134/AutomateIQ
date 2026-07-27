import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runCompanyResearch } from "@/lib/growth/research";
import {
  mapResearchError,
  parkResearchFailure,
  persistResearchResult,
} from "@/lib/growth/research-runner";
import { draftStudioMessage } from "@/lib/growth/ai";
import { outreachHistoryLines } from "@/lib/growth/outreach";
import { loadGrowthSettings } from "@/lib/growth/auth";
import { pricingLines } from "@/lib/growth/pricing";
import { sanitizeOutreachBody, draftLooksBroken } from "@/lib/growth/email";
import { isAuthorizedCron } from "@/lib/cron/auth";
import { autoDraftReply } from "@/lib/growth/reply-draft";
import { dublinDate } from "@/lib/growth/dates";
import { selectAllRows } from "@/lib/growth/db";
import type { ResearchReport } from "@/lib/growth/research";

// Two researches (~20-40s each on Gemini) must fit one invocation.
export const maxDuration = 60;

/**
 * The overnight research worker: each call researches up to 2 fresh
 * unresearched prospects — full report, score, contact backfill and the five
 * first-touch drafts — using EXACTLY the same runner as the on-page button.
 * Driven every 10 minutes overnight by a GitHub Action, it turns "import,
 * then click batches for an hour" into "import, sleep, wake to a researched
 * pipeline". The morning brief reports what it did via the "Jarvis nightly:"
 * activity prefix.
 *
 * Guard rails:
 * - Same CRON_SECRET auth as every other cron endpoint.
 * - Website-first ordering (research quality) with the stable id tiebreak.
 * - The research_failed group SELF-HEALS: one failed lead is retried per run
 *   (24h backoff between attempts, 3 strikes then it's a human's call) —
 *   bounded so a permanently-broken site can't drain quota, but steady
 *   enough (~40 runs/night) that the pile clears itself overnight.
 * - Failures park the lead exactly like the button does; an ACCOUNT-level
 *   AI failure (credits/quota) aborts the run before wasting the second
 *   slot — the next scheduled call probes again cheaply.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // BOOST (manual drain): ?boost=1 turns this from the gentle overnight
  // trickle (2 leads/tick) into a fast, hands-off queue-drainer. It's driven
  // by the workflow_dispatch loop ticking every ~30s, so a founder can kick
  // it, close the app, and come back to a researched pipeline — no browser
  // tab held open. Boost researches several leads PER TICK in parallel and
  // skips the overnight follow-up/reply drafting (that's polish, not the job
  // here). Because it's an explicit human request, it runs even while the
  // unattended overnight worker is paused.
  const boost = request.nextUrl.searchParams.get("boost") === "1";

  // Self-researching by default: leads research themselves overnight so nobody
  // has to click "research next batch" each day. On the free Gemini tier this
  // spends the day's quota overnight — which is the intent (a hands-off
  // pipeline that's full by morning); it stops itself cleanly the moment the
  // daily cap is hit, and never breaks the 07:00 send (that path needs no AI).
  // Set OVERNIGHT_RESEARCH_ENABLED=0 (or "false") to pause it — e.g. to reserve
  // the day's Gemini quota for hands-on research instead. A manual boost always
  // runs regardless.
  const disabled =
    process.env.OVERNIGHT_RESEARCH_ENABLED === "0" ||
    process.env.OVERNIGHT_RESEARCH_ENABLED === "false";
  if (disabled && !boost) {
    return NextResponse.json({
      ok: true,
      skipped: "overnight auto-research is paused (OVERNIGHT_RESEARCH_ENABLED=0) — remove it or set 1 to resume, or call with ?boost=1 for a manual drain",
    });
  }

  const admin = createAdminClient();

  // Fresh leads only: never researched, not parked, not closed. Website
  // holders first — the engine reads the site, so they research best.
  // selectAllRows: an unranged select caps at 1,000 rows, and once research
  // rows pass that the worker would re-offer (and re-research) leads that
  // are already done — burning quota nightly and overwriting drafts.
  const researched = await selectAllRows<{ prospect_id: string }>(() =>
    admin.from("ge_research").select("prospect_id").order("prospect_id")
  );
  const researchedIds = new Set(researched.map((r) => r.prospect_id));

  const { data: candidates } = await admin
    .from("ge_prospects")
    .select("*")
    .not("status", "in", '("won","lost","do_not_contact","archived")')
    .not("status", "eq", "research_failed")
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(400);

  // Follow-ups must never starve behind a deep research queue: in full-auto
  // mode the fresh queue can stay hundreds deep for weeks, and with both
  // slots always going to fresh research, due chases would never get drafted
  // — and so never send. If any chase is due, reserve one slot for it.
  // EXACTLY the drafting section's predicate (7-day freshness window, must
  // have an email) — a broader count here would reserve a slot for chases
  // the drafter will never draft (gone-cold or email-less leads), silently
  // halving research speed every run.
  const { count: dueFollowUps } = await admin
    .from("ge_prospects")
    .select("id", { count: "exact", head: true })
    .lte("next_follow_up_at", dublinDate())
    .gte("next_follow_up_at", dublinDate(-7))
    .not("email", "is", null)
    .in("status", ["contacted", "follow_up_sent"]);
  const freshCap = (dueFollowUps ?? 0) > 0 ? 1 : 2;

  // Ferrari ordering: the 9am run can only SEND prospects that have an
  // email, so research those first or overnight slots produce drafts that
  // can't go out while sendable leads sit waiting. Within that, website
  // holders first (the engine reads the site, so they research best):
  //   email+website → email only → website only (feeds the DM list) → rest.
  // Array.sort is stable, so created_at-desc order holds within each group.
  const researchRank = (p: { email: string | null; website: string | null }) =>
    p.email && p.website ? 0 : p.email ? 1 : p.website ? 2 : 3;
  const freshSorted = (candidates ?? [])
    .filter((p) => !researchedIds.has(p.id))
    .sort((a, b) => researchRank(a) - researchRank(b));

  // ── MAINTENANCE: requeue the research-failed group ───────────────────────
  // ?requeue_failed=1 flips leads out of research_failed back to 'new' so they
  // can be researched again. Needed because a bad drain (or an AI outage) can
  // park a whole batch as "failed" through no fault of the lead — this undoes
  // that in bulk instead of clicking Retry hundreds of times. Bounded per call;
  // the dispatch loop / repeat calls handle larger piles.
  if (request.nextUrl.searchParams.get("requeue_failed") === "1") {
    const { data: parked } = await admin
      .from("ge_prospects")
      .select("id")
      .eq("status", "research_failed")
      .limit(500);
    const ids = (parked ?? []).map((p) => p.id);
    if (ids.length > 0) {
      await admin.from("ge_prospects").update({ status: "new" }).in("id", ids);
    }
    return NextResponse.json({ ok: true, requeued: ids.length });
  }

  // ── BOOST DRAIN ──────────────────────────────────────────────────────────
  // Research several fresh leads THIS TICK, in parallel, then return how many
  // are still queued. Bounded so the whole tick stays inside the 60s
  // serverless ceiling: each lead is website-fetch (≤10s) + one AI call
  // (≤42s), and 3 in parallel finish in roughly the time of one. The
  // dispatch loop calls back every ~30s, so the queue drains steadily without
  // any browser tab.
  //
  // Crucially, a manual drain does NOT park failures into research_failed: a
  // transient AI outage (free-tier daily quota, a 5xx blip) fails EVERY lead
  // it touches, and parking would dump the whole queue into the failed pile
  // through no fault of the leads (which is exactly what happened the first
  // time). Instead, failures leave the lead untouched ('new'), the tick
  // reports them, and if a WHOLE tick fails to research anything the loop is
  // told to stop (`more:false`) — so a systemic problem halts the drain after
  // one wasted tick rather than shredding 300 leads.
  if (boost) {
    const BOOST_PER_TICK = 3;
    const batch = freshSorted.slice(0, BOOST_PER_TICK);
    let researched = 0;
    let halted: string | null = null;
    const done: string[] = [];
    const failures: string[] = [];
    const results = await Promise.allSettled(
      batch.map(async (prospect) => {
        const result = await runCompanyResearch(prospect);
        const persisted = await persistResearchResult(
          admin,
          prospect,
          result,
          null,
          (score) =>
            `Background research: ${prospect.company} researched (${
              result.websiteFetched ? "website analysed" : "website unreachable — inferred from details"
            }) — scored ${score}/100, outreach drafts ready`
        );
        if (!persisted.ok) throw new Error(persisted.error);
        return prospect;
      })
    );
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "fulfilled") {
        researched += 1;
        done.push(batch[i].company);
      } else {
        const { friendly, accountDead, dailyQuota } = mapResearchError(r.reason);
        failures.push(`${batch[i].company}: ${friendly.slice(0, 100)}`);
        if (accountDead || dailyQuota) halted = friendly;
        // NOTE: deliberately NOT parking — leave the lead 'new' so a transient
        // outage doesn't dump it into the failed group.
      }
    }
    // Systemic-failure circuit breaker: if this tick touched leads but
    // researched none, the problem is the AI provider, not the leads — stop
    // the loop so it can't keep hammering (and, before this fix, shredding)
    // the queue. A productive tick (researched > 0) keeps the drain going.
    const systemicFailure = batch.length > 0 && researched === 0;
    const remaining = Math.max(0, freshSorted.length - researched);
    return NextResponse.json({
      ok: true,
      boost: true,
      researched,
      remaining,
      done,
      failures: failures.slice(0, 3),
      halted: halted ?? (systemicFailure ? failures[0] ?? "every lead failed to research" : undefined),
      // The loop reads this: stop when nothing's left, the account is out, or a
      // whole tick failed (systemic AI problem); otherwise keep ticking.
      more: halted || systemicFailure ? false : remaining > 0,
    });
  }
  // ── end boost drain ──────────────────────────────────────────────────────

  // Auto-retry the Research-failed group — full-auto means nobody is around
  // to click "Retry failed", and a deep fresh queue must NOT block healing
  // (it used to: retries only ran when the queue was empty, so with hundreds
  // of fresh leads the failed pile just sat there). One failed lead gets a
  // slot on every run that has one spare — at ~40 overnight runs the whole
  // pile clears itself night by night. Still strictly bounded: one per run,
  // 24h backoff between attempts on the same lead (each failed retry
  // re-stamps the failure activity, so backoff is automatic), and never
  // beyond 3 total attempts (then it genuinely needs a human look/archive).
  // When due follow-ups reserved a slot (researchBudget 1), fresh leads keep
  // it — the chase cycle is never slowed — unless the fresh queue is empty.
  const researchBudget = freshCap;
  const retries: NonNullable<typeof candidates> = [];
  const retrySlotFree = researchBudget >= 2 || freshSorted.length === 0;
  if (retrySlotFree) {
    const { data: parked } = await admin
      .from("ge_prospects")
      .select("*")
      .eq("status", "research_failed")
      .order("created_at", { ascending: true })
      .limit(25);
    const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    for (const p of parked ?? []) {
      const { data: fails } = await admin
        .from("ge_activities")
        .select("created_at")
        .eq("prospect_id", p.id)
        .ilike("content", "Research failed:%")
        .order("created_at", { ascending: false })
        .limit(3);
      const lastFail = fails?.[0]?.created_at;
      if ((fails ?? []).length >= 3) continue; // 3 strikes — human's call now
      if (lastFail && lastFail > cutoff) continue; // too soon — back off
      retries.push(p);
      break; // one retry per run
    }
  }
  const fresh = freshSorted.slice(0, Math.max(0, researchBudget - retries.length));
  const toResearch = [...fresh, ...retries];

  let done = 0;
  const notes: string[] = [];

  // Self-heal zombie leads: a serverless timeout mid-persist can leave a
  // lead WITH a research row but status still new/researching — invisible
  // to the autopilot (which only offers research_complete/outreach_ready)
  // despite having drafts ready. Cheap idempotent sweep every tick; the
  // conditional update means an actually-in-flight research can't be
  // clobbered (its own persist sets the status moments later anyway).
  const { data: maybeZombies } = await admin
    .from("ge_prospects")
    .select("id, company, status")
    .in("status", ["new", "researching"])
    .limit(50);
  for (const z of (maybeZombies ?? []).filter((p) => researchedIds.has(p.id))) {
    const { error } = await admin
      .from("ge_prospects")
      .update({ status: "research_complete" })
      .eq("id", z.id)
      .in("status", ["new", "researching"]);
    if (!error) {
      notes.push(`${z.company}: healed — research existed but the status was stuck`);
      await admin.from("ge_activities").insert({
        prospect_id: z.id,
        type: "system",
        content:
          "Jarvis nightly: healed a stuck lead — research was done but the status never advanced (likely an interrupted run); now visible to the autopilot",
        created_by: null,
      });
    }
  }

  for (const prospect of toResearch) {
    try {
      const result = await runCompanyResearch(prospect);
      const persisted = await persistResearchResult(
        admin,
        prospect,
        result,
        null,
        (score) =>
          `Jarvis nightly: researched ${prospect.company} while you slept (${
            result.websiteFetched ? "website analysed" : "website unreachable — inferred from details"
          }) — scored ${score}/100, outreach drafts ready`
      );
      if (persisted.ok) {
        done += 1;
        notes.push(`${prospect.company}: scored ${persisted.score}`);
      } else {
        notes.push(`${prospect.company}: persist failed (${persisted.error})`);
      }
    } catch (err) {
      const { friendly, accountDead, dailyQuota } = mapResearchError(err);
      // Account-level failure (daily quota spent, credits dead) is not the
      // LEAD's fault — park nothing, touch nothing, stop the run. Otherwise,
      // on a quota-exhausted night, every 10-minute run would park one more
      // innocent lead into the Research-failed group, draining the fresh
      // queue into the failed pile by morning. The next scheduled run
      // re-probes cheaply; once the quota resets, everything just continues.
      if (accountDead || dailyQuota) {
        notes.push(`stopped: ${friendly.slice(0, 80)}`);
        break;
      }
      await parkResearchFailure(admin, prospect, friendly, null);
      notes.push(`${prospect.company}: ${friendly.slice(0, 80)}`);
    }
  }

  // Second skill: when the fresh-research queue is drained (or short), spend
  // the leftover slots DRAFTING DUE FOLLOW-UPS — prospects whose chase date
  // has arrived and who don't already have an unsent follow-up draft. Come
  // morning, every due chase greets Jude pre-written in the Studio.
  let followUpsDrafted = 0;
  const slots = 2 - toResearch.length;
  if (slots > 0) {
    try {
      const today = dublinDate();
      const { data: due } = await admin
        .from("ge_prospects")
        .select("id, company, contact_name, job_title, industry, website, location, notes, campaign_id")
        .lte("next_follow_up_at", today)
        // Same 7-day freshness window as the auto-queue: don't spend AI calls
        // drafting chases for leads that have gone cold, and only for leads
        // that can actually be emailed.
        .gte("next_follow_up_at", dublinDate(-7))
        .not("email", "is", null)
        .in("status", ["contacted", "follow_up_sent"])
        .order("lead_score", { ascending: false, nullsFirst: false })
        .limit(20);
      const settings = await loadGrowthSettings();
      for (const p of due ?? []) {
        if (followUpsDrafted >= slots) break;
        // 3-touch sequence: touch 1 = the first email, touch 2 = follow_up
        // (a NEW angle / value), touch 3 = second_follow_up (direct "grab a
        // slot" with the booking link). Count chases already SENT to pick the
        // next one; after two chases the sequence is complete — stop, don't
        // harass. (autoQueueDueFollowups enforces the same cap at send time.)
        const { count: sentChases } = await admin
          .from("ge_messages")
          .select("id", { count: "exact", head: true })
          .eq("prospect_id", p.id)
          .eq("channel", "email")
          .eq("direction", "outbound")
          .in("purpose", ["follow_up", "second_follow_up"])
          .eq("status", "sent");
        if ((sentChases ?? 0) >= 2) continue; // sequence done
        const nextPurpose = (sentChases ?? 0) === 0 ? "follow_up" : "second_follow_up";
        // Skip anyone who already has an unsent chase draft waiting.
        const { data: existing } = await admin
          .from("ge_messages")
          .select("id")
          .eq("prospect_id", p.id)
          .eq("channel", "email")
          .eq("direction", "outbound")
          .in("purpose", ["follow_up", "second_follow_up"])
          .in("status", ["draft", "queued"])
          .limit(1)
          .maybeSingle();
        if (existing) continue;
        const [{ data: research }, history] = await Promise.all([
          admin
            .from("ge_research")
            .select("report, solutions")
            .eq("prospect_id", p.id)
            .maybeSingle(),
          // The chase must anchor to the REAL first email (channel, date,
          // actual subject), not a generic "following up on my note".
          outreachHistoryLines(admin, p.id),
        ]);
        const keys = Array.isArray(research?.solutions)
          ? (research!.solutions as { key?: string }[])
              .map((s) => s.key)
              .filter((k): k is string => Boolean(k))
          : [];
        try {
          const draft = await draftStudioMessage(
            p,
            (research?.report as ResearchReport | undefined) ?? null,
            { channel: "email", purpose: nextPurpose, tone: "professional" },
            settings.bookingUrl,
            pricingLines(keys),
            history
          );
          const clean = sanitizeOutreachBody(draft.body);
          if (draftLooksBroken(clean)) continue; // never save a broken draft
          await admin.from("ge_messages").insert({
            prospect_id: p.id,
            campaign_id: p.campaign_id,
            channel: "email",
            direction: "outbound",
            status: "draft",
            purpose: nextPurpose,
            tone: "professional",
            subject: draft.subject,
            body: clean,
            created_by: null,
          });
          followUpsDrafted += 1;
          const touchLabel = nextPurpose === "follow_up" ? "follow-up (touch 2)" : "final follow-up (touch 3)";
          notes.push(`${p.company}: ${touchLabel} drafted`);
          await admin.from("ge_activities").insert({
            prospect_id: p.id,
            type: "system",
            content: `Jarvis nightly: drafted the ${touchLabel} email (chase was due ${today}) — ready in the Studio`,
            created_by: null,
          });
        } catch (err) {
          const { accountDead, dailyQuota } = mapResearchError(err);
          if (accountDead || dailyQuota) break; // account-level: stop the run
          // One bad draft never blocks the rest.
        }
      }
    } catch (err) {
      notes.push(
        `follow-up drafting error: ${err instanceof Error ? err.message : "unknown"}`
      );
    }
  }

  // Third skill: catch-up reply drafts. The auto-reply-draft fires when a
  // reply is captured, but replies captured before that feature (or where
  // drafting failed) can sit with no suggested response. Any slots still
  // spare go to prospects in 'replied' status without an unsent reply draft —
  // so every warm reply, the closest thing to a customer, greets Jude
  // pre-written by morning. autoDraftReply dedupes and stays best-effort.
  let repliesDrafted = 0;
  const replySlots = slots - followUpsDrafted;
  if (replySlots > 0) {
    try {
      const { data: replied } = await admin
        .from("ge_prospects")
        .select("id, company, contact_name, job_title, industry, website, location, notes, campaign_id")
        .eq("status", "replied")
        .order("lead_score", { ascending: false, nullsFirst: false })
        .limit(20);
      for (const p of replied ?? []) {
        if (repliesDrafted >= replySlots) break;
        // The message to answer: their most recent inbound.
        const { data: lastIn } = await admin
          .from("ge_messages")
          .select("body")
          .eq("prospect_id", p.id)
          .eq("direction", "inbound")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!lastIn?.body) continue;
        const drafted = await autoDraftReply(admin, p, lastIn.body, null);
        if (drafted) {
          repliesDrafted += 1;
          notes.push(`${p.company}: reply drafted`);
        }
      }
    } catch (err) {
      notes.push(
        `reply drafting error: ${err instanceof Error ? err.message : "unknown"}`
      );
    }
  }

  if (done === 0 && followUpsDrafted === 0 && repliesDrafted === 0 && notes.length === 0) {
    return NextResponse.json({ ok: true, researched: 0, detail: "nothing to do" });
  }

  return NextResponse.json({
    ok: true,
    researched: done,
    followUpsDrafted,
    repliesDrafted,
    detail: notes.join("; ").slice(0, 500),
  });
}
