import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  applyDueBucket,
  resolveDueBucket,
  closedStatusFilter,
  DUE_BUCKETS,
  DUE_BUCKET_LABELS,
  type DueBucket,
} from "@/lib/growth/prospect-query";
import { CONTACTED_ACTIVE_STATUSES } from "@/lib/growth/constants";

/**
 * The Prospects page and the CSV export must narrow to the SAME set — the
 * export button sits on the page, and its tooltip says "Exports the filtered
 * list you're looking at".
 *
 * A fifth bucket, `unscheduled` ("contacted, but with no next step booked"),
 * was added to the page and linked to directly from the dashboard. The export
 * was never taught about it: it fell through every branch, applied nothing,
 * and handed back EVERY prospect in the database — in a file named
 * `growth-prospects-filtered`, which asserts the opposite.
 *
 * The export's own comment warned about this exact failure for the previous
 * bucket. So the definition is now shared, and these tests hold both callers
 * to it.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const TODAY = "2026-08-10";
const COLD = "2026-08-03";

type Call = [string, ...unknown[]];

/** Records what a query builder would have been asked to do. */
function recorder() {
  const calls: Call[] = [];
  const q = {
    eq: (c: string, v: unknown) => (calls.push(["eq", c, v]), q),
    lt: (c: string, v: unknown) => (calls.push(["lt", c, v]), q),
    lte: (c: string, v: unknown) => (calls.push(["lte", c, v]), q),
    gte: (c: string, v: unknown) => (calls.push(["gte", c, v]), q),
    is: (c: string, v: unknown) => (calls.push(["is", c, v]), q),
    in: (c: string, v: readonly unknown[]) => (calls.push(["in", c, [...v]]), q),
    not: (c: string, o: string, v: unknown) => (calls.push(["not", c, o, v]), q),
  };
  return { q, calls };
}

const filtersFor = (due: DueBucket | null): Call[] => {
  const { q, calls } = recorder();
  applyDueBucket(q, due, TODAY, COLD);
  return calls;
};

describe("reading the bucket off the URL", () => {
  it("accepts every bucket the page offers", () => {
    for (const b of DUE_BUCKETS) expect(resolveDueBucket(b)).toBe(b);
  });

  it("treats anything else as no bucket, not a broken one", () => {
    for (const bad of ["", "  ", "nonsense", "TODAY", null, undefined]) {
      expect(resolveDueBucket(bad)).toBeNull();
    }
  });

  it("every bucket has a label a human can read", () => {
    for (const b of DUE_BUCKETS) {
      expect(DUE_BUCKET_LABELS[b], b).toBeTruthy();
    }
  });
});

describe("each bucket narrows to what its name says", () => {
  it("today is exactly today", () => {
    expect(filtersFor("today")).toContainEqual(["eq", "next_follow_up_at", TODAY]);
  });

  it("overdue is late but inside the chase window", () => {
    const f = filtersFor("overdue");
    expect(f).toContainEqual(["lt", "next_follow_up_at", TODAY]);
    expect(f).toContainEqual(["gte", "next_follow_up_at", COLD]);
  });

  it("live is today plus overdue", () => {
    const f = filtersFor("live");
    expect(f).toContainEqual(["lte", "next_follow_up_at", TODAY]);
    expect(f).toContainEqual(["gte", "next_follow_up_at", COLD]);
  });

  it("cold is past the chase window", () => {
    const f = filtersFor("cold");
    expect(f).toContainEqual(["lt", "next_follow_up_at", COLD]);
    // And NOT bounded below, or "gone cold" would exclude the coldest leads.
    expect(f.some(([op, , v]) => op === "gte" && v === COLD)).toBe(false);
  });

  it("unscheduled is contacted-but-nothing-booked", () => {
    // THE bucket the export forgot.
    const f = filtersFor("unscheduled");
    expect(f).toContainEqual(["in", "status", [...CONTACTED_ACTIVE_STATUSES]]);
    expect(f).toContainEqual(["is", "next_follow_up_at", null]);
  });

  it("every bucket excludes closed and archived leads", () => {
    for (const b of DUE_BUCKETS) {
      expect(filtersFor(b), b).toContainEqual([
        "not",
        "status",
        "in",
        closedStatusFilter(),
      ]);
    }
  });

  it("EVERY bucket actually filters something — none falls through", () => {
    // The precise shape of the bug: `unscheduled` matched no branch, so the
    // only call made was the closed-status exclusion, which on its own is
    // "the whole database minus archived".
    for (const b of DUE_BUCKETS) {
      const narrowing = filtersFor(b).filter(
        ([op, col]) => !(op === "not" && col === "status")
      );
      expect(narrowing.length, `${b} applied no narrowing filter`).toBeGreaterThan(0);
    }
  });

  it("no bucket leaves the query untouched", () => {
    expect(filtersFor(null)).toEqual([]);
  });
});

describe("the page and the export narrow identically", () => {
  const PAGE = readFileSync(
    path.join(ROOT, "app", "growth", "(app)", "prospects", "page.tsx"),
    "utf8"
  );
  const EXPORT = readFileSync(
    path.join(ROOT, "app", "growth", "(app)", "reports", "export", "route.ts"),
    "utf8"
  );

  it("both call the shared helper", () => {
    expect(PAGE).toContain("applyDueBucket(query, due");
    expect(EXPORT).toContain("applyDueBucket(query, resolveDueBucket(dueParam)");
  });

  it("neither lists the buckets by hand any more", () => {
    // A hand-written list is what went stale. If one appears again, it is a
    // second definition and this is how it gets caught.
    for (const [name, src] of [
      ["page", PAGE],
      ["export", EXPORT],
    ] as const) {
      expect(src, name).not.toMatch(/=== "cold"\)?\s*query/);
      expect(src, name).not.toContain('["today", "overdue", "live", "cold"]');
    }
  });

  it("the export carries every filter the page does", () => {
    // The export href is built from these; if the page gains a filter and the
    // href doesn't, the CSV silently stops matching the screen.
    for (const key of ["q", "status", "industry", "campaign", "phone", "due", "sort"]) {
      expect(PAGE, key).toContain(`exportSp.set("${key}"`);
    }
  });

  it("the export reads every one of them back", () => {
    for (const key of ["q", "status", "industry", "campaign", "phone", "due", "sort"]) {
      expect(EXPORT, key).toContain(`url.searchParams.get("${key}")`);
    }
  });

  it("the dashboard link that exposed this still points somewhere real", () => {
    const DASH = readFileSync(
      path.join(ROOT, "app", "growth", "(app)", "page.tsx"),
      "utf8"
    );
    expect(DASH).toContain("/growth/prospects?due=unscheduled");
    expect(resolveDueBucket("unscheduled")).toBe("unscheduled");
  });
});
