import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  collectDmPool,
  dmEmptyReason,
  POOL_PAGE,
  MAX_POOL_PAGES,
} from "@/lib/growth/dm-pool";

/**
 * The DM list fetches prospects by lead score and then drops the ones already
 * messaged. Fetching a FIXED slice first means the filter can only reorder
 * what that slice happens to contain — so as Jude works through his best
 * leads, the slice fills with people he has already DM'd, the list starves,
 * and the page says "research some prospects" while hundreds of researched,
 * drafted, un-DM'd prospects sit just below the score cut.
 *
 * That was "fixed" once by raising the slice from 200 to 600, which moves the
 * wall rather than removing it. At 600 DMs sent it starves again, and gives
 * the one piece of advice that cannot help.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");

type P = { id: string; score: number };

/** A candidate list of `total` prospects, best score first. */
const candidates = (total: number): P[] =>
  Array.from({ length: total }, (_, i) => ({ id: `p${i}`, score: 1000 - i }));

/** A fetcher over a fixed list, recording how it was paged. */
function pager(all: P[]) {
  const ranges: [number, number][] = [];
  return {
    ranges,
    fetch: async (from: number, to: number) => {
      ranges.push([from, to]);
      return all.slice(from, to + 1);
    },
  };
}

describe("it keeps reading until it finds work", () => {
  it("stops after one page when that page is enough", () => {
    // The common case must cost exactly what the single slice did.
    const all = candidates(POOL_PAGE * 3);
    const { ranges, fetch } = pager(all);
    return collectDmPool(fetch, new Set(), { need: 150 }).then((r) => {
      expect(ranges).toHaveLength(1);
      expect(ranges[0]).toEqual([0, POOL_PAGE - 1]);
      expect(r.available).toHaveLength(POOL_PAGE);
      expect(r.exhausted).toBe(false);
    });
  });

  it("READS PAST a whole page of already-DM'd prospects", async () => {
    // THE bug. Jude has DM'd his top 600. A fixed slice returns 600 rows,
    // every one of them filtered out, and the page declares the list empty.
    const all = candidates(POOL_PAGE * 3);
    const done = new Set(all.slice(0, POOL_PAGE).map((p) => p.id));
    const { ranges, fetch } = pager(all);

    const r = await collectDmPool(fetch, done, { need: 150 });
    expect(ranges.length).toBeGreaterThan(1);
    expect(r.available.length).toBeGreaterThanOrEqual(150);
    // And the ones it found are the next-best by score, not a random slice.
    expect(r.available[0].id).toBe(`p${POOL_PAGE}`);
  });

  it("reads past SEVERAL full pages", async () => {
    const all = candidates(POOL_PAGE * 5);
    const done = new Set(all.slice(0, POOL_PAGE * 3).map((p) => p.id));
    const r = await collectDmPool(pager(all).fetch, done, { need: 10 });
    expect(r.available[0].id).toBe(`p${POOL_PAGE * 3}`);
  });

  it("keeps best-score-first order across page boundaries", async () => {
    const all = candidates(POOL_PAGE * 2);
    const done = new Set([all[0].id, all[POOL_PAGE].id]);
    const r = await collectDmPool(pager(all).fetch, done, { need: 10_000 });
    const scores = r.available.map((p) => p.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });
});

describe("it knows when it has genuinely reached the end", () => {
  it("marks exhausted when a short page comes back", async () => {
    const r = await collectDmPool(pager(candidates(10)).fetch, new Set(), { need: 150 });
    expect(r.exhausted).toBe(true);
    expect(r.available).toHaveLength(10);
  });

  it("marks exhausted on an empty list", async () => {
    const r = await collectDmPool(pager([]).fetch, new Set(), { need: 150 });
    expect(r).toMatchObject({ available: [], exhausted: true });
  });

  it("marks exhausted when everyone has been DM'd and the list ends", async () => {
    // This is what makes "you've DM'd everyone" a fact rather than an
    // artefact of where we stopped looking.
    const all = candidates(50);
    const done = new Set(all.map((p) => p.id));
    const r = await collectDmPool(pager(all).fetch, done, { need: 150 });
    expect(r).toMatchObject({ available: [], exhausted: true });
  });

  it("does NOT mark exhausted when it stops at the page ceiling", async () => {
    // A full page at the ceiling means there is more below it.
    const all = candidates(POOL_PAGE * (MAX_POOL_PAGES + 2));
    const done = new Set(all.map((p) => p.id));
    const r = await collectDmPool(pager(all).fetch, done, { need: 150 });
    expect(r.exhausted).toBe(false);
    expect(r.available).toEqual([]);
  });
});

describe("it can never become an unbounded scan", () => {
  it("stops at the page ceiling however big the list is", async () => {
    const all = candidates(POOL_PAGE * 100);
    const done = new Set(all.map((p) => p.id));
    const { ranges, fetch } = pager(all);
    const r = await collectDmPool(fetch, done, { need: 150 });
    expect(ranges).toHaveLength(MAX_POOL_PAGES);
    expect(r.scanned).toBe(POOL_PAGE * MAX_POOL_PAGES);
  });

  it("stops as soon as it has enough, not at the ceiling", async () => {
    const all = candidates(POOL_PAGE * 10);
    const { ranges, fetch } = pager(all);
    await collectDmPool(fetch, new Set(), { need: 5 });
    expect(ranges).toHaveLength(1);
  });
});

describe("which empty state to show", () => {
  it("says 'write some drafts' when there are people but no messages", () => {
    expect(dmEmptyReason({ available: 40, ready: 0, exhausted: true })).toBe("awaiting-drafts");
    expect(dmEmptyReason({ available: 40, ready: 12, exhausted: false })).toBe("awaiting-drafts");
  });

  it("says 'nobody left' only when the list was read to the end", () => {
    expect(dmEmptyReason({ available: 0, ready: 0, exhausted: true })).toBe("no-candidates");
  });

  it("does NOT say 'research more prospects' when we stopped early", () => {
    // The wrong-advice case, and the reason this file exists. Everyone in the
    // stretch we read is already DM'd, but there are more below it — sending
    // Jude off to research new prospects is the one thing that cannot help.
    expect(dmEmptyReason({ available: 0, ready: 0, exhausted: false })).toBe("scan-limit");
  });

  it("prefers the drafts message when both could apply", () => {
    // Having people without drafts is actionable right now; the scan limit is
    // background information.
    expect(dmEmptyReason({ available: 5, ready: 0, exhausted: false })).toBe("awaiting-drafts");
  });
});

describe("the page uses it", () => {
  const PAGE = readFileSync(
    path.join(ROOT, "app", "growth", "(app)", "dms", "page.tsx"),
    "utf8"
  );

  it("pages the pool instead of taking one fixed slice", () => {
    expect(PAGE).toContain("collectDmPool<ProspectRow>");
    expect(PAGE).not.toContain("POOL_LIMIT");
    expect(PAGE).not.toMatch(/\.limit\(POOL/);
  });

  it("orders by score with a unique tiebreak, so paging cannot skip a row", () => {
    const idx = PAGE.indexOf("collectDmPool<ProspectRow>");
    const body = PAGE.slice(idx, idx + 1400);
    expect(body).toContain('.order("lead_score", { ascending: false, nullsFirst: false })');
    expect(body).toContain('.order("id", { ascending: true })');
    expect(body).toContain(".range(from, to)");
  });

  it("renders all three empty states", () => {
    expect(PAGE).toContain('emptyReason === "awaiting-drafts"');
    expect(PAGE).toContain('emptyReason === "scan-limit"');
    expect(PAGE).toContain("research some prospects");
  });

  it("only offers 'research some prospects' as the last resort", () => {
    // It must sit AFTER both other branches, i.e. be the final else.
    const awaiting = PAGE.indexOf('emptyReason === "awaiting-drafts"');
    const scan = PAGE.indexOf('emptyReason === "scan-limit"');
    const research = PAGE.indexOf("research some prospects</Link>");
    expect(awaiting).toBeLessThan(scan);
    expect(scan).toBeLessThan(research);
  });

  it("still treats an incomplete scan as an approximate count", () => {
    expect(PAGE).toContain("poolMaxedOut: !exhausted");
  });

  it("keeps the already-DM'd exclusion paged, not capped", () => {
    // A dropped "sent" row puts an already-DM'd prospect back on the list —
    // the one mistake this page exists to prevent.
    expect(PAGE).toContain("selectAllRows<{ prospect_id: string }>");
  });
});
