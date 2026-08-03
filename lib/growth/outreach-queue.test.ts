import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The Outreach queue hid the only two things in it that need a decision.
 *
 * The page fetched draft + queued + failed in ONE query,
 * `order(created_at desc).limit(500)`, and only THEN sorted
 * failed → queued → draft in memory.
 *
 * So the cap was applied BY DATE and the urgency ranking could only reorder
 * whatever those newest 500 happened to contain. The engine writes ~5 drafts
 * per researched prospect, so drafts are both the overwhelming majority AND
 * the newest rows after every research batch — they filled the window and
 * pushed the older FAILED and QUEUED rows straight out of it.
 *
 * Those two are the whole point of the view:
 *   FAILED — an email that never reached a prospect, needing a retry.
 *   QUEUED — an email the 07:00 cron WILL send, shown here or not.
 *
 * Replayed: after one research run of 600 drafts, all 3 failed and all 40
 * queued vanished — while the tab still read a confident "(500)".
 *
 * This is the class CLAUDE.md names by name — "a score-ordered cap applied
 * before the 'still to work' filter, so the most urgent items never enter the
 * list at all" — and it is the third time it has been found in this codebase
 * (the call list, then the DM pool, now here).
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const PAGE = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "inbox", "page.tsx"),
  "utf8"
);

const WINDOW = 500;
const RANK: Record<string, number> = { failed: 0, queued: 1, draft: 2 };

type Row = { id: string; status: string; created_at: number };

/** Failures happened days ago, then things were queued, then last night's
 *  drafts landed — which is the order these rows are genuinely created in. */
function buildQueue(failed: number, queued: number, drafts: number): Row[] {
  const rows: Row[] = [];
  let t = 0;
  for (let i = 0; i < failed; i++) rows.push({ id: `F${i}`, status: "failed", created_at: t++ });
  for (let i = 0; i < queued; i++) rows.push({ id: `Q${i}`, status: "queued", created_at: t++ });
  for (let i = 0; i < drafts; i++) rows.push({ id: `D${i}`, status: "draft", created_at: t++ });
  return rows;
}

/** One date-capped query, then rank in memory — the bug. */
const shownBefore = (all: Row[]) =>
  [...all]
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, WINDOW)
    .sort((a, b) => (RANK[a.status] ?? 3) - (RANK[b.status] ?? 3));

/** Actionable fetched on their own terms, drafts separately — the fix. */
const shownAfter = (all: Row[]) => [
  ...all
    .filter((r) => r.status === "failed" || r.status === "queued")
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, WINDOW)
    .sort((a, b) => (RANK[a.status] ?? 3) - (RANK[b.status] ?? 3)),
  ...all
    .filter((r) => r.status === "draft")
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, WINDOW),
];

const count = (rows: Row[], s: string) => rows.filter((r) => r.status === s).length;

describe("drafts can no longer push the actionable rows off the page", () => {
  it.each([
    ["one research run", 3, 40, 600],
    ["a busy few nights", 6, 50, 2000],
    ["a 20k-prospect base", 11, 50, 8000],
  ])("%s: every failed and queued message still shows", (_label, f, q, d) => {
    const all = buildQueue(f, q, d);
    const after = shownAfter(all);
    expect(count(after, "failed")).toBe(f);
    expect(count(after, "queued")).toBe(q);
    // And this is what it used to do — the regression, stated rather than
    // described.
    const before = shownBefore(all);
    expect(count(before, "failed")).toBe(0);
    expect(count(before, "queued")).toBe(0);
  });

  it("a small queue is unaffected — nothing changed for the normal case", () => {
    const all = buildQueue(2, 20, 120);
    expect(shownAfter(all).length).toBe(all.length);
    expect(shownBefore(all).length).toBe(all.length);
  });

  it("still ranks failed above queued above draft", () => {
    const shown = shownAfter(buildQueue(3, 5, 900));
    const ranks = shown.map((r) => RANK[r.status]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(shown[0].status).toBe("failed");
  });

  it("still caps the drafts — this is not an unbounded read", () => {
    const shown = shownAfter(buildQueue(2, 2, 5000));
    expect(count(shown, "draft")).toBe(WINDOW);
    expect(shown.length).toBe(WINDOW + 4);
  });
});

describe("the page is wired to the fixed shape", () => {
  it("fetches the actionable statuses on their own terms", () => {
    expect(PAGE).toContain('.in("status", ["failed", "queued"])');
  });

  it("fetches drafts as a SEPARATE query", () => {
    expect(PAGE).toContain('.eq("status", "draft")');
    expect(PAGE).toContain("const { data: draftRows }");
    // And the two results are combined, so nothing is dropped on the floor.
    expect(PAGE).toContain(
      "const queueRows = [...(actionableRows ?? []), ...(draftRows ?? [])]"
    );
  });

  it("no longer lumps all three into one capped query", () => {
    // The bug, in one line. A `select(...).in("status", [draft, queued,
    // failed]).limit(500)` anywhere here reintroduces it exactly.
    expect(PAGE).not.toContain('.in("status", ["draft", "queued", "failed"])\n    .order');
    expect(PAGE).not.toMatch(
      /\.in\("status", \["draft", "queued", "failed"\]\)\s*\n\s*\.order\("created_at"[\s\S]{0,40}\.limit\(/
    );
  });

  it("still ranks in memory after fetching — the ordering is unchanged", () => {
    expect(PAGE).toContain("const queueRank: Record<string, number> = { failed: 0, queued: 1, draft: 2 }");
  });
});

describe("the tab count tells the truth", () => {
  it("counts the whole queue with a head count, not the rows in hand", () => {
    // "(500)" read as an exact figure when there were 8,000.
    expect(PAGE).toContain('.select("id", { count: "exact", head: true })');
    expect(PAGE).toContain("const queueTotal");
    expect(PAGE).toContain("Outreach queue ({queueTotal})");
  });

  it("floors the total at the rows actually shown", () => {
    // A count that came back smaller than the list would render a queue
    // claiming to hold fewer messages than are visible on it.
    expect(PAGE).toContain("Math.max(queueTotalRaw ?? 0, queueRows.length)");
  });

  it("says so when the list is shorter than the queue", () => {
    // A truncated page that looks complete is how this bug stayed invisible.
    expect(PAGE).toContain("const draftsBeyond");
    const from = PAGE.indexOf("draftsBeyond > 0");
    expect(from, "the truncation notice is not rendered").toBeGreaterThan(-1);
    const block = PAGE.slice(from, from + 420);
    expect(block).toContain("every failed and queued message");
  });

  it("the count and the list cannot disagree about what is pending", () => {
    // Both derive from the same three statuses.
    const head = PAGE.slice(PAGE.indexOf("const { count: queueTotalRaw }"));
    expect(head.slice(0, 400)).toContain('["draft", "queued", "failed"]');
  });
});

describe("nothing else on the inbox changed", () => {
  it("conversations are still fetched by inbound prospect, not the global window", () => {
    expect(PAGE).toContain("selectAllRowsByIds");
    expect(PAGE).toContain('.eq("direction", "inbound")');
  });

  it("replies waiting longest still come first", () => {
    expect(PAGE).toContain("if (a.awaitingUs && b.awaitingUs)");
  });

  it("the queue still HAS an empty state, and it explains what fills it", () => {
    // This pinned the exact old sentence ("— draft messages from any
    // prospect's page") as a "nothing else changed" guard for the queue-query
    // fix. It fired on 2026-08-03 when that copy was deliberately rewritten to
    // link to a prospect worth drafting for, rather than naming the page in
    // words and leaving you to find it.
    //
    // What this guard is protecting is that the empty state EXISTS and points
    // somewhere — not one wording — so it now pins that. The queue behaviour
    // it was really guarding is covered by the assertions above.
    expect(PAGE).toContain("The queue is empty.");
    expect(PAGE).toContain("Message Studio");
    expect(PAGE).toContain("/growth/prospects?stage=ready_to_send");
  });
});
