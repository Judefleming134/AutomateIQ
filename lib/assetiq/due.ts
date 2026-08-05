/**
 * AssetIQ's one real calculation: what has gone past, and what is about to.
 *
 * Kept pure and out of the page for the reason CLAUDE.md keeps naming — "a
 * count that doesn't match what its click-through shows" is a recurring bug
 * class here, and the only way the headline number and the list underneath it
 * cannot disagree is if BOTH come from this function.
 *
 * DATES ARE DUBLIN, NOT UTC. A CVRT due "today" is due on the Irish calendar
 * day, and `new Date().toISOString().slice(0,10)` is the previous day for the
 * hour either side of midnight in summer — which is exactly when an overnight
 * job would run and mark something overdue a day early, or a day late.
 * Comparison is on the plain `YYYY-MM-DD` string: both sides are calendar
 * dates with no time and no zone, so string order IS date order and no
 * Date object is constructed to get it wrong.
 */

export type DueBucket = "overdue" | "soon" | "later" | "none";

/** Anything inside this many days counts as "soon". */
export const SOON_DAYS = 30;

export type DueAsset = {
  next_due_date: string | null;
  status: string;
};

/**
 * Which bucket an asset falls in, relative to a Dublin `today`.
 *
 * A RETIRED asset is always "none". It is off the road or in a skip, and a
 * retired van whose CVRT lapsed is not a job anyone has to do — leaving it in
 * the overdue count would train people to ignore the number, which is the one
 * failure this product cannot survive.
 */
export function dueBucket(
  asset: DueAsset,
  today: string,
  soonDays = SOON_DAYS
): DueBucket {
  if (asset.status === "retired") return "none";
  if (!asset.next_due_date) return "none";
  if (asset.next_due_date < today) return "overdue";
  if (asset.next_due_date <= addDays(today, soonDays)) return "soon";
  return "later";
}

/** `YYYY-MM-DD` + n calendar days, without touching local time. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `today` to the due date. Negative when it has gone past. */
export function daysUntil(date: string, today: string): number {
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${date}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * The due list and the counts, from ONE pass over ONE array.
 *
 * Sorted soonest-first with the overdue at the top, which is the order the
 * work actually needs doing in. Assets with no date sort last and are never
 * counted.
 */
export function summariseDue<T extends DueAsset>(
  assets: T[],
  today: string,
  soonDays = SOON_DAYS
): { overdue: T[]; soon: T[]; overdueCount: number; soonCount: number } {
  const overdue: T[] = [];
  const soon: T[] = [];
  for (const a of assets) {
    const bucket = dueBucket(a, today, soonDays);
    if (bucket === "overdue") overdue.push(a);
    else if (bucket === "soon") soon.push(a);
  }
  const bySoonest = (x: T, y: T) =>
    (x.next_due_date ?? "9999-12-31").localeCompare(y.next_due_date ?? "9999-12-31");
  overdue.sort(bySoonest);
  soon.sort(bySoonest);
  // The counts ARE the lists' lengths. There is no second query to disagree.
  return { overdue, soon, overdueCount: overdue.length, soonCount: soon.length };
}

/** "€1,240" from integer cents. Null stays null rather than becoming "€0". */
export function euroFromCents(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined) return null;
  return `€${(cents / 100).toLocaleString("en-IE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * "€1,240.50" / "1240.50" / "1,240" → 124050 cents, or null.
 *
 * Deliberately forgiving of what a person types into a cost box, and
 * deliberately NOT forgiving of nonsense: anything that does not parse comes
 * back null rather than 0, so a typo leaves the field empty instead of
 * silently recording an asset that cost nothing.
 */
export function centsFromInput(raw: string): number | null {
  const cleaned = raw.replace(/[€,\s]/g, "").trim();
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}
