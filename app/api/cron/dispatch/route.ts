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

  const reviewReminders = await isolated("reviewReminders", sendReviewReminders);
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

  return NextResponse.json({
    ok: true,
    tasks: { reviewReminders, bookingSync, autoQueue, autoFollowups, emailAutopilot, jarvisBrief },
  });
}
