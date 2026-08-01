/**
 * What the DM list is allowed to claim is still waiting.
 *
 * THE BUG. The page rendered up to 40 ready DMs and then said:
 *
 *   "· 260 more still to DM — mark these sent and the next batch loads"
 *
 * counting every un-DM'd prospect with a profile link. But only a prospect
 * with a WRITTEN DRAFT can ever appear on this page — the other 240 have a
 * link and no message, and no amount of marking sent will load them. So the
 * number was inflated by an order of magnitude and the promise attached to it
 * was false: work the list down and it does not refill, it flips to "you've
 * DM'd everyone who has a message ready".
 *
 * The page already knew the difference — its own empty state distinguishes
 * "nobody left" from "plenty left, none drafted" — the header just conflated
 * the two. That is the "count that doesn't match what its click-through
 * shows" shape, on the number Jude uses to decide whether he is finished.
 *
 * These are two genuinely different populations and they now get two
 * different sentences:
 *   readyBeyond   — drafted, ready, just past the 40 on screen. Marking sent
 *                   really does load these.
 *   awaitingDraft — has a profile link, has no message written yet. These
 *                   need the Studio or an overnight run, not more DMing.
 */

export type DmQueueSummary = {
  /** Drafted and ready, beyond the ones on screen. */
  readyBeyond: number;
  /** Has a profile link but no DM written yet. */
  awaitingDraft: number;
  /**
   * True when either number is a floor rather than an exact count, because a
   * fetch limit was hit. The UI renders "+" so a capped number is never read
   * as the whole truth.
   */
  approximate: boolean;
};

export function summariseDmQueue(input: {
  /** Items rendered on this page. */
  shown: number;
  /** Candidates found to have a usable draft (within the lookup window). */
  ready: number;
  /** Un-DM'd prospects with at least one profile link (within the pool). */
  available: number;
  /** available was truncated before drafts were looked up. */
  lookupCapped: boolean;
  /** The prospect pool itself hit its fetch limit. */
  poolMaxedOut: boolean;
}): DmQueueSummary {
  const readyBeyond = Math.max(0, input.ready - input.shown);
  // Everything not accounted for by a draft needs one written. Clamped at
  // zero: `ready` is counted inside the lookup window and `available` spans
  // the whole pool, so the subtraction is only meaningful downward.
  const awaitingDraft = Math.max(0, input.available - input.ready);
  return {
    readyBeyond,
    awaitingDraft,
    // Either cap means there may be more of BOTH kinds below the window.
    approximate: input.lookupCapped || input.poolMaxedOut,
  };
}
