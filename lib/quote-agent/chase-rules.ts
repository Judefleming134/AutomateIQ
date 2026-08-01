/**
 * When an overdue invoice gets chased, how it reads, and when it stops.
 *
 * /products/tradeiq: "Chasing is automatic rather than a job for a Sunday
 * evening." 0037 made invoices real; nothing chased them. An invoice could go
 * out, sail past its due date, and sit there forever with the platform silent.
 *
 * Pure, so the part that decides whether to email a real customer about money
 * is testable without a database or a mail provider.
 *
 * THE SEQUENCE STOPS. That is the most important rule here. A business that
 * emails a customer every day about €300 does more damage to the relationship
 * than the debt is worth, and an automated nag with no end is the fastest way
 * to make a customer never call you again. Three reminders, spaced further
 * apart each time, and then it is a phone call — which is a human's job.
 */

/** Days after the due date before the FIRST reminder. */
export const FIRST_CHASE_AFTER_DAYS = 3;

/**
 * Minimum gap before the NEXT reminder, by how many have already gone:
 * 3 days after the 1st, 7 after the 2nd, 14 after the 3rd.
 *
 * Indexed by `count - 1`. Indexing by `count` made the first entry
 * unreachable — there is never a previous chase to space from when the count
 * is 0 — so every gap silently ran one step too wide and the sequence took
 * more than twice as long as intended to complete.
 */
export const CHASE_GAP_DAYS = [3, 7, 14] as const;

/** After this many reminders the engine stops and hands it to a human. */
export const MAX_CHASES = 3;

export type ChaseCandidate = {
  status: string;
  due_date: string | null;
  customer_email: string | null;
  amount_cents: number;
  paid_amount_cents?: number | null;
  last_chased_at?: string | null;
  chase_count?: number | null;
};

export type ChaseDecision =
  | { chase: true; nextCount: number }
  | { chase: false; reason: string };

/** Whole days between two ISO instants/dates, floored. */
function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(fromISO.length <= 10 ? `${fromISO}T00:00:00Z` : fromISO);
  const b = Date.parse(toISO.length <= 10 ? `${toISO}T00:00:00Z` : toISO);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.floor((b - a) / 86_400_000);
}

/**
 * Should this invoice be chased right now?
 *
 * Every "no" carries its reason, because the morning brief reports what the
 * chaser did and "skipped 12" with no explanation is not a report.
 */
export function shouldChase(invoice: ChaseCandidate, nowISO: string): ChaseDecision {
  // Only a SENT invoice is a debt. A draft was never delivered, a paid one is
  // settled, a void one was cancelled — chasing any of them is indefensible.
  if (invoice.status !== "sent") {
    return { chase: false, reason: `not chaseable (${invoice.status})` };
  }
  if (!invoice.due_date) {
    return { chase: false, reason: "no due date" };
  }
  if (!invoice.customer_email) {
    return { chase: false, reason: "no email address" };
  }
  // A part payment is a customer engaging in good faith. The balance is still
  // owed, but it is NOT the same as silence, so the sequence restarts its
  // spacing rather than escalating on someone who has already paid something.
  const paid = invoice.paid_amount_cents ?? 0;
  if (paid >= invoice.amount_cents) {
    return { chase: false, reason: "already covered" };
  }
  if (invoice.amount_cents <= 0) {
    return { chase: false, reason: "nothing owed" };
  }

  const count = invoice.chase_count ?? 0;
  if (count >= MAX_CHASES) {
    return { chase: false, reason: "chase sequence finished — needs a phone call" };
  }

  const overdueDays = daysBetween(invoice.due_date, nowISO);
  if (overdueDays < FIRST_CHASE_AFTER_DAYS) {
    return {
      chase: false,
      reason: `only ${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue`,
    };
  }

  if (invoice.last_chased_at) {
    const since = daysBetween(invoice.last_chased_at, nowISO);
    const gap = CHASE_GAP_DAYS[Math.min(count - 1, CHASE_GAP_DAYS.length - 1)] ?? CHASE_GAP_DAYS[0];
    if (since < gap) {
      return { chase: false, reason: `chased ${since} day${since === 1 ? "" : "s"} ago` };
    }
  }

  return { chase: true, nextCount: count + 1 };
}

/**
 * The reminder itself. Escalates in firmness, never in rudeness — the customer
 * may simply have missed it, and the third message still has to be one you'd
 * be happy to have forwarded to someone else.
 */
export function chaseMessage(input: {
  chaseNumber: number;
  customerName: string;
  businessName: string;
  invoiceNumber: string;
  amountLabel: string;
  daysOverdue: number;
  link: string;
  partPaid: boolean;
}): { subject: string; text: string } {
  const { chaseNumber, customerName, businessName, invoiceNumber, amountLabel, daysOverdue, link } =
    input;

  const opening =
    chaseNumber === 1
      ? `Just a gentle reminder that invoice ${invoiceNumber} for ${amountLabel} is now ${daysOverdue} days past its due date. It may well have slipped past — it happens.`
      : chaseNumber === 2
        ? `Following up on invoice ${invoiceNumber} for ${amountLabel}, which is now ${daysOverdue} days overdue. If it has already been paid, let us know and we'll square it up our end.`
        : `Invoice ${invoiceNumber} for ${amountLabel} is now ${daysOverdue} days overdue. This is the last automatic reminder — we'd rather sort it out with a quick call than keep emailing.`;

  const balanceNote = input.partPaid
    ? " Thanks for the payment already made — this is for the remaining balance."
    : "";

  const subject =
    chaseNumber === 1
      ? `Reminder: invoice ${invoiceNumber} from ${businessName}`
      : chaseNumber === 2
        ? `Invoice ${invoiceNumber} — ${daysOverdue} days overdue`
        : `Invoice ${invoiceNumber} — can we settle this?`;

  const text = [
    `Hi ${customerName},`,
    "",
    opening + balanceNote,
    "",
    "You can see the invoice here:",
    link,
    "",
    "If there's a problem with it, reply to this email and we'll sort it.",
    "",
    "Thanks,",
    businessName,
  ].join("\n");

  return { subject, text };
}

/** Days an invoice is past due, for the copy. Never negative. */
export function overdueDays(dueDate: string, nowISO: string): number {
  return Math.max(0, daysBetween(dueDate, nowISO));
}
