import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { computeGrowthMetrics, type GrowthData } from "./metrics";

/**
 * `fetchGrowthData` took a `sinceIso` bound, documented it in detail, and then
 * never used it.
 *
 *     async function fetchGrowthData(admin, withSolutions = true, sinceIso = null)
 *
 *     grep -n "sinceIso" lib/growth/metrics.ts
 *       127:  * @param sinceIso When every requested window is bounded, …
 *       135:    sinceIso: string | null = null
 *
 * Two mentions: the docstring, and the parameter. `windowFloor()` — a function
 * with its own careful reasoning about "a single null makes the whole load
 * unbounded" and "a day of slack past the boundary, so clock skew can never
 * drop a row" — computed a value that was passed in and thrown away.
 *
 * So every "last 30 days" load paged the ENTIRE message history into memory,
 * including `/growth` itself, the engine's home page and the most-loaded screen
 * there is. And the file said it didn't. That is the perf equivalent of CLAUDE
 * .md's "reporting success for work that didn't happen": a guarantee written
 * down, relied on by its own callers, and not implemented.
 *
 * The bound is now applied — carefully, because three kinds of row below the
 * floor still matter, and dropping any of them would break a tile:
 *
 *   · created_at inside the window — ordinary activity, the only instant
 *     `inbound` is filtered on.
 *   · sent_at inside the window — a draft written BEFORE the floor and sent
 *     inside it. `sent` filters on `sent_at ?? created_at`, and overnight
 *     drafting + the 07:00 cron makes that split routine, so bounding on
 *     created_at alone would silently undercount sends.
 *   · still draft or queued — the "Outreach prepared" tile is LIFETIME by
 *     construction. A draft from six months ago must still be counted. This is
 *     the "(bar pending ones)" the docstring already promised.
 *
 * The proof below is not "the filter looks right": it computes every metric
 * over the full fixture and over the bounded subset and requires the two to be
 * IDENTICAL. If the bound ever drops a row that matters, that test fails with
 * the metric named.
 *
 * Unbounded callers are untouched. Jarvis and the morning brief ask for
 * [null, 7]; windowFloor returns null for that and the filter is skipped, so
 * the 07:00 path loads exactly what it loaded before.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SRC = readFileSync(path.join(ROOT, "lib", "growth", "metrics.ts"), "utf8");

const DAY = 24 * 60 * 60 * 1000;
// One NOW for the whole fixture, so `iso(40)` is the same string every time it
// is called. computeGrowthMetrics reads the real clock for its own boundary;
// a few milliseconds of drift is nothing against day-scale offsets.
const NOW = Date.now();
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

/** The floor windowFloor() produces for a 30-day window: 31 days back. */
const FLOOR = iso(31);

/** The predicate the PostgREST .or() expresses, in JS. */
const keep = (m: GrowthData["messages"][number], since: string) =>
  m.created_at >= since ||
  (m.sent_at != null && m.sent_at >= since) ||
  m.status === "draft" ||
  m.status === "queued";

const msg = (
  p: Partial<GrowthData["messages"][number]> & { created_at: string }
): GrowthData["messages"][number] => ({
  prospect_id: "p1",
  campaign_id: "c1",
  channel: "email",
  direction: "outbound",
  status: "sent",
  sentiment: null,
  tone: "direct",
  sent_at: null,
  ...p,
});

/** A history that spans well past the floor, with every awkward row in it. */
const data: GrowthData = {
  prospects: [
    { id: "p1", status: "won", industry: "Roofing", campaign_id: "c1", pipeline_value: 4000, qualification_status: "qualified", created_at: iso(400) },
    { id: "p2", status: "meeting_booked", industry: "Plumbing", campaign_id: "c1", pipeline_value: 2000, qualification_status: null, created_at: iso(10) },
    { id: "p3", status: "contacted", industry: "Roofing", campaign_id: null, pipeline_value: null, qualification_status: null, created_at: iso(2) },
  ],
  messages: [
    // Inside the window — plainly kept.
    msg({ created_at: iso(5), sent_at: iso(5) }),
    msg({ created_at: iso(2), sent_at: iso(2), prospect_id: "p3" }),
    msg({ created_at: iso(1), direction: "inbound", status: "received", prospect_id: "p3", sentiment: "positive" }),
    // THE OVERNIGHT DRAFT: written before the floor, sent inside the window.
    msg({ created_at: iso(40), sent_at: iso(3), prospect_id: "p2", tone: "warm" }),
    // THE OLD BACKLOG: never sent, still sitting in the queue.
    msg({ created_at: iso(200), status: "queued", sent_at: null, prospect_id: "p2" }),
    msg({ created_at: iso(365), status: "draft", sent_at: null, prospect_id: "p1" }),
    // Genuinely irrelevant: sent and answered long before the window.
    msg({ created_at: iso(300), sent_at: iso(300), prospect_id: "p1" }),
    msg({ created_at: iso(299), direction: "inbound", status: "received", prospect_id: "p1", sentiment: "neutral" }),
    msg({ created_at: iso(120), sent_at: iso(120), prospect_id: "p1", tone: "warm" }),
  ],
  // Every inbound row above, with the columns the reply classifier needs.
  // Both are genuine replies here, so this fixture's numbers are unaffected by
  // the auto-reply filter — see reply-classification.test.ts for that.
  inboundDetail: [
    { prospect_id: "p3", created_at: iso(1), subject: "Re: quick question", body: "Interesting — what would this cost for 6 vans?" },
    { prospect_id: "p1", created_at: iso(299), subject: "Re: quick question", body: "Go on then, send me the details and I'll have a look." },
  ],
  meetings: [{ prospect_id: "p2", status: "booked", created_at: iso(4) }],
  campaigns: [{ id: "c1", name: "Roofers Q3", status: "active" }],
  research: [{ solutions: [{ name: "SiteIQ" }], created_at: iso(6) }],
  proposals: [{ status: "sent", updated_at: iso(8) }],
};

const bounded: GrowthData = {
  ...data,
  messages: data.messages.filter((m) => keep(m, FLOOR)),
};

describe("the bound drops rows, and changes no number", () => {
  it("it really does drop rows — otherwise this proves nothing", () => {
    expect(data.messages).toHaveLength(9);
    expect(bounded.messages).toHaveLength(6);
  });

  it("every metric for a 30-day window is identical either way", () => {
    // The whole safety argument, in one assertion.
    expect(computeGrowthMetrics(bounded, 30)).toEqual(computeGrowthMetrics(data, 30));
  });

  it.each([7, 30])("…and for a %i-day window too", (days) => {
    const floor = iso(days + 1);
    const subset = { ...data, messages: data.messages.filter((m) => keep(m, floor)) };
    expect(computeGrowthMetrics(subset, days)).toEqual(computeGrowthMetrics(data, days));
  });
});

describe("the three rows that had to survive it", () => {
  it("the overnight draft sent inside the window is still a send", () => {
    const overnight = data.messages.find((m) => m.created_at === iso(40))!;
    expect(overnight.created_at < FLOOR).toBe(true); // created before the floor
    expect(keep(overnight, FLOOR)).toBe(true); // kept anyway, on sent_at
    expect(computeGrowthMetrics(bounded, 30).outreachSent).toBe(3);
  });

  it("bounding on created_at ALONE would have lost it", () => {
    const naive = { ...data, messages: data.messages.filter((m) => m.created_at >= FLOOR) };
    expect(computeGrowthMetrics(naive, 30).outreachSent).toBe(2);
    expect(computeGrowthMetrics(data, 30).outreachSent).toBe(3);
  });

  it("the six-month-old queued and drafted rows still count as backlog", () => {
    const m = computeGrowthMetrics(bounded, 30);
    expect(m.queuedOutreach).toBe(1);
    expect(m.draftOutreach).toBe(1);
    expect(m).toMatchObject({
      queuedOutreach: computeGrowthMetrics(data, 30).queuedOutreach,
      draftOutreach: computeGrowthMetrics(data, 30).draftOutreach,
    });
  });

  it("dropping pending rows would empty the 'Outreach prepared' tile", () => {
    const naive = { ...data, messages: data.messages.filter((m) => m.created_at >= FLOOR) };
    expect(naive.messages.some((m) => m.status === "queued" || m.status === "draft")).toBe(false);
    expect(computeGrowthMetrics(naive, 30).queuedOutreach + computeGrowthMetrics(naive, 30).draftOutreach).toBe(0);
  });

  it("the tone table keeps the right sample — 'warm' sent inside the window", () => {
    const tones = computeGrowthMetrics(bounded, 30).toneStats;
    expect(tones).toEqual(computeGrowthMetrics(data, 30).toneStats);
    expect(tones.find((t) => t.tone === "warm")?.sent).toBe(1);
  });
});

describe("all-time callers are untouched", () => {
  it("windowFloor returns null the moment any window is all-time", () => {
    // Jarvis and the morning brief both ask for [null, 7].
    expect(SRC).toContain("if (windows.length === 0 || windows.some((w) => w === null || !Number.isFinite(w)))");
    expect(SRC).toContain("loadGrowthMetricsMulti");
  });

  it("and a null floor skips the filter entirely", () => {
    expect(SRC).toContain("return sinceIso");
    expect(SRC).toMatch(/\?\s*q\.or\(/);
    expect(SRC).toContain(": q;");
  });

  it("an all-time computation is unaffected by the bound anyway", () => {
    // Belt and braces: even if a bounded set reached an all-time compute, the
    // test names what would change rather than leaving it implied.
    expect(computeGrowthMetrics(data, null).outreachSent).toBe(5);
    expect(computeGrowthMetrics(bounded, null).outreachSent).toBe(3);
  });
});

describe("the filter is the one described", () => {
  it("all three clauses are present, on the right columns", () => {
    expect(SRC).toContain(
      "`created_at.gte.${sinceIso},sent_at.gte.${sinceIso},status.in.(draft,queued)`"
    );
  });

  it("it is applied to ge_messages and nothing else", () => {
    // The other five tables are lifetime by construction — prospectsTotal,
    // pipelineValue, won and qualified all read the full prospect set.
    expect((SRC.match(/q\.or\(/g) ?? [])).toHaveLength(1);
    const block = SRC.slice(SRC.indexOf('.from("ge_messages")'), SRC.indexOf('.from("ge_meetings")'));
    expect(block).toContain("sinceIso");
  });

  it("an unquoted ISO timestamp in .or() is the pattern already in use", () => {
    // lib/growth/awaiting.ts bounds the same column the same way.
    const awaiting = readFileSync(path.join(ROOT, "lib", "growth", "awaiting.ts"), "utf8");
    expect(awaiting).toContain("sent_at.gte.${floor}");
    expect(awaiting).toContain(".or(instantAtOrAfterFloor)");
  });
});
