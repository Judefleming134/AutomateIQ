import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  dueBucket,
  summariseDue,
  addDays,
  daysUntil,
  euroFromCents,
  centsFromInput,
  SOON_DAYS,
} from "./due";

/**
 * AssetIQ's one real calculation.
 *
 * The product is a list of dates, so everything that can go wrong with it goes
 * wrong in this file, and every one of the failure modes is on CLAUDE.md's
 * recurring list:
 *
 *   * A COUNT THAT DOESN'T MATCH ITS CLICK-THROUGH. "3 overdue" over a list
 *     showing two is the fastest way to make the number stop being believed,
 *     and the number is the entire product. So the counts ARE the lists'
 *     lengths, from one pass over one array — there is no second query that
 *     could disagree.
 *   * DUBLIN, NOT UTC. `new Date().toISOString().slice(0,10)` is yesterday for
 *     the hour either side of midnight in Irish summer time — exactly when an
 *     overnight job runs. A CVRT is due on the Irish calendar day.
 *   * A NUMBER THAT QUIETLY COUNTS FOUR OF NINETEEN. A "total value" summing
 *     only the assets that happen to have a price, presented as the value of
 *     everything.
 */

const TODAY = "2026-08-05";

const asset = (over: Partial<{ next_due_date: string | null; status: string }> = {}) => ({
  next_due_date: null,
  status: "in_service",
  ...over,
});

describe("which bucket a date falls in", () => {
  it.each([
    ["yesterday", "2026-08-04", "overdue"],
    ["today", "2026-08-05", "soon"],
    ["tomorrow", "2026-08-06", "soon"],
    ["the last day of the window", "2026-09-04", "soon"],
    ["one day past the window", "2026-09-05", "later"],
    ["next year", "2027-01-01", "later"],
  ])("%s → %s", (_label, date, expected) => {
    expect(dueBucket(asset({ next_due_date: date }), TODAY)).toBe(expected);
  });

  it("today is DUE, not overdue", () => {
    // A CVRT that expires today has not expired yet. Calling it overdue is a
    // small lie that makes the overdue count wrong for every asset on its due
    // date — which is the day someone is most likely to look.
    expect(dueBucket(asset({ next_due_date: TODAY }), TODAY)).toBe("soon");
  });

  it("no date is 'none', not overdue", () => {
    // A wheelbarrow needs no certificate. Treating "nothing due" as a problem
    // is how a register gets filled with fake dates to shut it up.
    expect(dueBucket(asset({ next_due_date: null }), TODAY)).toBe("none");
  });

  it("a RETIRED asset is never overdue, whatever its date", () => {
    // A van in a scrapyard with a lapsed CVRT is not a job anyone has to do.
    // Leaving it in the count trains people to ignore the number, and then the
    // real ones get ignored too.
    expect(dueBucket({ next_due_date: "2020-01-01", status: "retired" }, TODAY)).toBe("none");
    expect(dueBucket({ next_due_date: "2026-08-10", status: "retired" }, TODAY)).toBe("none");
    // In for repair is NOT retired — it is coming back, and its dates still run.
    expect(dueBucket({ next_due_date: "2020-01-01", status: "in_repair" }, TODAY)).toBe("overdue");
  });
});

describe("the count and the list cannot disagree", () => {
  const fleet = [
    asset({ next_due_date: "2026-07-01" }), // overdue
    asset({ next_due_date: "2026-08-04" }), // overdue
    asset({ next_due_date: "2026-08-05" }), // due today → soon
    asset({ next_due_date: "2026-08-30" }), // soon
    asset({ next_due_date: "2027-03-01" }), // later
    asset({ next_due_date: null }), // none
    { next_due_date: "2019-01-01", status: "retired" }, // none
  ];

  it("the numbers are the lengths of the lists shown underneath them", () => {
    const s = summariseDue(fleet, TODAY);
    expect(s.overdueCount).toBe(s.overdue.length);
    expect(s.soonCount).toBe(s.soon.length);
    expect(s.overdueCount).toBe(2);
    expect(s.soonCount).toBe(2);
  });

  it("every asset lands in exactly one place", () => {
    const s = summariseDue(fleet, TODAY);
    const listed = [...s.overdue, ...s.soon];
    expect(new Set(listed).size).toBe(listed.length);
    const buckets = fleet.map((a) => dueBucket(a, TODAY));
    expect(buckets.filter((b) => b === "overdue")).toHaveLength(s.overdueCount);
    expect(buckets.filter((b) => b === "soon")).toHaveLength(s.soonCount);
  });

  it("orders the work the way it has to be done — soonest first", () => {
    const s = summariseDue(fleet, TODAY);
    expect(s.overdue.map((a) => a.next_due_date)).toEqual(["2026-07-01", "2026-08-04"]);
    expect(s.soon.map((a) => a.next_due_date)).toEqual(["2026-08-05", "2026-08-30"]);
  });

  it("an empty fleet is zero and empty, not a crash", () => {
    const s = summariseDue([], TODAY);
    expect(s).toEqual({ overdue: [], soon: [], overdueCount: 0, soonCount: 0 });
  });

  it("retiring an asset takes it off the list AND out of the count together", () => {
    const before = summariseDue([asset({ next_due_date: "2020-01-01" })], TODAY);
    const after = summariseDue([{ next_due_date: "2020-01-01", status: "retired" }], TODAY);
    expect(before.overdueCount).toBe(1);
    expect(after.overdueCount).toBe(0);
    expect(after.overdue).toEqual([]);
  });
});

describe("date arithmetic that does not drift", () => {
  it("adds days across a month and a year boundary", () => {
    expect(addDays("2026-08-05", 30)).toBe("2026-09-04");
    expect(addDays("2026-12-20", 30)).toBe("2027-01-19");
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
  });

  it("survives a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
  });

  it("counts days both directions", () => {
    expect(daysUntil("2026-08-05", TODAY)).toBe(0);
    expect(daysUntil("2026-08-12", TODAY)).toBe(7);
    expect(daysUntil("2026-08-01", TODAY)).toBe(-4);
  });

  it("is unaffected by the machine's timezone", () => {
    // The whole reason both sides are plain YYYY-MM-DD strings: no Date object
    // is constructed from a local-time string anywhere in the comparison, so
    // there is nothing for a TZ to shift. Irish summer time is UTC+1, which is
    // where the off-by-one lives.
    expect(dueBucket(asset({ next_due_date: "2026-08-05" }), "2026-08-05")).toBe("soon");
    expect(dueBucket(asset({ next_due_date: "2026-08-05" }), "2026-08-06")).toBe("overdue");
  });

  it("the window is the one the page advertises", () => {
    expect(SOON_DAYS).toBe(30);
  });
});

describe("money in and money out", () => {
  it.each([
    ["4200", 420000],
    ["4,200", 420000],
    ["€4,200.50", 420050],
    ["  1200  ", 120000],
    ["0", 0],
  ])("%s → %s cents", (input, expected) => {
    expect(centsFromInput(input)).toBe(expected);
  });

  it.each([[""], ["  "], ["approx 2k"], ["two thousand"], ["4200.555"], ["-50"], ["1.2.3"]])(
    "%s is refused rather than becoming 0",
    (input) => {
      // THE POINT. Storing an unparseable cost as zero silently records that a
      // €4,000 machine cost nothing, and the total is what the page is for.
      expect(centsFromInput(input)).toBeNull();
    }
  );

  it("formats cents back without inventing precision", () => {
    expect(euroFromCents(420000)).toBe("€4,200");
    expect(euroFromCents(420050)).toBe("€4,200.5");
    expect(euroFromCents(0)).toBe("€0");
  });

  it("null stays null — an unknown price is not €0", () => {
    expect(euroFromCents(null)).toBeNull();
    expect(euroFromCents(undefined)).toBeNull();
  });

  it("round-trips what a person actually types", () => {
    for (const raw of ["4200", "4,200", "€4,200.50", "999.99"]) {
      const cents = centsFromInput(raw)!;
      expect(cents).toBeGreaterThan(0);
      expect(Number.isInteger(cents)).toBe(true);
    }
  });
});

describe("the page is wired to all of it", () => {
  const ROOT = path.resolve(import.meta.dirname, "..", "..");
  const PAGE = readFileSync(
    path.join(ROOT, "app", "portal", "assetiq", "page.tsx"),
    "utf8"
  );
  const ACTIONS = readFileSync(
    path.join(ROOT, "app", "portal", "assetiq", "actions.ts"),
    "utf8"
  );

  it("takes 'today' from Dublin, not from the server's clock", () => {
    expect(PAGE).toContain("dublinDate()");
    expect(PAGE).not.toContain("toISOString().slice(0, 10)");
  });

  it("renders the same arrays it counted", () => {
    // One call, destructured — not one call for the numbers and another for
    // the rows.
    expect(PAGE).toMatch(
      /const \{ overdue, soon, overdueCount, soonCount \} = summariseDue\(/
    );
    expect(PAGE).toContain("[...overdue, ...soon].map");
    expect(PAGE.match(/summariseDue\(/g)).toHaveLength(1);
  });

  it("the value tile says how many assets it actually counted", () => {
    expect(PAGE).toContain("purchase price of ${costed} of ${live.length}");
    expect(PAGE).toContain("no purchase prices entered yet");
  });

  it("excludes retired assets from the value and the in-service count", () => {
    expect(PAGE).toContain('assets.filter((a) => a.status !== "retired")');
  });

  it("refuses an unparseable cost instead of storing zero", () => {
    expect(ACTIONS).toContain("isn't an amount");
    expect(ACTIONS).toContain("rawCost && cost === null");
  });

  it("re-checks the entitlement in the action, not just the layout", () => {
    // A layout is the UX gate; a direct POST does not go through it.
    expect(ACTIONS).toContain('requireProductEnabled(businessId, "assetiq")');
    const layout = readFileSync(
      path.join(ROOT, "app", "portal", "assetiq", "layout.tsx"),
      "utf8"
    );
    expect(layout).toContain('guardProduct("assetiq")');
  });

  it("tells you which migration to run rather than showing an empty list", () => {
    // The "convincing, wrong empty state" that lib/db/errors.ts exists for.
    expect(PAGE).toContain("isMissingTableError(error)");
    expect(ACTIONS).toContain('reportMissingTable("AssetIQ"');
    expect(ACTIONS).toContain("supabase/migrations/0045_assetiq.sql");
  });
});
