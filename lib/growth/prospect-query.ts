/**
 * The follow-up buckets, defined ONCE.
 *
 * The Prospects page and the CSV export both have to narrow the same table to
 * the same set, because the export button sits on the page and its tooltip
 * says "Exports the filtered list you're looking at". Two copies of that logic
 * is two things that can drift, and they did:
 *
 * A fifth bucket, `unscheduled`, was added to the page — "contacted, but with
 * no next step booked", which the dashboard links straight to. The export was
 * never taught about it, so it fell through every branch and applied nothing.
 * Arriving from the dashboard count, seeing 43 prospects, and pressing Export
 * CSV handed back EVERY prospect in the database — in a file named
 * `growth-prospects-filtered`, which asserts the opposite.
 *
 * The export route's own comment warned about this exact failure for the
 * `cold` bucket ("exporting from a 'Gone cold' view would quietly hand back
 * the whole database") — and then it happened again with the next bucket
 * added. So there is now one definition and both callers use it.
 *
 * Written against a minimal builder interface so the predicates can be tested
 * without a database anywhere near them.
 */

import { CLOSED_STATUSES, CONTACTED_ACTIVE_STATUSES } from "./constants";
import { dublinDate } from "./dates";

export const DUE_BUCKETS = ["today", "overdue", "live", "cold", "unscheduled"] as const;
export type DueBucket = (typeof DUE_BUCKETS)[number];

/** How each bucket reads in the header line and on a filter chip. */
export const DUE_BUCKET_LABELS: Record<DueBucket, string> = {
  today: "follow-up due today",
  overdue: "follow-up overdue (within 7 days)",
  live: "follow-up due or overdue",
  cold: "gone cold (7+ days overdue)",
  unscheduled: "contacted, but with no next step booked",
};

/** Anything not in the list is no bucket at all, not a broken one. */
export function resolveDueBucket(raw: string | null | undefined): DueBucket | null {
  return (DUE_BUCKETS as readonly string[]).includes(raw ?? "")
    ? (raw as DueBucket)
    : null;
}

/**
 * The subset of the PostgREST builder these filters use. Narrow on purpose:
 * anything wider would let a caller's mistake compile.
 */
export type FilterableQuery<Q> = {
  eq: (column: string, value: unknown) => Q;
  lt: (column: string, value: unknown) => Q;
  lte: (column: string, value: unknown) => Q;
  gte: (column: string, value: unknown) => Q;
  is: (column: string, value: unknown) => Q;
  in: (column: string, values: readonly unknown[]) => Q;
  not: (column: string, operator: string, value: unknown) => Q;
};

/** The closed/archived set, in the shape PostgREST's `not in` wants. */
export function closedStatusFilter(): string {
  return `(${CLOSED_STATUSES.map((s) => `"${s}"`).join(",")})`;
}

/**
 * How many days late a chase can be before it stops being auto-chased and
 * becomes "gone cold". Shared so the bucket boundaries here match the
 * autopilot's own window.
 */
export const COLD_AFTER_DAYS = 7;

/**
 * Narrows a prospects query to one follow-up bucket.
 *
 * Returns the query unchanged when there is no bucket, so a caller can apply
 * it unconditionally.
 *
 * @param today Irish calendar date, injectable so the boundaries are testable.
 */
export function applyDueBucket<Q extends FilterableQuery<Q>>(
  query: Q,
  due: DueBucket | null,
  today: string = dublinDate(),
  coldBefore: string = dublinDate(-COLD_AFTER_DAYS)
): Q {
  if (!due) return query;

  let q = query;
  if (due === "today") {
    q = q.eq("next_follow_up_at", today);
  } else if (due === "overdue") {
    q = q.lt("next_follow_up_at", today).gte("next_follow_up_at", coldBefore);
  } else if (due === "live") {
    q = q.lte("next_follow_up_at", today).gte("next_follow_up_at", coldBefore);
  } else if (due === "cold") {
    q = q.lt("next_follow_up_at", coldBefore);
  } else if (due === "unscheduled") {
    // The leak bucket: already spoken to, nothing booked, so invisible to
    // every other chase surface. This is the one the export forgot.
    q = q.in("status", CONTACTED_ACTIVE_STATUSES).is("next_follow_up_at", null);
  }

  // A closed or archived lead is never part of a chase list, whichever bucket
  // it is. (The unscheduled bucket already restricts status to active ones, so
  // this is a no-op there — applied anyway so the rule has one home.)
  return q.not("status", "in", closedStatusFilter());
}
