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

/**
 * "Has a profile link on at least one social platform" — the DM list's
 * population, as a filter the prospects page and the CSV export can both
 * apply.
 *
 * Defined here rather than inline for the same reason the due buckets are: the
 * DM list's empty states quote a COUNT of these prospects and link to the list,
 * and the export button on that list claims to export what you are looking at.
 * Three places, one predicate.
 *
 * The exact OR the DM list itself uses, so "prospects with a profile link"
 * means the same thing on both pages.
 */
export const SOCIAL_LINK_FILTER =
  "instagram_url.not.is.null,facebook_url.not.is.null,linkedin_url.not.is.null";

/** Narrows to prospects reachable on at least one social platform. */
export function applySocialOnly<Q extends { or: (f: string) => Q }>(
  query: Q,
  socialOnly: boolean
): Q {
  return socialOnly ? query.or(SOCIAL_LINK_FILTER) : query;
}

/* ------------------------------------------------------------------ */
/* Stage buckets — a group of statuses, not one                        */
/* ------------------------------------------------------------------ */

/**
 * "Still to research" is TWO statuses, not one.
 *
 * The campaigns page shows a per-campaign to-do column: N ready, N approved,
 * N to research, N failed research. Three of those are links to a
 * single-status filter. "N to research" was plain text — the only tally on
 * that column you cannot click, and the most actionable one, because it is
 * what feeds the research queue that makes every other number possible.
 *
 * It was left unlinked on purpose. The page's own comment says the tallies
 * are tracked separately "because each is a click-through to a single-status
 * filter — the number shown must equal the rows the click lands on, or the
 * page looks broken". `to research` spans `new` AND `researching`, and no
 * single-status filter could match it. So rather than link it to something
 * that would show a different number, it was left as text.
 *
 * This gives it a filter that matches it exactly. Same shape as the due
 * buckets above: defined once, applied by both the page and the CSV export,
 * so the count, the list and the download can never disagree.
 */
export const STAGE_BUCKETS = ["to_research", "ready_to_send"] as const;
export type StageBucket = (typeof STAGE_BUCKETS)[number];

/**
 * The statuses each bucket covers. The single source for "which statuses".
 *
 * `ready_to_send` was added for the same reason `to_research` was, and against
 * the same defect. Jarvis's "What matters right now" panel counts researched
 * prospects with drafts ready and no first touch — `research_complete` OR
 * `outreach_ready` — and its click-through pointed at `?sort=score`, which is
 * NO FILTER AT ALL. So a count of forty landed on the entire database, sorted.
 *
 * That is precisely what the note above this section says must never happen:
 * "the number shown must equal the rows the click lands on, or the page looks
 * broken". Two statuses, no single-status filter that matched, and the link
 * quietly gave up and pointed at everything.
 */
export const STAGE_BUCKET_STATUSES: Record<StageBucket, readonly string[]> = {
  to_research: ["new", "researching"],
  ready_to_send: ["research_complete", "outreach_ready"],
};

export const STAGE_BUCKET_LABELS: Record<StageBucket, string> = {
  to_research: "still to research",
  ready_to_send: "researched, drafts ready",
};

export function resolveStageBucket(raw: string | null | undefined): StageBucket | null {
  return (STAGE_BUCKETS as readonly string[]).includes(raw ?? "")
    ? (raw as StageBucket)
    : null;
}

/**
 * Narrows a prospects query to one stage bucket. Returns it unchanged when
 * there is no bucket, so a caller can apply it unconditionally.
 */
export function applyStageBucket<Q extends FilterableQuery<Q>>(
  query: Q,
  stage: StageBucket | null
): Q {
  if (!stage) return query;
  return query.in("status", STAGE_BUCKET_STATUSES[stage]);
}
