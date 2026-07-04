"use server";

import { requireAdmin } from "@/lib/auth/require-admin";
import { sendReviewReminders } from "@/lib/cron/send-review-reminders";

export type SweepResult =
  | { ok: true; claimed: number; sent: number; failed: number }
  | { ok: false; error: string };

/**
 * Runs the same reminder job the daily Vercel cron runs, on demand.
 * Admin-gated server action — no CRON_SECRET involved (that guards the
 * public HTTP route; this never leaves the server). Safe to run any
 * number of times: the claim step guarantees each reminder sends once.
 */
export async function runReminderSweep(): Promise<SweepResult> {
  await requireAdmin();

  const result = await sendReviewReminders();
  if (result.error) {
    return { ok: false, error: result.error };
  }
  return {
    ok: true,
    claimed: result.claimed,
    sent: result.sent,
    failed: result.failed,
  };
}
