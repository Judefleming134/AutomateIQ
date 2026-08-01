/**
 * Finding prospects who are genuinely still to DM.
 *
 * THE BUG, for the third time in this file's history. The DM list fetches
 * prospects by lead score and then drops the ones already messaged. Fetching a
 * FIXED slice first means the filter can only ever reorder what that slice
 * happens to contain — so as Jude works through his best leads, the slice fills
 * up with people he has already DM'd, the list starves, and the page says
 * "No DMs ready — research some prospects" while hundreds of researched,
 * drafted, un-DM'd prospects sit just below the score cut.
 *
 * That was fixed at 200 by raising the slice to 600. Which does not fix it: it
 * moves the wall. At 600 DMs sent — a few months of Mondays — the page starves
 * again, and tells him to go and do the one thing that will not help.
 *
 * The fix is to keep reading DOWN the score order until enough genuinely
 * un-DM'd prospects have been found, rather than hoping one slice contains
 * some. Bounded, so it can never become an unbounded scan of the table.
 *
 * Pure and injectable: the paging decision is the part that goes wrong, so it
 * is testable without a database.
 */

/** Prospects per page. Matches the old single-slice size, so one page is the
 *  common case and costs exactly what it did before. */
export const POOL_PAGE = 600;

/**
 * How many pages deep to go before giving up.
 *
 * A ceiling rather than a full scan: at 600 a page this reads 6,000 prospects
 * in score order, which is past the ~5,000 soft cap the Prospects page warns
 * about. If somebody genuinely has more than that and has DM'd all of them,
 * the page says so honestly instead of scanning forever.
 */
export const MAX_POOL_PAGES = 10;

export type DmPoolResult<T> = {
  /** Un-DM'd prospects, in the order the pages returned them (best score first). */
  available: T[];
  /** How many rows were read to find them. */
  scanned: number;
  /**
   * True when the whole candidate list was read to the end — so "nobody left
   * to DM" is a fact rather than an artefact of where we stopped looking.
   */
  exhausted: boolean;
};

/**
 * Reads down the score-ordered candidate list until `need` un-DM'd prospects
 * are found, the list runs out, or the page ceiling is reached.
 *
 * @param fetchPage inclusive range, PostgREST style.
 * @param alreadyDone ids already messaged — the filter that must run against
 *   the whole list rather than one slice of it.
 */
export async function collectDmPool<T extends { id: string }>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  alreadyDone: ReadonlySet<string>,
  opts: { need: number; pageSize?: number; maxPages?: number } = { need: 150 }
): Promise<DmPoolResult<T>> {
  const pageSize = opts.pageSize ?? POOL_PAGE;
  const maxPages = opts.maxPages ?? MAX_POOL_PAGES;
  const available: T[] = [];
  let scanned = 0;
  let exhausted = false;

  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize;
    const rows = await fetchPage(from, from + pageSize - 1);
    scanned += rows.length;

    for (const row of rows) {
      if (!alreadyDone.has(row.id)) available.push(row);
    }

    // A short page is the end of the list. This is the ONLY thing that makes
    // "you've DM'd everyone" true rather than "we stopped looking here".
    if (rows.length < pageSize) {
      exhausted = true;
      break;
    }
    // Enough to fill the screen and the counts behind it. Stopping early is
    // what keeps the common case exactly as cheap as the single slice was.
    if (available.length >= opts.need) break;
  }

  return { available, scanned, exhausted };
}

/**
 * Which of the three empty states applies.
 *
 * These are genuinely different situations and telling them apart is the whole
 * point — "go and research more prospects" is the right advice for one of them
 * and actively wrong for the other two.
 */
export type DmEmptyReason = "no-candidates" | "awaiting-drafts" | "scan-limit";

export function dmEmptyReason(input: {
  /** Un-DM'd prospects with a profile link that were found. */
  available: number;
  /** Of those, how many have a usable draft. */
  ready: number;
  /** The candidate list was read to the end. */
  exhausted: boolean;
}): DmEmptyReason {
  // Found people, none of them have a message written. Needs the Studio or an
  // overnight run — not more prospects.
  if (input.available > input.ready) return "awaiting-drafts";
  // Nobody left, and we know that for certain because we reached the end.
  if (input.exhausted) return "no-candidates";
  // We stopped looking before the end. Saying "research more prospects" here
  // would be the old bug's advice: there are more below where we stopped.
  return "scan-limit";
}
