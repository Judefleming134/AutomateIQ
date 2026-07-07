import { NextResponse, type NextRequest } from "next/server";
import { sendReviewReminders } from "@/lib/cron/send-review-reminders";
import { sendJarvisMorningBrief } from "@/lib/cron/jarvis-morning-brief";
import { runQueuedEmailAutopilot } from "@/lib/growth/autopilot";

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
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const reviewReminders = await isolated("reviewReminders", sendReviewReminders);
  // Autopilot fires BEFORE the brief so the 8am email reports what just went out.
  const emailAutopilot = await isolated("emailAutopilot", runQueuedEmailAutopilot);
  const jarvisBrief = await isolated("jarvisBrief", sendJarvisMorningBrief);

  return NextResponse.json({
    ok: true,
    tasks: { reviewReminders, emailAutopilot, jarvisBrief },
  });
}
