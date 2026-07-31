import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The missed-calls calculator's arithmetic.
 *
 * This is the number Jude quotes in a sales conversation, so it has to survive
 * being checked on the back of an envelope. It did not: the copy said "a third
 * of those ring back", the constant was 0.33, and the line explaining the sum
 * multiplied by a SEPARATELY hard-coded 0.67. The workings read
 *
 *     9.0 unanswered → 6.0 genuinely gone → 2.4 jobs a week × €450
 *
 * while the headline said €1,085. Anyone who multiplied got €1,080 and caught
 * the tool contradicting itself — the "a count that doesn't match what its
 * click-through shows" class, in the one tool whose whole job is to be
 * believed.
 */

const SRC = readFileSync(
  path.resolve(import.meta.dirname, "..", "..", "app", "freetools", "missed-calls", "calculator.tsx"),
  "utf8"
);

/** The engine, mirrored from the component so the arithmetic is testable. */
function compute(v: { enquiries: number; missedPct: number; jobValue: number; closeRate: number }) {
  const missedPerWeek = v.enquiries * (v.missedPct / 100);
  const RECAPTURED = 1 / 3;
  const trulyLost = missedPerWeek * (1 - RECAPTURED);
  const jobsLostWeek = trulyLost * (v.closeRate / 100);
  const weekly = jobsLostWeek * v.jobValue;
  return { missedPerWeek, trulyLost, jobsLostWeek, weekly, yearly: weekly * 52 };
}

describe("the workings agree with the headline", () => {
  it("states the weekly figure inside the explanation, not just above it", () => {
    // Both the big number and the "how this is worked out" line now render the
    // same result.weekly, so they cannot drift apart no matter the inputs.
    const workings = SRC.slice(SRC.indexOf("How this is worked out"));
    expect(workings).toContain("money(result.weekly)");
  });

  it("derives 'genuinely gone' from the same constant, not a duplicate literal", () => {
    // The bug was a hard-coded 0.67 in the JSX beside a 0.33 in the maths.
    expect(SRC).not.toMatch(/missedPerWeek \* 0\.67/);
    expect(SRC).toContain("result.trulyLost");
  });

  it("uses exactly a third, because that is what the copy says", () => {
    expect(SRC).toMatch(/RECAPTURED = 1 \/ 3/);
    expect(SRC).toContain("A third of those ring back");
  });
});

describe("the arithmetic itself", () => {
  it("matches the worked example on the page", () => {
    const r = compute({ enquiries: 20, missedPct: 45, jobValue: 450, closeRate: 40 });
    expect(r.missedPerWeek).toBeCloseTo(9, 5);
    expect(r.trulyLost).toBeCloseTo(6, 5);
    expect(r.jobsLostWeek).toBeCloseTo(2.4, 5);
    expect(Math.round(r.weekly)).toBe(1080);
  });

  it("never returns a negative or non-finite figure", () => {
    for (const v of [
      { enquiries: 0, missedPct: 0, jobValue: 0, closeRate: 0 },
      { enquiries: 1, missedPct: 100, jobValue: 1, closeRate: 100 },
      { enquiries: 200, missedPct: 90, jobValue: 5000, closeRate: 100 },
    ]) {
      const r = compute(v);
      expect(Number.isFinite(r.weekly)).toBe(true);
      expect(r.weekly).toBeGreaterThanOrEqual(0);
    }
  });

  it("stays conservative — never claims more is lost than was missed", () => {
    for (let e = 1; e <= 100; e += 7) {
      const r = compute({ enquiries: e, missedPct: 100, jobValue: 500, closeRate: 100 });
      expect(r.jobsLostWeek).toBeLessThanOrEqual(r.missedPerWeek);
      expect(r.trulyLost).toBeLessThan(r.missedPerWeek);
    }
  });

  it("scales the year off the week, with no second assumption", () => {
    const r = compute({ enquiries: 30, missedPct: 50, jobValue: 600, closeRate: 45 });
    expect(r.yearly).toBeCloseTo(r.weekly * 52, 5);
  });
});
