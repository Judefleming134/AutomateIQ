import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  applyStageBucket,
  resolveStageBucket,
  STAGE_BUCKETS,
  STAGE_BUCKET_LABELS,
  STAGE_BUCKET_STATUSES,
} from "./prospect-query";
import { STAGE_CHIP_LABELS, activeFilterChips } from "./prospect-filters";

/**
 * Jarvis's "What matters right now" panel is three links. Two of them narrowed
 * the list they were counting. The middle one — "N researched prospects with
 * drafts ready and no first touch yet" — pointed at `?sort=score`.
 *
 * That is NO FILTER AT ALL. A count of forty landed on the entire database,
 * sorted by score. On a few thousand prospects the page reads as broken, and
 * the one panel whose whole job is "do this next" sends you to a wall.
 *
 * prospect-query.ts says what the rule is, in its own words:
 *
 *   "the number shown must equal the rows the click lands on, or the page
 *    looks broken"
 *
 * It said that about `to_research`, which spans TWO statuses and so had no
 * single-status filter to point at — the same shape exactly. That one got a
 * stage bucket. This one didn't, and quietly pointed at everything instead.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const JARVIS = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "jarvis", "page.tsx"),
  "utf8"
);
const EXPORT = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "reports", "export", "route.ts"),
  "utf8"
);

/**
 * Records what a query builder was asked to do, without a database.
 *
 * Shape and style copied from prospect-query.test.ts deliberately: the type is
 * INFERRED, not annotated. Annotating it as `FilterableQuery<Self>` is
 * self-referential and tsc rejects it — and `next build` does not typecheck
 * test files, so that error only shows up under `tsc --noEmit`.
 */
function recorder() {
  const calls: string[] = [];
  const q = {
    eq: (c: string, v: unknown) => (calls.push(`eq:${c}=${v}`), q),
    lt: (c: string, v: unknown) => (calls.push(`lt:${c}=${v}`), q),
    lte: (c: string, v: unknown) => (calls.push(`lte:${c}=${v}`), q),
    gte: (c: string, v: unknown) => (calls.push(`gte:${c}=${v}`), q),
    is: (c: string, v: unknown) => (calls.push(`is:${c}=${v}`), q),
    in: (c: string, v: readonly unknown[]) => (calls.push(`in:${c}=[${v.join(",")}]`), q),
    not: (c: string, o: string, v: unknown) => (calls.push(`not:${c} ${o} ${v}`), q),
  };
  return { q, calls };
}

describe("the bucket the panel needed", () => {
  it("covers both statuses a ready prospect can be in", () => {
    expect(STAGE_BUCKET_STATUSES.ready_to_send).toEqual([
      "research_complete",
      "outreach_ready",
    ]);
  });

  it("narrows the query to exactly those, and nothing else", () => {
    const { q, calls } = recorder();
    applyStageBucket(q, "ready_to_send");
    expect(calls).toEqual(["in:status=[research_complete,outreach_ready]"]);
  });

  it("resolves from the URL, and rejects anything else", () => {
    expect(resolveStageBucket("ready_to_send")).toBe("ready_to_send");
    expect(resolveStageBucket("to_research")).toBe("to_research");
    expect(resolveStageBucket("ready")).toBeNull();
    expect(resolveStageBucket(undefined)).toBeNull();
  });

  it("leaves the query untouched when there is no bucket", () => {
    // Callers apply it unconditionally, so this must be a genuine no-op.
    const { q, calls } = recorder();
    applyStageBucket(q, null);
    expect(calls).toEqual([]);
  });

  it("did not disturb the bucket that already existed", () => {
    const { q, calls } = recorder();
    applyStageBucket(q, "to_research");
    expect(calls).toEqual(["in:status=[new,researching]"]);
    expect(STAGE_BUCKET_STATUSES.to_research).toEqual(["new", "researching"]);
  });
});

describe("the count now equals the rows the click lands on", () => {
  it("the ready priority links to the filtered list", () => {
    expect(JARVIS).toContain("/growth/prospects?stage=ready_to_send&sort=score");
  });

  it("no priority link is a bare sort any more", () => {
    // The shape of the bug: a "do this next" link with nothing narrowing it.
    const code = JARVIS.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toContain('href: "/growth/prospects?sort=score"');
  });

  it("the other two priorities are still pointed where they were", () => {
    // They were already right; this must not have touched them.
    expect(JARVIS).toContain("/growth/prospects?due=live&sort=follow_up");
    expect(JARVIS).toContain('href: "/growth/inbox"');
  });

  it("reconciles the one number that legitimately differs", () => {
    // The count excludes prospects already queued for the morning run; the
    // filtered list cannot express that. Saying so beats landing on a longer
    // list and wondering which number is lying.
    expect(JARVIS).toContain("readyAlreadyQueued");
    expect(JARVIS).toContain("already queued for the morning run");
  });

  it("still subtracts the queued ones from the actionable count", () => {
    // The adjustment itself was right and stays — a queued prospect is handled.
    expect(JARVIS).toContain("readyAdjusted = Math.max(0, readyAdjusted - readyAlreadyQueued)");
  });

  it("says nothing about queued ones when there are none", () => {
    // No noise on an ordinary morning.
    expect(JARVIS).toContain("readyAlreadyQueued > 0");
  });
});

describe("the CSV export gets the bucket for free", () => {
  it("applies stage buckets through the same shared function", () => {
    // The reason buckets live in prospect-query.ts at all: the export button
    // sits on the filtered page and claims to export what you're looking at.
    expect(EXPORT).toContain("applyStageBucket(query, resolveStageBucket(stageParam))");
  });
});

describe("the two label maps cannot drift apart", () => {
  it("every bucket has a chip label", () => {
    // prospect-filters.ts keeps its own copy so it stays free of the query
    // builder. A bucket added there without a label here renders a chip
    // reading "ready_to_send".
    for (const bucket of STAGE_BUCKETS) {
      expect(STAGE_CHIP_LABELS[bucket], `no chip label for ${bucket}`).toBeTruthy();
    }
  });

  it("and the two agree word for word", () => {
    for (const bucket of STAGE_BUCKETS) {
      expect(STAGE_CHIP_LABELS[bucket]).toBe(STAGE_BUCKET_LABELS[bucket]);
    }
  });

  it("the chip renders the label, not the raw value", () => {
    const chips = activeFilterChips({ stage: "ready_to_send" });
    expect(chips).toHaveLength(1);
    expect(chips[0].label).toBe("researched, drafts ready");
    expect(chips[0].label).not.toContain("_");
  });

  it("and the chip clears only itself", () => {
    const chips = activeFilterChips({ stage: "ready_to_send", sort: "score" });
    expect(chips[0].clearHref).not.toContain("stage=");
    expect(chips[0].clearHref).toContain("sort=score");
  });
});
