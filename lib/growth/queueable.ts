/**
 * ONE definition of "may this draft be auto-queued for the 07:00 send?".
 *
 * Deliberately NOT `server-only`. The rule has to be readable from a client
 * component — the Email autopilot panel pre-ticks exactly the drafts the 07:00
 * run would send, so Jude's review and the cron's behaviour are the same
 * decision shown twice. `lib/growth/autopilot.ts` starts with `import
 * "server-only"`, so the panel could only ever take a TYPE import from it, and
 * the rule ended up hand-copied into the panel instead — twice, once for the
 * count on the buttons and once for each row's `defaultChecked`.
 *
 * Three copies of one rule, and `isAutoQueueable`'s own doc comment said it was
 * exported "so the rule lives in one place rather than inline in the caller" —
 * a promise the code did not keep.
 *
 * They agree today; this is hardening, not a live bug. It is worth doing
 * because the drift is silent and the cost is specific: if the panel's copy and
 * the cron's rule ever diverge, the pre-ticked boxes stop matching what the
 * morning run actually sends. Jude reviews the panel, sees twenty ticked,
 * trusts it — and a different twenty go out. The same shape (one rule,
 * hand-copied across a boundary that stopped it being shared) is what made the
 * spam-complaint hold unreachable for weeks: the webhook wrote "SPAM COMPLAINT"
 * and the ramp searched for "COMPLAINED".
 *
 * THE RULE ITSELF IS UNCHANGED — moved, not edited:
 *
 *   queued     already on the morning run; queueing it again double-counts it
 *   broken     a leftover [placeholder] or an invented sender name; the send
 *              gate would refuse it anyway, so never pre-tick it
 *   research-stale
 *              the research changed under the draft, so the angle is out of
 *              date. Genuinely worth a rewrite before it goes.
 *
 * AGE-staleness is deliberately NOT disqualifying: a cold first-touch intro
 * doesn't rot, and excluding it starved the run whenever a batch of drafts
 * crossed the 5-day mark together.
 */

/**
 * The three fields the decision reads. Structural, so both the full
 * `AutopilotCandidate` and any `Pick` of it satisfy it without importing the
 * server-only module.
 */
export type QueueableCandidate = {
  queued: boolean;
  broken: string | null;
  staleKind: "research" | "age" | null;
};

/** Whether a candidate can be auto-queued for the 07:00 send. */
export function isAutoQueueable(c: QueueableCandidate): boolean {
  return !c.queued && !c.broken && c.staleKind !== "research";
}
