import { NextResponse, type NextRequest } from "next/server";
import { sendReviewReminders } from "@/lib/cron/send-review-reminders";
import { runInvoiceChaser } from "@/lib/cron/invoice-chaser";
import { runReviewAutopilot } from "@/lib/cron/review-autopilot";
import { sendJarvisMorningBrief } from "@/lib/cron/jarvis-morning-brief";
import {
  runQueuedEmailAutopilot,
  autoQueueTopDrafts,
  autoQueueDueFollowups,
} from "@/lib/growth/autopilot";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncStrategyBookingsCore } from "@/lib/growth/booking-sync";
import { isAuthorizedCron } from "@/lib/cron/auth";

/**
 * Single Vercel Cron entry, dispatching to every registered task. Adding
 * task #2 (for a future module) means adding a function call here, not a
 * new cron entry in vercel.json — keeps the platform comfortably within
 * Vercel's Hobby-tier cron-count limits as it grows toward 10-20 modules.
 *
 * Vercel signs its own cron requests with this header automatically; this
 * route still validates it itself rather than trusting the platform alone,
 * since this is otherwise a guessable public URL.
 */

// The Jarvis brief runs CRM queries plus one AI call — needs more than the
// default function budget.
export const maxDuration = 60;

/**
 * How long the brief will wait for the invoice chaser to finish writing
 * qa_invoices before going out regardless. See the call site for why the wait
 * exists and why it is bounded.
 */
const CHASER_SETTLE_MS = 10_000;

/** One task blowing up must never take the others down with it. */
async function isolated<T>(name: string, task: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await task();
  } catch (err) {
    console.error(`cron task ${name} threw:`, err);
    return { error: err instanceof Error ? err.message : "unknown" };
  }
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Started, NOT awaited. Review reminders touch only ra_customers and
  // businesses; every task below touches ge_* and strategy_bookings. The two
  // sets are disjoint, so there is nothing to race and no reason for the
  // reminder sends — several outbound emails, each a network round trip — to
  // sit on the critical path of a 60-second budget that also has to fit an AI
  // call. Awaited at the end, so a failure is still reported and the function
  // cannot return before it settles.
  //
  // The review autopilot is CHAINED behind the reminders rather than run
  // alongside them: both write ra_review_requests, and serialising the two is
  // free here (they are already off the critical path) where reasoning about
  // whether they can race is not.
  const reviewChainPromise = (async () => {
    const reminders = await isolated("reviewReminders", sendReviewReminders);
    const autopilot = await isolated("reviewAutopilot", runReviewAutopilot);
    return { reminders, autopilot };
  })();

  // Same treatment, same reasoning: the invoice chaser touches qa_invoices and
  // businesses only — disjoint from the ge_* and strategy_bookings tables every
  // sequential task below uses — so there is nothing to race and no reason for
  // its outbound emails to sit on the critical path of a 60-second budget that
  // also has to fit an AI call.
  //
  // It is NOT disjoint from the BRIEF, which reads qa_invoices. See the
  // bounded settle before the brief runs, further down.
  const invoiceChasePromise = isolated("invoiceChaser", runInvoiceChaser);

  // ─────────────────────────────────────────────────────────────────────
  // EVERYTHING BELOW IS STRICTLY SEQUENTIAL, AND THE ORDER IS LOAD-BEARING.
  //
  //   bookingSync → autoQueue → autoFollowups → emailAutopilot → brief
  //
  // bookingSync's markMeetingBooked() moves a prospect who booked a call
  // overnight to status "meeting_booked". autoQueueTopDrafts selects on
  // READY_STATUSES and autoQueueDueFollowups selects on
  // ["contacted", "follow_up_sent"] — so running the sync CONCURRENTLY with
  // either would let someone who has already booked a call be picked up for a
  // cold first touch or a chase, and emailed outreach hours after booking.
  //
  // The send then has to come after both queue steps, and the brief after the
  // send so it reports what actually went out. Do not "optimise" this into a
  // Promise.all — the disjoint task above is the only one that can float.
  // ─────────────────────────────────────────────────────────────────────

  // Auto-sync any AI Strategy Sessions booked overnight through the public
  // /book page into the Growth Engine as meetings — a booked call surfaces
  // itself, no manual "Sync bookings" click required.
  const bookingSync = await isolated("bookingSync", () =>
    syncStrategyBookingsCore(createAdminClient(), {
      createdBy: null,
      attributedTo: "the overnight engine",
    })
  );
  // Auto-queue tops the queue up to target with the best clean drafts (manual
  // queueing always takes the slots first), THEN the autopilot sends, THEN the
  // brief reports both — order matters.
  const autoQueue = await isolated("autoQueue", autoQueueTopDrafts);
  // Due follow-ups the overnight worker drafted — queued after first touches,
  // before the send, so the whole chase cycle runs itself (capped, gated).
  const autoFollowups = await isolated("autoFollowups", autoQueueDueFollowups);
  const emailAutopilot = await isolated("emailAutopilot", runQueuedEmailAutopilot);

  // The chaser is NOT as disjoint from the brief as it is from the ge_ chain.
  //
  // It WRITES qa_invoices.chase_count; the brief's money block READS
  // qa_invoices.chase_count and turns `>= 3` into the "📞 past automatic
  // chasing — needs a call" line. That line is the handoff from the engine to
  // Jude: the moment the sequence gives up and a human has to ring someone
  // about money. Whether it appeared was a race between two things started
  // minutes apart, so on the morning the third and final reminder went out,
  // the one line telling him to pick up the phone could silently be a day
  // late — and the brief's own comment claims it reports the reminders it
  // sends every morning.
  //
  // So settle the chaser BEFORE the brief reads. In practice this costs
  // nothing: it has had the whole sequential block above to finish.
  //
  // Bounded, because the brief matters more than the precision. The chaser
  // makes outbound HTTP calls with no timeout of their own, and a hung one
  // must never stop the 07:00 brief going out — that is the one thing
  // CLAUDE.md says can never be left broken. On timeout the brief sends
  // anyway, exactly as it does today, and the real result is still awaited
  // below so nothing is abandoned or unreported.
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  const chaserSettled = await Promise.race([
    invoiceChasePromise.then(() => true),
    new Promise<false>((resolve) => {
      settleTimer = setTimeout(() => resolve(false), CHASER_SETTLE_MS);
    }),
  ]);
  clearTimeout(settleTimer);
  if (!chaserSettled) {
    console.warn(
      `invoice chaser still running after ${CHASER_SETTLE_MS}ms — the brief's chase figures may not include this morning's run`
    );
  }

  const jarvisBrief = await isolated("jarvisBrief", sendJarvisMorningBrief);

  // Settle the disjoint task before responding, so its outcome is reported
  // rather than abandoned mid-flight when the function returns.
  const { reminders: reviewReminders, autopilot: reviewAutopilot } =
    await reviewChainPromise;
  const invoiceChaser = await invoiceChasePromise;

  return NextResponse.json({
    ok: true,
    // reviewReminders keeps its key and its shape — it is watched.
    tasks: {
      reviewReminders,
      reviewAutopilot,
      invoiceChaser,
      // False only when the chaser outran the settle window above — in which
      // case the brief's chase figures may lag by a morning, and this is how
      // that becomes visible rather than invisible.
      invoiceChaserSettledBeforeBrief: chaserSettled,
      bookingSync,
      autoQueue,
      autoFollowups,
      emailAutopilot,
      jarvisBrief,
    },
  });
}
