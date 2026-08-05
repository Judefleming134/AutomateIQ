import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { selectAllRowsByIds } from "./db";

/**
 * "Ready to send" was counted HIGH on exactly the mornings the queue was full.
 *
 * Both the dashboard and the Jarvis page show a "researched prospects with
 * drafts ready and no first touch yet" number, and both subtract the prospects
 * whose email is ALREADY queued for the 07:00 run — because those are handled,
 * and counting them again made the two pages disagree about the same list. The
 * comment on the Jarvis one says so in as many words.
 *
 * Both did the subtraction with
 *
 *     .select("id", { count: "exact", head: true })
 *       .in("status", [...])
 *       .in("id", queuedIds)          // ← every id, in the URL
 *
 * which is the trap CLAUDE.md names by name: `.in()` serialises each id into
 * the request URL at roughly 40 characters per UUID, so ~200 ids blow the ~8KB
 * limit and the request fails outright.
 *
 * MEASURED RATHER THAN REPEATED, because the margin is the whole story: 200
 * ids modelled exactly is 7,932 bytes against a 8,192 line — 97% of it, with
 * the SHORTEST query this code could issue. Add the real project ref, an
 * `order` or one more filter and it is over. So this is not "eventually, at
 * scale"; it is the current size sitting on the edge.
 *
 * 200 IS NOT A HYPOTHETICAL — IT IS THE DESIGNED SIZE OF THIS LIST. The send
 * ramp climbs to 200/day (RAMP_STEP in autopilot.ts) and autoQueueTopDrafts
 * tops the queue up to exactly that target (`need = target - already`). A
 * healthy engine therefore parks ~200 queued emails every night.
 *
 * And it failed SILENTLY, in the direction that inflates:
 *
 *   Jarvis    count → null → readyAlreadyQueued = 0 → nothing subtracted,
 *                    and the "(also shows N already queued)" note disappears
 *   Dashboard count → null → readyTotal = readyStatusCount - 0
 *
 * So on a full-queue morning both pages told Jude to go and send to prospects
 * the autopilot was about to email an hour later.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const JARVIS = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "jarvis", "page.tsx"),
  "utf8"
);
const DASHBOARD = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "page.tsx"),
  "utf8"
);
const AUTOPILOT = readFileSync(path.join(ROOT, "lib", "growth", "autopilot.ts"), "utf8");

/** A URL of the shape PostgREST builds for `.in("id", ids)`. */
function inClauseUrl(ids: string[]): string {
  return `https://xxxxxxxxxxxxxxxxxxxx.supabase.co/rest/v1/ge_prospects?select=id&status=in.%28research_complete%2Coutreach_ready%29&id=in.%28${ids.join("%2C")}%29`;
}
const uuids = (n: number) =>
  Array.from({ length: n }, (_, i) => `${i.toString(16).padStart(8, "0")}-1111-4222-8333-444444444444`);

describe("the URL limit this actually hit", () => {
  it("one id really does cost about 40 characters", () => {
    expect(uuids(1)[0]).toHaveLength(36);
    // Plus the %2C separator PostgREST puts between them.
    expect(inClauseUrl(uuids(2)).length - inClauseUrl(uuids(1)).length).toBe(39);
  });

  it("a full queue sits ON the 8KB request line, with no headroom", () => {
    // MEASURED, not assumed. CLAUDE.md says "~200 ids blows the ~8KB limit";
    // modelled exactly, 200 ids is 7,932 bytes — 97% of the 8,192 line, and
    // that is with the SHORTEST possible query. The real one is longer than
    // this model (a longer project ref, an `order`, a `limit`), so 200 is
    // already over in production and 210 is over even here.
    const LIMIT = 8192;
    expect(inClauseUrl(uuids(200)).length).toBeGreaterThan(LIMIT * 0.95);
    expect(inClauseUrl(uuids(210)).length).toBeGreaterThan(LIMIT);
    // Which is the point of chunking at 150 rather than trimming to 200: the
    // helper's chunk leaves a quarter of the budget spare, so no future filter
    // added to this query can push it over.
    expect(inClauseUrl(uuids(150)).length).toBeLessThan(LIMIT * 0.75);
  });

  it("the 200 comes from the ramp, not from a guess", () => {
    expect(AUTOPILOT).toMatch(/reaches 200\/day/);
    // …and the auto-queue fills TO that number, so the queue sits at it.
    expect(AUTOPILOT).toContain("const need = target - (already ?? 0);");
  });
});

describe("chunking returns exactly the same answer", () => {
  /** A fake table: 200 queued prospects, 137 of them still 'ready'. */
  const queuedIds = uuids(200);
  const readySet = new Set(queuedIds.slice(0, 137));

  /** Stands in for PostgREST: refuses an over-long URL exactly as the real one does. */
  function fakeQuery(chunk: string[]) {
    const rows = chunk.filter((id) => readySet.has(id)).map((id) => ({ id }));
    return {
      range: async (from: number, to: number) => {
        // The same 8,192 line the test above measures against.
        if (inClauseUrl(chunk).length > 8192) {
          return { data: null, error: { message: "414 URI Too Long" } };
        }
        return { data: rows.slice(from, to + 1), error: null };
      },
    };
  }

  it("counts every queued-and-ready prospect", async () => {
    const rows = await selectAllRowsByIds<{ id: string }>(queuedIds, fakeQuery);
    expect(new Set(rows.map((r) => r.id)).size).toBe(137);
  });

  it("the unchunked call this replaced returns NOTHING once it crosses", async () => {
    // The bug, executed. One query carrying every id: over the line, 414, and
    // the old code read that null as zero and subtracted nothing at all.
    const overTheLine = uuids(210);
    const { data } = await fakeQuery(overTheLine).range(0, 999);
    expect(data).toBeNull();

    // The old code's exact arithmetic, fed the response it actually got.
    // (Derived rather than a literal `null ?? 0` — tsc rightly calls that
    // "always nullish", and a test that has to be written unnaturally to
    // compile is usually describing the bug wrong.)
    const failedCount: number | null = data === null ? null : (data as unknown[]).length;
    const readyStatusCount = 400;
    const oldReadyTotal = readyStatusCount - (failedCount ?? 0);
    const newReadyTotal = readyStatusCount - 137;
    expect(oldReadyTotal).toBe(400); // "400 researched prospects ready to send" …
    expect(newReadyTotal).toBe(263); // … while 137 of them are already queued.

    // And chunked, the same 210 ids answer fine.
    const rows = await selectAllRowsByIds<{ id: string }>(overTheLine, fakeQuery);
    expect(new Set(rows.map((r) => r.id)).size).toBe(137);
  });

  it("chunk boundaries don't drop or double-count anyone", async () => {
    // 200 ids at 150 per chunk is a 150/50 split, so the boundary is exercised.
    const rows = await selectAllRowsByIds<{ id: string }>(queuedIds, fakeQuery);
    expect(rows).toHaveLength(137);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  it("an empty queue costs no request at all", async () => {
    let calls = 0;
    const rows = await selectAllRowsByIds<{ id: string }>([], (c) => {
      calls += 1;
      return fakeQuery(c);
    });
    expect(rows).toEqual([]);
    expect(calls).toBe(0);
  });
});

describe("both surfaces are fixed, and stay in step", () => {
  it.each([
    ["the Jarvis page", () => JARVIS],
    ["the dashboard", () => DASHBOARD],
  ])("%s chunks the queued∩ready lookup", (_label, get) => {
    const src = get();
    expect(src).toContain("selectAllRowsByIds<{ id: string }>(");
    expect(src).toContain('.in("id", chunk)');
  });

  it.each([
    ["the Jarvis page", () => JARVIS],
    ["the dashboard", () => DASHBOARD],
  ])("%s no longer puts the whole queue in one URL", (_label, get) => {
    expect(get()).not.toContain('.in("id", queuedIds)');
  });

  it.each([
    ["the Jarvis page", () => JARVIS],
    ["the dashboard", () => DASHBOARD],
  ])("%s counts DISTINCT prospects, not returned rows", (_label, get) => {
    // Chunks are concatenated, so a naive .length would be right only by
    // accident. Ids are unique per prospect, so the Set is exact.
    expect(get()).toContain("new Set(queuedReadyRows.map((r) => r.id)).size");
  });

  it("they still subtract the same overlap from the same base", () => {
    // The whole point of the block: these two numbers must agree with each
    // other and with the list the click lands on.
    expect(JARVIS).toContain("readyAdjusted = Math.max(0, readyAdjusted - readyAlreadyQueued)");
    expect(DASHBOARD).toContain("(readyStatusCount ?? 0) - queuedReadyCount");
  });
});

describe("the queued banner reports a total, not a window", () => {
  it("asks for the count on the request it was already making", () => {
    // `.limit(500)` bounds the rows; the count rides in the Content-Range
    // header of the same request, so this costs no extra round trip.
    expect(JARVIS).toContain('.select("prospect_id", { count: "exact" })');
  });

  it("never reports fewer than the rows it holds", () => {
    // A failed count read must not turn a full queue into "0 emails queued" —
    // the same floor rule the morning brief uses.
    expect(JARVIS).toContain("Math.max(queuedTotalRaw ?? 0, queuedRows.length)");
  });

  it("that number is what the send-now confirmation quotes", () => {
    // "Send the N queued emails right now, for real" — understating N there is
    // asking for consent to something bigger than what was described.
    const panel = readFileSync(
      path.join(ROOT, "components", "growth", "email-autopilot.tsx"),
      "utf8"
    );
    expect(panel).toContain("Send the ${queuedCount} queued email");
    expect(panel).toContain("{queuedCount}{\" \"}");
  });
});
