import { describe, it, expect } from "vitest";
import { PROOF, PROOF_SENTENCE } from "@/lib/proof";

/**
 * The proof point, guarded.
 *
 * These are the most valuable sentences AutomateIQ owns, and they appear on the
 * homepage, the booking page, the systems page AND inside the outreach prompts.
 * The failure this pins is drift: a prospect who reads "500+ jobs" in a cold
 * email and a different number on the site stops believing both, and the whole
 * value of a proof point is that it is believed.
 *
 * It also pins the shape of the labels, because they are rendered directly.
 */

describe("PROOF", () => {
  it("carries the real figures", () => {
    expect(PROOF.jobsProcessed).toBe(500);
    expect(PROOF.revenueLiftPct).toBe(25);
    expect(PROOF.client).toBe("ClearWater Ireland");
  });

  it("labels agree with the numbers they are derived from", () => {
    // The label is what a visitor reads; the number is what everything else
    // computes from. They must not be edited apart.
    expect(PROOF.jobsProcessedLabel).toContain(String(PROOF.jobsProcessed));
    expect(PROOF.revenueLiftLabel).toContain(String(PROOF.revenueLiftPct));
  });

  it("the jobs figure is a floor, not an exact count", () => {
    // "500+" is claimable indefinitely as the number grows. A bare "500" would
    // be wrong the moment job 501 is processed.
    expect(PROOF.jobsProcessedLabel).toMatch(/\+$/);
  });

  it("the revenue lift states its window, so it can never be read as ongoing", () => {
    // "+25%" alone would imply a permanent rate. The window is what makes it
    // defensible in a sales call.
    expect(PROOF.revenueLiftWindow.length).toBeGreaterThan(0);
    expect(PROOF_SENTENCE).toContain(PROOF.revenueLiftWindow);
  });

  it("the one-line sentence contains both figures and the client", () => {
    expect(PROOF_SENTENCE).toContain(PROOF.jobsProcessedLabel);
    expect(PROOF_SENTENCE).toContain(PROOF.revenueLiftLabel);
    expect(PROOF_SENTENCE).toContain(PROOF.client);
  });

  it("describes the build without vague filler", () => {
    expect(PROOF.build.length).toBeGreaterThanOrEqual(4);
    for (const line of PROOF.build) {
      expect(line.length).toBeGreaterThan(20);
      // The words that made the old proof copy worthless.
      expect(line.toLowerCase()).not.toMatch(/\b(solution|synerg|cutting.edge|world.class)\b/);
    }
  });

  it("contains no projection or hedge language", () => {
    // The rule this file is written under: nothing here that Jude cannot stand
    // over in a sales call. "Up to", "as much as" and "projected" are how a
    // real number turns into a claim someone has to walk back.
    const all = JSON.stringify(PROOF) + PROOF_SENTENCE;
    expect(all.toLowerCase()).not.toMatch(/\b(up to|as much as|projected|estimated|potential)\b/);
  });

  it("links to the client so the claim is checkable", () => {
    expect(PROOF.clientUrl).toMatch(/^https:\/\//);
  });
});
