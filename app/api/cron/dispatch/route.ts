import { NextResponse, type NextRequest } from "next/server";
import { sendReviewReminders } from "@/lib/cron/send-review-reminders";
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
  const reviewRemindersPromise = isolated("reviewReminders", sendReviewReminders);

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
  const jarvisBrief = await isolated("jarvisBrief", sendJarvisMorningBrief);

  // Settle the disjoint task before responding, so its outcome is reported
  // rather than abandoned mid-flight when the function returns.
  const reviewReminders = await reviewRemindersPromise;

  return NextResponse.json({
    ok: true,
    tasks: { reviewReminders, bookingSync, autoQueue, autoFollowups, emailAutopilot, jarvisBrief },
  });
}
