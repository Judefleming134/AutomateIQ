import { describe, it, expect } from "vitest";
import { resolveChaseDate, addDays, dublinDate } from "./dates";

/**
 * `resolveChaseDate(existing, today, fallbackDays)` answered two different
 * questions in one call.
 *
 *     if (looksLikeDate && current > today) return { date: current, kept: true };
 *     return { date: dublinDate(fallbackDays), kept: false };   // ← not `today`
 *
 * The comparison used the `today` it was given. The fallback ignored it and
 * counted forward from Dublin's real clock. With the default argument the two
 * agree, so production was right — but the parameter exists precisely so a
 * caller can pin the day, and half-honouring it is the kind of seam that goes
 * wrong quietly later.
 *
 * It was not quiet. Ireland is UTC+1 in summer, so between 23:00 UTC and
 * midnight Dublin has already rolled over to tomorrow. In that hour every test
 * pinning `today` to a fixed date got the cadence counted from a day later:
 *
 *   nine tests across status-chase-date.test.ts and studio-outcome.test.ts,
 *   red for one hour a night, every night, from late March to late October,
 *   all off by exactly one day.
 *
 * On a repo whose first rule is "the build must be green before anything
 * ships", a suite that is red for an hour a night is worse than the off-by-one
 * — it is an hour a night in which a real failure is indistinguishable from
 * the usual one.
 *
 * Both halves now use the `today` they were given. `addDays` does the
 * arithmetic in UTC on the bare date, never on a local midnight, because
 * adding days to a local midnight produces the same calendar day twice a year
 * when the clocks change.
 */

describe("the fallback is counted from the today it was given", () => {
  it.each([1, 3, 4, 7, 90])("+%i days lands on the calendar day it should", (n) => {
    expect(resolveChaseDate(null, "2026-08-05", n).date).toBe(addDays("2026-08-05", n));
  });

  it("the exact hour that broke it", () => {
    // 23:30 UTC on 5 August is 00:30 on 6 August in Dublin. `today` says the
    // 5th; the OLD fallback said 8th for a +3 cadence, the caller's own date
    // said 8th... from the 6th. One day out, silently.
    const today = "2026-08-05";
    const dublinHasRolledOver = "2026-08-06";
    expect(addDays(today, 3)).toBe("2026-08-08");
    expect(addDays(dublinHasRolledOver, 3)).toBe("2026-08-09"); // what OLD returned
    expect(resolveChaseDate(null, today, 3).date).toBe("2026-08-08");
  });

  it("a spent date reschedules from `today` too, not from Dublin's clock", () => {
    const chase = resolveChaseDate("2026-08-01", "2026-08-05", 3);
    expect(chase.kept).toBe(false);
    expect(chase.date).toBe("2026-08-08");
  });

  it("and so does a malformed one", () => {
    for (const junk of ["", "soon", "next week", "  ", "2026/08/26"]) {
      const chase = resolveChaseDate(junk, "2026-08-05", 3);
      expect(chase.kept, junk).toBe(false);
      expect(chase.date, junk).toBe("2026-08-08");
    }
  });
});

describe("nothing about the KEEP half changed", () => {
  it("a deliberate future date still wins", () => {
    expect(resolveChaseDate("2026-08-26", "2026-08-05", 3)).toEqual({
      date: "2026-08-26",
      kept: true,
    });
  });

  it("today is still not the future", () => {
    expect(resolveChaseDate("2026-08-05", "2026-08-05", 3).kept).toBe(false);
  });

  it("a timestamp is still truncated to its date", () => {
    expect(resolveChaseDate("2026-08-26T09:30:00.000Z", "2026-08-05", 3)).toEqual({
      date: "2026-08-26",
      kept: true,
    });
  });
});

describe("the default argument is unchanged — production behaviour is identical", () => {
  it("with no `today`, both halves use Dublin, exactly as before", () => {
    const today = dublinDate();
    expect(resolveChaseDate(null, undefined, 3).date).toBe(dublinDate(3));
    expect(resolveChaseDate(null, undefined, 3).date).toBe(addDays(today, 3));
  });
});

describe("addDays stays on the calendar", () => {
  it("crosses month and year ends", () => {
    expect(addDays("2026-08-30", 3)).toBe("2026-09-02");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29"); // leap year
  });

  it("survives both DST changes, which a local-midnight Date would not", () => {
    // Ireland springs forward on 29 March 2026 and back on 25 October 2026.
    // `new Date("2026-03-28")` in a UTC+1 zone is 28 Mar 01:00 local; adding a
    // day by local hours around the transition can land back on the same date.
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
  });

  it("goes backwards too", () => {
    expect(addDays("2026-08-05", -4)).toBe("2026-08-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("falls back to Dublin for something that isn't a date", () => {
    // Never throws into a status change: the caller is mid-write.
    for (const junk of ["", "soon", "2026/08/26", "2026-13-45"]) {
      expect(addDays(junk, 3), junk).toBe(dublinDate(3));
    }
  });
});
