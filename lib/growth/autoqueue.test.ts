import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  isAutoQueueable,
  autoQueueWindows,
  collectQueueableDrafts,
  type AutopilotCandidate,
} from "@/lib/growth/autopilot";

/**
 * The 07:00 auto-queue under-filled when the top-scored drafts were flagged.
 *
 * `listAutopilotCandidates(limit)` caps at `limit` candidates on RAW SCORE
 * ORDER — the broken/stale flags are computed, but the truncation happens
 * before anything knows which of them are sendable. The caller then filtered
 * that fixed slice with a single fixed over-fetch (need * 2). So on a night
 * where many top-scored drafts came back flagged, the queue filled short while
 * perfectly clean drafts sat just below the cut, unreachable.
 *
 * This is the fourth time this codebase has hit the same shape: a score-ordered
 * cap applied BEFORE the "still to work" filter.
 *
 * It is not a hypothetical here. A research refresh marks every draft written
 * before it as research-stale, and Jarvis refreshes research nightly — so the
 * flags arrive in BATCHES, precisely on the nights the queue needs filling.
 * The result is a smaller send that morning with nothing on screen saying so.
 */

let seq = 0;
const candidate = (over: Partial<AutopilotCandidate> = {}): AutopilotCandidate => ({
  messageId: `m${++seq}`,
  prospectId: `p${seq}`,
  company: `Co ${seq}`,
  contactName: "Owner",
  email: `o${seq}@example.ie`,
  subject: "s",
  body: "b",
  leadScore: 50,
  industry: null,
  queued: false,
  broken: null,
  stale: null,
  staleKind: null,
  ...over,
});

const BROKEN = () => candidate({ broken: "leftover [placeholder]" });
const RESEARCH_STALE = () =>
  candidate({ stale: "research updated since this draft was written", staleKind: "research" });
const AGE_STALE = () => candidate({ stale: "draft is over 5 days old", staleKind: "age" });

/** A pool the fake fetcher slices, exactly as the real one caps on score order. */
const fetcherFor = (pool: AutopilotCandidate[]) => {
  const calls: number[] = [];
  const fn = async (limit: number) => {
    calls.push(limit);
    return pool.slice(0, limit);
  };
  return { fn, calls };
};

describe("which drafts may be auto-queued", () => {
  it("takes a clean one", () => {
    expect(isAutoQueueable(candidate())).toBe(true);
  });

  it("skips a broken draft", () => {
    expect(isAutoQueueable(BROKEN())).toBe(false);
  });

  it("skips one whose research changed underneath it", () => {
    expect(isAutoQueueable(RESEARCH_STALE())).toBe(false);
  });

  it("STILL SENDS an age-stale draft", () => {
    // A cold first-touch intro doesn't rot. Excluding these starved the run
    // whenever a batch of drafts crossed the 5-day mark together — the
    // previous version of this same bug.
    expect(isAutoQueueable(AGE_STALE())).toBe(true);
  });

  it("skips one already queued", () => {
    expect(isAutoQueueable(candidate({ queued: true }))).toBe(false);
  });
});

describe("the bug: a flagged top of the list starved the queue", () => {
  it("reaches clean drafts that sat below the old fixed window", async () => {
    // need 20 → the old code fetched 40 and filtered. Here the first 40 are
    // all research-stale (one nightly research refresh does exactly this) and
    // 20 clean drafts sit at positions 41–60.
    const pool = [
      ...Array.from({ length: 40 }, RESEARCH_STALE),
      ...Array.from({ length: 20 }, () => candidate()),
    ];

    const oldWindow = pool.slice(0, Math.min(20 * 2, 50)).filter(isAutoQueueable);
    expect(oldWindow).toHaveLength(0); // the whole morning's send, lost

    const { clean } = await collectQueueableDrafts(20, fetcherFor(pool).fn);
    expect(clean).toHaveLength(20);
    expect(clean.every(isAutoQueueable)).toBe(true);
  });

  it("fills partially rather than not at all when the pool is thin", async () => {
    const pool = [
      ...Array.from({ length: 40 }, BROKEN),
      ...Array.from({ length: 7 }, () => candidate()),
    ];
    const { clean } = await collectQueueableDrafts(20, fetcherFor(pool).fn);
    expect(clean).toHaveLength(7);
  });

  it("never queues more than asked for", async () => {
    // The ramp decided `need`; exceeding it would send more than the
    // deliverability ceiling allows, which is worse than sending short.
    const pool = Array.from({ length: 200 }, () => candidate());
    const { clean } = await collectQueueableDrafts(20, fetcherFor(pool).fn);
    expect(clean).toHaveLength(20);
  });
});

describe("an ordinary night costs exactly what it used to", () => {
  it("does ONE fetch when the first window has enough", async () => {
    const pool = Array.from({ length: 100 }, () => candidate());
    const { fn, calls } = fetcherFor(pool);
    const { passes } = await collectQueueableDrafts(20, fn);
    expect(passes).toBe(1);
    expect(calls).toEqual([40]); // the old need*2 window, unchanged
  });

  it("only widens when the first window came up short", async () => {
    const pool = [
      ...Array.from({ length: 40 }, RESEARCH_STALE),
      ...Array.from({ length: 20 }, () => candidate()),
    ];
    const { fn, calls } = fetcherFor(pool);
    await collectQueueableDrafts(20, fn);
    expect(calls.length).toBeGreaterThan(1);
    expect(calls[0]).toBe(40);
    expect(calls[1]).toBeGreaterThan(40);
  });
});

describe("it terminates — a starved night must not scan forever", () => {
  it("stops as soon as widening stops finding anything new", async () => {
    // 30 candidates total, all flagged. Widening past 30 can only return the
    // same 30, so a second fetch proves exhaustion and the third never runs.
    const pool = Array.from({ length: 30 }, BROKEN);
    const { fn, calls } = fetcherFor(pool);
    const { clean, passes } = await collectQueueableDrafts(20, fn);
    expect(clean).toHaveLength(0);
    expect(passes).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it("is bounded even when every window returns more but none are sendable", async () => {
    const pool = Array.from({ length: 500 }, BROKEN);
    const { fn, calls } = fetcherFor(pool);
    const { clean } = await collectQueueableDrafts(20, fn);
    expect(clean).toHaveLength(0);
    expect(calls.length).toBeLessThanOrEqual(autoQueueWindows(20).length);
  });

  it("handles an empty pool in one pass", async () => {
    const { fn, calls } = fetcherFor([]);
    const { clean, scanned } = await collectQueueableDrafts(20, fn);
    expect(clean).toEqual([]);
    expect(scanned).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it("never re-fetches a window no wider than one already tried", async () => {
    // need 100 → need*2 and need*6 both clamp to 150 ceilings; repeating an
    // identical fetch is pure latency on the 07:00 critical path.
    const pool = Array.from({ length: 400 }, BROKEN);
    const { fn, calls } = fetcherFor(pool);
    await collectQueueableDrafts(100, fn);
    expect(new Set(calls).size).toBe(calls.length);
  });
});

describe("the windows themselves", () => {
  it("starts at the old behaviour, so nothing changes on a normal night", () => {
    expect(autoQueueWindows(20)[0]).toBe(40);
    expect(autoQueueWindows(5)[0]).toBe(10);
  });

  it("keeps the original ceiling on the first window", () => {
    expect(autoQueueWindows(100)[0]).toBe(50);
  });

  it("widens strictly", () => {
    const w = autoQueueWindows(20);
    for (let i = 1; i < w.length; i++) expect(w[i]).toBeGreaterThan(w[i - 1]);
  });

  it("is finite and small", () => {
    expect(autoQueueWindows(20).length).toBeLessThanOrEqual(3);
    expect(Math.max(...autoQueueWindows(1000))).toBeLessThanOrEqual(300);
  });
});

describe("the caller is wired to it, and reports honestly", () => {
  const SRC = readFileSync(path.resolve(import.meta.dirname, "autopilot.ts"), "utf8");
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const QUEUE = CODE.slice(
    CODE.indexOf("export async function autoQueueTopDrafts"),
    CODE.indexOf("export async function autoQueueDueFollowups")
  );

  it("uses the widening collector rather than a fixed slice", () => {
    expect(QUEUE).toContain("collectQueueableDrafts(");
  });

  it("no longer filters a single fixed window", () => {
    expect(QUEUE).not.toMatch(/listAutopilotCandidates\(Math\.min\(need \* 2, 50\)\)/);
    expect(QUEUE).not.toMatch(/\.filter\(\(c\) => !c\.queued && !c\.broken/);
  });

  it("stops claiming a top-up when it queued nothing", () => {
    // "topped the queue up from 12 to 12" read as work done, so a run that
    // queued NOTHING looked identical in the brief to one that filled it.
    expect(QUEUE).toMatch(/if \(queued === 0\)/);
    expect(QUEUE).toContain("nothing queued");
    expect(QUEUE).toContain("nothing to queue");
  });

  it("says so when the queue came up short of the day's target", () => {
    expect(QUEUE).toContain("shortfall");
    expect(QUEUE).toContain("short of today's");
  });

  it("still caps at need, so the ramp ceiling is respected", () => {
    expect(QUEUE).toMatch(/collectQueueableDrafts\(\s*need,/);
  });

  it("still runs the send-time review gate — this change must not touch it", () => {
    expect(CODE).toContain("reviewOutreachEmail");
  });
});

describe("the 07:00 dispatch is untouched by this change", () => {
  const ROUTE = readFileSync(
    path.resolve(import.meta.dirname, "..", "..", "app", "api", "cron", "dispatch", "route.ts"),
    "utf8"
  );

  // The load-bearing task ORDER is pinned in full by lib/cron/dispatch-order.
  // Duplicating it here badly (the first attempt compared raw string indices
  // and matched a comment) is worse than not duplicating it — this only checks
  // the call itself still exists and still reads the fields whose shape did
  // not change.
  it("still calls autoQueueTopDrafts", () => {
    expect(ROUTE).toContain("autoQueueTopDrafts");
  });

  it("reads it through the isolated() wrapper, so a throw can't take the run down", () => {
    // collectQueueableDrafts deliberately propagates a fetch failure rather
    // than reporting an empty pool — isolated() is what turns that into a
    // reported failure instead of a dead 07:00 run.
    expect(ROUTE).toMatch(/isolated\("autoQueue", autoQueueTopDrafts\)/);
  });
});

describe("the shortfall arithmetic", () => {
  it.each([
    [20, 20, 0],
    [20, 7, 13],
    [20, 0, 20],
    [1, 1, 0],
  ])("need %i, got %i → %i short", async (need, available, expected) => {
    const pool = [
      ...Array.from({ length: available }, () => candidate()),
      ...Array.from({ length: 300 }, BROKEN),
    ];
    const { clean } = await collectQueueableDrafts(need, fetcherFor(pool).fn);
    expect(need - clean.length).toBe(expected);
  });
});

describe("it does not swallow a fetch failure as an empty pool", () => {
  it("propagates rather than silently queueing nothing", async () => {
    // Reporting "nothing to queue" for a failed query is the "success for work
    // that didn't happen" shape — the caller must see the throw.
    const boom = vi.fn(async () => {
      throw new Error("PostgREST 502");
    });
    await expect(collectQueueableDrafts(20, boom)).rejects.toThrow("PostgREST 502");
  });
});
