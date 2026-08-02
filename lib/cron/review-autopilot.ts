import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingTableError } from "@/lib/db/errors";
import { sendReviewRequestCore } from "@/lib/review-agent/send-core";
import { reviewLinkStatus } from "@/lib/review-agent/review-hosts";
import {
  decideAutoRequest,
  requestName,
  autoRequestSummary,
  MAX_JOB_AGE_DAYS,
  ASK_COOLDOWN_DAYS,
  PER_RUN_CAP,
  type AutoRequestInvoice,
} from "@/lib/review-agent/auto-request";

/**
 * "Ask while the job is still fresh", without anyone having to remember.
 *
 * Runs on the existing 07:00 dispatch, off the critical path. Finds invoices
 * marked PAID since yesterday for businesses that opted in, and sends one
 * review request each.
 *
 * SAFETY, because this emails a customer's own customers unattended:
 *   - OPT-IN, default off. Nothing happens to any existing business.
 *   - A two-week age window, so switching the toggle on cannot blast every
 *     customer of the last two years. This is the guard that matters most.
 *   - review_requested_at is written only AFTER the send succeeds, so a
 *     failure retries tomorrow rather than being silently marked done — and
 *     the send path's own duplicate guard covers the gap in between.
 *   - Nobody is asked twice in 90 days, whatever they bought.
 *   - Anyone who has already left a review is never asked again.
 *   - Hard per-run cap, so one bad day cannot become a mailout.
 *   - Kill switch: REPUTATIONIQ_AUTOREQUEST=0.
 *   - Every failure is collected and reported; nothing is swallowed.
 */

/** How far down the candidate list to look. */
const SCAN_LIMIT = 200;

export type ReviewAutopilotResult = {
  sent: number;
  skipped: number;
  failed: number;
  detail: string;
};

export async function runReviewAutopilot(): Promise<ReviewAutopilotResult> {
  const flag = (process.env.REPUTATIONIQ_AUTOREQUEST ?? "").toLowerCase();
  if (flag === "0" || flag === "off") {
    return { sent: 0, skipped: 0, failed: 0, detail: "review autopilot disabled" };
  }

  const admin = createAdminClient();
  const now = new Date();
  const since = new Date(now.getTime() - MAX_JOB_AGE_DAYS * 86_400_000).toISOString();

  const { data: candidates, error } = await admin
    .from("qa_invoices")
    .select(
      "id, business_id, customer_name, customer_email, status, paid_at, review_requested_at"
    )
    .eq("status", "paid")
    .is("review_requested_at", null)
    // The window is applied in the QUERY as well as in decideAutoRequest. The
    // decision function is the thing that must be right, but a query that
    // could return two years of invoices is a loaded gun sitting next to it.
    .gte("paid_at", since)
    .order("paid_at", { ascending: true })
    .limit(SCAN_LIMIT);

  if (error) {
    if (isMissingTableError(error) || /review_requested_at/i.test(error.message)) {
      return {
        sent: 0,
        skipped: 0,
        failed: 0,
        detail: "review autopilot idle — run migrations 0037 and 0041",
      };
    }
    return { sent: 0, skipped: 0, failed: 1, detail: `autopilot query failed: ${error.message}` };
  }

  const rows = (candidates ?? []) as AutoRequestInvoice[];
  if (rows.length === 0) {
    return { sent: 0, skipped: 0, failed: 0, detail: "no finished jobs to ask about" };
  }

  // Which businesses opted in, and which have a review link at all. Fetched
  // once rather than per invoice.
  const businessIds = [...new Set(rows.map((r) => r.business_id))];
  const { data: businesses } = await admin
    .from("businesses")
    .select("id, auto_review_requests, google_review_link")
    .in("id", businessIds);
  // A link has to be a web address a customer can actually be sent to, not
  // merely non-empty. `Boolean(google_review_link)` was true for "ask me for
  // it" or a half-pasted fragment, so a business that ticked the box with
  // something unusable in the field had review requests emailed to its own
  // customers carrying a link that goes nowhere — worse than not asking, and
  // unrecallable. Judged by the SAME parser the redirect and the settings page
  // use, so all three agree about what counts as a usable link.
  //
  // Strictly a narrowing: this can only ever withhold a send that would have
  // gone out broken. Nothing that worked before stops working.
  const unusableLink: string[] = [];
  const optedIn = new Map(
    (businesses ?? []).map((b) => {
      const wants = Boolean(b.auto_review_requests);
      const link = reviewLinkStatus(b.google_review_link as string | null);
      if (wants && !link.ok) unusableLink.push(b.id as string);
      return [b.id as string, wants && link.ok];
    })
  );

  // Everyone these businesses have already asked, and whether they reviewed.
  // One read for the whole run: per-invoice lookups would be 200 round trips
  // on the morning path that also has to send the outreach.
  const { data: history } = await admin
    .from("ra_review_requests")
    .select("business_id, created_at, status, ra_customers!inner(email)")
    .in("business_id", businessIds)
    .gte("created_at", new Date(now.getTime() - ASK_COOLDOWN_DAYS * 86_400_000).toISOString())
    .limit(1000);

  // Keyed by business + address, because two businesses can legitimately share
  // a customer and one asking must not silence the other.
  const key = (businessId: string, email: string) =>
    `${businessId}:${email.trim().toLowerCase()}`;
  const lastAsked = new Map<string, string>();
  const reviewed = new Set<string>();
  for (const row of history ?? []) {
    const contact = row.ra_customers as unknown as { email?: string } | null;
    const email = contact?.email;
    if (!email) continue;
    const k = key(String(row.business_id), email);
    const at = String(row.created_at);
    const seen = lastAsked.get(k);
    if (!seen || at > seen) lastAsked.set(k, at);
    if (row.status === "clicked") reviewed.add(k);
  }

  let sent = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const invoice of rows) {
    if (sent >= PER_RUN_CAP) {
      skipped += 1;
      continue;
    }
    const k = key(invoice.business_id, invoice.customer_email ?? "");
    const decision = decideAutoRequest(
      invoice,
      {
        optedIn: optedIn.get(invoice.business_id) ?? false,
        lastAskedAt: lastAsked.get(k) ?? null,
        hasReviewed: reviewed.has(k),
      },
      now
    );
    if (!decision.send) {
      skipped += 1;
      continue;
    }

    // The admin client is deliberate and the reason matters: there is no user
    // session on a cron run, so RLS has nothing to scope by. business_id comes
    // from the invoice row itself and is passed explicitly, so every read and
    // write inside stays inside that one tenant.
    const result = await sendReviewRequestCore(
      admin,
      invoice.business_id,
      requestName(invoice),
      invoice.customer_email!.trim()
    );

    if (!result.ok) {
      // NOT marked as asked. Tomorrow's run tries again; the send path's own
      // five-minute duplicate guard stops a retry storm in the meantime.
      failures.push(`${invoice.id}: ${result.error}`);
      continue;
    }

    // Marked only now, after the email has actually gone.
    const { error: markError } = await admin
      .from("qa_invoices")
      .update({ review_requested_at: new Date().toISOString() })
      .eq("id", invoice.id);
    if (markError) {
      // The email HAS gone and we could not record it. Say so — the customer
      // could be asked again tomorrow, and that is worth a line in the brief
      // rather than a silent second email.
      failures.push(`${invoice.id}: sent but not recorded (${markError.message})`);
    }
    sent += 1;
  }

  // An opt-in that can never fire is a setting the customer believes is on.
  // Say it in the run detail rather than letting it be a silent nothing.
  const linkNote = unusableLink.length
    ? ` · ${unusableLink.length} business${unusableLink.length === 1 ? "" : "es"} opted in but the review link isn't a usable web address — nothing sent for them`
    : "";
  const base = autoRequestSummary({ sent, skipped, failed: failures.length }) + linkNote;
  return {
    sent,
    skipped,
    failed: failures.length,
    detail: failures.length ? `${base} ${failures.slice(0, 3).join("; ")}` : base,
  };
}
