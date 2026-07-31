/**
 * The proof point — one source of truth.
 *
 * These are real figures from the ClearWater Ireland build, and they are the
 * most valuable sentences AutomateIQ owns: the difference between "we can
 * automate your business" and "we did, here is what happened."
 *
 * They live here, once, because a number that appears on the homepage, the
 * booking page, the systems page AND inside the outreach prompts will
 * eventually disagree with itself if each surface keeps its own copy. A
 * prospect who reads "500 jobs" in an email and "300 jobs" on the site stops
 * believing both. Update the number here and every surface follows.
 *
 * RULE: nothing goes in this file that Jude cannot stand over in a sales call.
 * No projections, no "up to", no rounded-up estimates. If a figure would need a
 * caveat spoken aloud, it does not belong here.
 */

export const PROOF = {
  client: "ClearWater Ireland",
  clientUrl: "https://clearwaterireland.ie",

  /** Jobs processed through the system since launch. */
  jobsProcessed: 500,
  jobsProcessedLabel: "500+",

  /** Revenue increase in the first month after the system went live. */
  revenueLiftPct: 25,
  revenueLiftLabel: "+25%",
  revenueLiftWindow: "in the first month",

  /** What was actually built — the architecture, in one line each. */
  build: [
    "A customer portal for quotes, jobs and payments",
    "A separate installer and staff portal for the work in front of them",
    "An admin control room over both, with changes flowing straight through",
    "One database underneath, so nothing is stored or typed twice",
    "Automated tests running every day, catching bugs before users meet them",
  ],
} as const;

/**
 * The proof point as one sentence, for prompts and tight spaces.
 * Deliberately plain: the numbers do the work, not the adjectives.
 */
export const PROOF_SENTENCE =
  `The system built for ${PROOF.client} has processed ${PROOF.jobsProcessedLabel} jobs ` +
  `and lifted their revenue ${PROOF.revenueLiftLabel} ${PROOF.revenueLiftWindow} after launch.`;
