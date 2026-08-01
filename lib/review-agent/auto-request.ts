/**
 * When to ask for a review without being told to.
 *
 * ReputationIQ sells "ask while the job is still fresh — send the request the
 * day you finish, when goodwill is at its highest". Everything about that was
 * built except the part that matters: somebody had to remember to press Send,
 * on the day, for every job. On the evening of a long week nobody does, and
 * the goodwill window closes.
 *
 * QuoteIQ knows exactly when a job finished, because the business marks the
 * invoice PAID. That is the most reliable "this went well" signal on the
 * platform — better than a job status somebody has to maintain, because it is
 * something they do anyway, for their own reasons.
 *
 * So this file decides: given a paid invoice, do we ask?
 *
 * It is pure, and every rule below is a REFUSAL. This sends email from a
 * customer's own sending identity to THEIR customers with no human in the
 * loop, which is the most dangerous thing in the product. A review request
 * that shouldn't have gone cannot be recalled, and the person who looks bad
 * is the business, not us.
 */

export type AutoRequestInvoice = {
  id: string;
  business_id: string;
  customer_name: string | null;
  customer_email: string | null;
  status: string;
  paid_at: string | null;
  review_requested_at: string | null;
};

export type AutoRequestContext = {
  /** The business switched this on. Default is off and stays off. */
  optedIn: boolean;
  /** When this email address was last asked ANYTHING, across all jobs. */
  lastAskedAt?: string | null;
  /** They have already clicked a review link — they reviewed us. */
  hasReviewed?: boolean;
};

export type AutoRequestDecision =
  | { send: true }
  | { send: false; reason: string };

/**
 * How far back a run will look.
 *
 * THE most important number here. Without it, the first morning after a
 * business ticks the opt-in box, every customer they have invoiced since the
 * day they joined receives a review request at once — hundreds of emails, from
 * their address, about jobs finished a year ago. That is unrecoverable: it
 * cannot be unsent, it reads as a spam blast to their own customer base, and
 * it would be entirely our doing.
 *
 * Two weeks is generous for "still fresh" and short enough that switching the
 * feature on is a small, survivable action.
 */
export const MAX_JOB_AGE_DAYS = 14;

/**
 * How soon after being marked paid.
 *
 * Not immediately. A mis-tapped "mark paid" is corrected within minutes, and
 * an email that has already gone cannot be. Waiting until the next morning
 * run also matches the promise — "the day you finish", not "the second you
 * tap".
 */
export const MIN_HOURS_AFTER_PAID = 8;

/**
 * The same person is never asked twice in a quarter, whatever they bought.
 *
 * A busy customer with three jobs in a month is the BEST customer, and asking
 * them three times is how they stop being one.
 */
export const ASK_COOLDOWN_DAYS = 90;

/** Most requests one run will send, across every business. */
export const PER_RUN_CAP = 25;

/** Loose but real — enough to reject what is certainly not an address. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const days = (n: number) => n * 86_400_000;

export function decideAutoRequest(
  invoice: AutoRequestInvoice,
  context: AutoRequestContext,
  now: Date = new Date()
): AutoRequestDecision {
  if (!context.optedIn) {
    return { send: false, reason: "automatic requests are switched off for this business" };
  }
  // Belt and braces: the query filters on this, but this function is the
  // thing that must be right, not the query.
  if (invoice.status !== "paid") {
    return { send: false, reason: "invoice is not paid" };
  }
  if (invoice.review_requested_at) {
    return { send: false, reason: "already asked about this job" };
  }

  const email = (invoice.customer_email ?? "").trim();
  if (!email) return { send: false, reason: "no customer email on the invoice" };
  if (!EMAIL_RE.test(email)) {
    return { send: false, reason: "customer email looks invalid" };
  }

  if (!invoice.paid_at) {
    return { send: false, reason: "marked paid but with no date, so freshness is unknown" };
  }
  const paidAt = new Date(invoice.paid_at).getTime();
  if (Number.isNaN(paidAt)) {
    return { send: false, reason: "paid date could not be read" };
  }

  const age = now.getTime() - paidAt;
  if (age < 0) {
    // A clock skew or a hand-edited row. Never act on a job that finished in
    // the future.
    return { send: false, reason: "paid date is in the future" };
  }
  if (age < MIN_HOURS_AFTER_PAID * 3_600_000) {
    return { send: false, reason: "paid too recently — goes out on the next run" };
  }
  if (age > days(MAX_JOB_AGE_DAYS)) {
    return {
      send: false,
      reason: `job finished more than ${MAX_JOB_AGE_DAYS} days ago — too late to be fresh`,
    };
  }

  if (context.hasReviewed) {
    return { send: false, reason: "they have already left a review" };
  }

  if (context.lastAskedAt) {
    const asked = new Date(context.lastAskedAt).getTime();
    // An unreadable date is treated as "recently asked". The safe answer to
    // "have we bothered this person lately?" is always yes.
    if (Number.isNaN(asked) || now.getTime() - asked < days(ASK_COOLDOWN_DAYS)) {
      return {
        send: false,
        reason: `asked within the last ${ASK_COOLDOWN_DAYS} days`,
      };
    }
  }

  return { send: true };
}

/** The name to greet them by, never blank and never a guess. */
export function requestName(invoice: AutoRequestInvoice): string {
  return (invoice.customer_name ?? "").trim() || "there";
}

/**
 * One line for the morning brief.
 *
 * Reports what HAPPENED, including nothing happening. A routine that only
 * speaks up on success is a routine you stop trusting.
 */
export function autoRequestSummary(result: {
  sent: number;
  skipped: number;
  failed: number;
}): string {
  if (result.sent === 0 && result.failed === 0) {
    return result.skipped > 0
      ? `Review autopilot: nothing to ask about (${result.skipped} looked at).`
      : "Review autopilot: nothing to ask about.";
  }
  const parts = [`${result.sent} review request${result.sent === 1 ? "" : "s"} sent`];
  if (result.failed > 0) parts.push(`${result.failed} failed`);
  return `Review autopilot: ${parts.join(", ")}.`;
}
