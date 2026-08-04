import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The inbox issued seven sequential round trips before it could render a row.
 *
 * Five of them shared nothing — none consumed another's result:
 *
 *     allMessages  inboundRows  actionableRows  draftRows  queueTotal
 *
 * They were simply written one `await` per line, so opening the page cost five
 * serial waits to Postgres before layout could start. Only `threadRows`
 * genuinely depends on anything (it needs `inboundPids`), and only
 * `prospectsRaw` needs the union of the rest.
 *
 *     BEFORE  7 serial round trips   ≈ 245ms at a 35ms RTT
 *     AFTER   3 dependency waves     ≈ 105ms
 *             57% fewer round trips
 *
 * This is the page Jude works replies in — the one surface where a reply going
 * unanswered costs a deal — so it is the one that has to feel instant.
 *
 * NOTHING ABOUT WHAT IS FETCHED CHANGED. Same columns, same filters, same
 * limits, same ordering. Only when the queries are issued moved, and the tests
 * below pin every constraint that earlier passes fought for so a reshuffle
 * cannot quietly undo them.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const INBOX = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "inbox", "page.tsx"),
  "utf8"
);

/** Everything before the JSX return — the data layer. */
const LOADER = INBOX.slice(0, INBOX.indexOf("  return ("));

describe("the independent reads are one wave", () => {
  it("all five are destructured from a single Promise.all", () => {
    const block = LOADER.slice(
      LOADER.indexOf("  const [\n    { data: allMessages },"),
      LOADER.indexOf("]);", LOADER.indexOf("  const [\n    { data: allMessages },"))
    );
    expect(block).toBeTruthy();
    for (const name of ["allMessages", "inboundRows", "actionableRows", "draftRows"]) {
      expect(block, name).toContain(`{ data: ${name} }`);
    }
    expect(block).toContain("{ count: queueTotalRaw }");
    expect(block).toContain("await Promise.all([");
  });

  it("none of them is a standalone await any more", () => {
    for (const name of ["allMessages", "inboundRows", "actionableRows", "draftRows"]) {
      expect(LOADER, name).not.toMatch(
        new RegExp(`const \\{ data: ${name} \\} = await admin`)
      );
    }
    expect(LOADER).not.toMatch(/const \{ count: queueTotalRaw \} = await admin/);
  });

  it("the loader has four awaited data stages, three of them on the hot path", () => {
    // 1 the Promise.all wave · 2 threadRows · 3 prospectsRaw · 4 the composer
    // templates. requireGrowth/searchParams are not database round trips.
    const stages = [...LOADER.matchAll(/= await (Promise\.all|selectAllRowsByIds|admin)/g)];
    expect(stages.length).toBe(4);
  });

  it("the fourth stage is the composer's, already parallel and conditional", () => {
    // templates + settings only load when a conversation is selected, and they
    // already share one Promise.all — so it is not part of the serial cost this
    // change removes, and was correctly left alone.
    expect(LOADER).toContain("if (selected) {");
    expect(LOADER).toContain(
      "const [{ data: templatesRaw }, settings] = await Promise.all(["
    );
  });
});

describe("the two genuinely dependent reads still come after", () => {
  it("threadRows waits for inboundPids", () => {
    const wave = LOADER.indexOf("] = await Promise.all([");
    const pids = LOADER.indexOf("const inboundPids");
    const thread = LOADER.indexOf("const threadRows = await selectAllRowsByIds");
    expect(pids).toBeGreaterThan(wave);
    expect(thread).toBeGreaterThan(pids);
  });

  it("prospectsRaw waits for the union of everything", () => {
    const thread = LOADER.indexOf("const threadRows = await selectAllRowsByIds");
    const ids = LOADER.indexOf("const prospectIds");
    const prospects = LOADER.indexOf("const prospectsRaw = await selectAllRowsByIds");
    expect(ids).toBeGreaterThan(thread);
    expect(prospects).toBeGreaterThan(ids);
    expect(LOADER).toContain("[...convMessages, ...messages, ...(queueRows ?? [])]");
  });
});

describe("every query is byte-for-byte what it was", () => {
  it.each([
    ["the 1000-row global window", ".limit(1000)"],
    ["inbound-only, fetched on its own terms", '.eq("direction", "inbound")'],
    ["failed + queued, not capped by date", '.in("status", ["failed", "queued"])'],
    ["plain drafts, separately", '.eq("status", "draft")'],
    ["a head-only count for the true queue size", 'count: "exact", head: true'],
    ["the 500 caps on both queue reads", ".limit(500)"],
  ])("%s", (_label, needle) => {
    expect(LOADER).toContain(needle);
  });

  it("the queue is still TWO queries, not one capped by date", () => {
    // The "score-ordered cap before the still-to-work filter" shape: a single
    // in(status,[draft,queued,failed]) capped at 500 by created_at let a
    // research batch of drafts push every FAILED and QUEUED row out of view.
    expect((LOADER.match(/\.limit\(500\)/g) ?? []).length).toBe(2);
    expect(LOADER).not.toMatch(/\.in\("status", \["draft", "queued", "failed"\]\)[\s\S]{0,200}\.limit\(500\)/);
  });

  it("both id-based reads are still chunked", () => {
    // 1,000 UUIDs in a request URL is ~39KB and simply fails — which would
    // show an inbox with NO conversations while replies sit in the database.
    // Counts USES, not the import line at the top of the file.
    expect((LOADER.match(/await selectAllRowsByIds/g) ?? []).length).toBe(2);
  });

  it("the queue total is still floored at what is on screen", () => {
    expect(LOADER).toContain("Math.max(queueTotalRaw ?? 0, queueRows.length)");
  });
});

describe("the conversation rules earlier passes fought for are intact", () => {
  it("threads are ordered by when a message actually happened", () => {
    expect(LOADER).toContain("sortByInstantDesc(threadRows ?? [])");
  });

  it("'who spoke last' still ignores unsent drafts", () => {
    expect(LOADER).toContain("latestRealMessage(thread)");
  });

  it("reply-due conversations still come first, oldest-waiting first", () => {
    expect(LOADER).toContain("if (a.awaitingUs !== b.awaitingUs) return a.awaitingUs ? -1 : 1;");
  });

  it("the queue is still ranked failed → queued → draft", () => {
    expect(LOADER).toContain('const queueRank: Record<string, number> = { failed: 0, queued: 1, draft: 2 };');
  });

  it("conversations still require at least one inbound", () => {
    expect(LOADER).toContain('c.thread.some((m) => m.direction === "inbound")');
  });
});
