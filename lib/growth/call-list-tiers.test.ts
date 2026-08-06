import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The call list stopped showing never-rung leads once it had been used.
 *
 * The page ranks three tiers, and says so on the screen:
 *
 *   0 — chase due today or overdue
 *   1 — nothing in the diary (never rung, or rung with no date agreed)
 *   2 — already spoken to, chase booked for a later day
 *
 * Tier 0 had its own query, added precisely because a score-ordered cap ran
 * before the tier sort and hid the most time-critical calls. Tier 1 did not.
 * It came out of the same top-160-by-score fetch as tier 2 — and tier 2 wins
 * that race by construction:
 *
 *   · the page's default order is best score first
 *   · the 07:00 autopilot picks the top-scored leads too
 *   · logging a call SCHEDULES A FOLLOW-UP AUTOMATICALLY
 *
 * So the highest-scored leads are exactly the ones that acquire a future chase
 * date and become tier 2. They then fill the score window from the top and
 * push every never-rung lead out of it. Replayed over 400 phone leads
 * (scratchpad/call-list-tiers.mjs):
 *
 *   called   uncalled   OLD due/new/booked   NEW due/new/booked
 *   0        400        0 / 40 / 0           0 / 40 / 0
 *   60       340        4 / 36 / 0           4 / 36 / 0
 *   200      200        6 /  0 / 34          6 / 34 / 0
 *   300      100        6 /  0 / 34          6 / 34 / 0
 *
 * At 200 called: forty cards, not one never-rung lead, two hundred sitting in
 * the database. Every card reading "chase booked for Fri 14 Aug — not due
 * yet". The list stops working exactly when it has been worked, and it looks
 * like it is working — full of cards, in the right order, all of them wrong.
 *
 * CLAUDE.md names the shape: "a score-ordered cap applied BEFORE the 'still to
 * work' filter, so the most urgent items never enter the list at all."
 *
 * Fixed the same way tier 0 was: tier 1 is exactly `next_follow_up_at is
 * null`, so it is asked for directly, best score first. Nothing else moved —
 * same tiers, same stable sort, same MAX_ITEMS, same cards.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const PAGE = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "call-list", "page.tsx"),
  "utf8"
);

const TODAY = "2026-08-06";
const LATER = "2026-08-14";
const OVERDUE = "2026-08-01";
const TOP_LIMIT = 160;
const DUE_LIMIT = 80;
const FRESH_LIMIT = 80;
const MAX_ITEMS = 40;

type Row = { id: string; lead_score: number; next_follow_up_at: string | null };

/** The page's own predicates. */
const isDue = (p: Row) => !!p.next_follow_up_at && p.next_follow_up_at.slice(0, 10) <= TODAY;
const bookedAhead = (p: Row) => !!p.next_follow_up_at && p.next_follow_up_at.slice(0, 10) > TODAY;
const tier = (p: Row) => (isDue(p) ? 0 : bookedAhead(p) ? 2 : 1);

const byScore = (a: Row, b: Row) => b.lead_score - a.lead_score;
const byDue = (a: Row, b: Row) =>
  String(a.next_follow_up_at).localeCompare(String(b.next_follow_up_at));

/**
 * A database that has been WORKED: the best `called` leads have been rung and
 * carry an agreed later date; the rest have never been touched.
 */
function db(total: number, called: number, due: number): Row[] {
  return Array.from({ length: total }, (_, i) => ({
    id: `p${i}`,
    lead_score: 100 - Math.floor((i / total) * 100),
    next_follow_up_at: i < called ? (i < due ? OVERDUE : LATER) : null,
  }));
}

/** The page's merge → dedupe → tier-sort → slice, with and without tier 1's query. */
function build(rows: Row[], withFreshQuery: boolean): Row[] {
  const dueRaw = rows.filter(isDue).sort(byDue).slice(0, DUE_LIMIT);
  const freshRaw = withFreshQuery
    ? rows.filter((p) => p.next_follow_up_at === null).sort(byScore).slice(0, FRESH_LIMIT)
    : [];
  const topRaw = [...rows].sort(byScore).slice(0, TOP_LIMIT);

  const seen = new Set<string>();
  const deduped = [...dueRaw, ...freshRaw, ...topRaw].filter((p) =>
    seen.has(p.id) ? false : (seen.add(p.id), true)
  );
  // Array.prototype.sort is stable, which is what preserves the within-tier
  // order the three queries established.
  return [...deduped].sort((a, b) => tier(a) - tier(b)).slice(0, MAX_ITEMS);
}

const count = (list: Row[], t: number) => list.filter((p) => tier(p) === t).length;

describe("the day the list stopped working", () => {
  it("a worked database hid EVERY never-rung lead", () => {
    const rows = db(400, 200, 6);
    expect(rows.filter((p) => p.next_follow_up_at === null)).toHaveLength(200);

    const old = build(rows, false);
    expect(old).toHaveLength(MAX_ITEMS);
    expect(count(old, 0)).toBe(6); // due chases — their own query saved them
    expect(count(old, 1)).toBe(0); // ← two hundred of them, none on the page
    expect(count(old, 2)).toBe(34); // "chase booked — not due yet", ×34
  });

  it("and the page looked completely healthy while doing it", () => {
    // Forty cards, correctly ordered, every one of them the wrong person.
    const old = build(db(400, 200, 6), false);
    expect(old).toHaveLength(40);
    expect(old.map(tier)).toEqual([...old.map(tier)].sort((a, b) => a - b));
  });

  it("the third query puts them back", () => {
    const now = build(db(400, 200, 6), true);
    expect(count(now, 0)).toBe(6);
    expect(count(now, 1)).toBe(34);
    expect(count(now, 2)).toBe(0);
  });

  it.each([
    // total, called, due, OLD tier-1 shown, NEW tier-1 shown
    [400, 0, 0, 40, 40],
    [400, 60, 4, 36, 36],
    [400, 200, 6, 0, 34],
    [400, 300, 6, 0, 34],
    [900, 500, 5, 0, 35],
  ])(
    "%i leads, %i called → OLD showed %i never-rung, NEW shows %i",
    (total, called, due, oldNew, newNew) => {
      const rows = db(total, called, due);
      expect(count(build(rows, false), 1)).toBe(oldNew);
      expect(count(build(rows, true), 1)).toBe(newNew);
    }
  );

  it("it only bites once the list has been USED — which is why it survived", () => {
    // On a fresh database the two are identical, so nothing looked wrong until
    // the page had been worked for a few weeks.
    const fresh = db(400, 0, 0);
    expect(build(fresh, false)).toEqual(build(fresh, true));
  });
});

describe("the tier order and everything in it is unchanged", () => {
  const rows = db(400, 200, 6);
  const list = build(rows, true);

  it("due chases still come first, most overdue first", () => {
    expect(list.slice(0, 6).every(isDue)).toBe(true);
  });

  it("never-rung leads come next, best score first", () => {
    const tier1 = list.filter((p) => tier(p) === 1);
    expect(tier1.map((p) => p.lead_score)).toEqual(
      [...tier1.map((p) => p.lead_score)].sort((a, b) => b - a)
    );
  });

  it("booked-ahead leads still appear — below, not removed", () => {
    // Nothing was taken away: with fewer never-rung leads to show, tier 2
    // fills the rest of the page exactly as before.
    const thin = build(db(400, 380, 6), true);
    expect(count(thin, 2)).toBeGreaterThan(0);
    expect(thin).toHaveLength(MAX_ITEMS);
  });

  it("a lead in two queries appears once", () => {
    const list2 = build(db(400, 200, 6), true);
    expect(new Set(list2.map((p) => p.id)).size).toBe(list2.length);
  });

  it("the page still shows at most MAX_ITEMS", () => {
    expect(build(db(900, 500, 5), true)).toHaveLength(MAX_ITEMS);
  });
});

describe("the page asks for tier 1 on its own terms", () => {
  it("there is a third query, filtered to an empty diary", () => {
    expect(PAGE).toContain('.is("next_follow_up_at", null)');
    expect(PAGE).toContain("{ data: freshRaw },");
  });

  it("it is ordered by score, like the tier it replaces rows from", () => {
    const q = PAGE.slice(
      PAGE.indexOf('.is("next_follow_up_at", null)'),
      PAGE.indexOf('.is("next_follow_up_at", null)') + 220
    );
    expect(q).toContain('.order("lead_score", { ascending: false, nullsFirst: false })');
    expect(q).toContain(".limit(80)");
  });

  it("it carries the SAME columns, so a card can't render short", () => {
    // All three selects use the one COLUMNS constant.
    expect((PAGE.match(/\.select\(COLUMNS\)/g) ?? [])).toHaveLength(3);
  });

  it("it is merged ahead of the score query, and deduped", () => {
    expect(PAGE).toContain(
      "const merged = [...(dueRaw ?? []), ...(freshRaw ?? []), ...(topRaw ?? [])];"
    );
    expect(PAGE).toContain("seen.has(p.id) ? false : (seen.add(p.id), true)");
  });

  it("all three run in the one Promise.all — no extra latency", () => {
    expect((PAGE.match(/await Promise\.all\(\[/g) ?? [])).toHaveLength(2); // this one + the research batch
    const wave = PAGE.slice(PAGE.indexOf("] = await Promise.all(["), PAGE.indexOf("// Distinct people worked today"));
    expect((wave.match(/\.from\("ge_prospects"\)/g) ?? [])).toHaveLength(4); // 3 tiers + the exact count
  });
});

describe("nothing else about the page moved", () => {
  it("the tiers, the cap and the sort are as they were", () => {
    expect(PAGE).toContain("const MAX_ITEMS = 40;");
    expect(PAGE).toContain("isDue(p) ? 0 : bookedAhead(p) ? 2 : 1;");
    expect(PAGE).toContain(
      "const prospects = [...workable].sort((a, b) => tier(a) - tier(b)).slice(0, MAX_ITEMS);"
    );
  });

  it("the due-chase query that fixed tier 0 is untouched", () => {
    expect(PAGE).toContain('.lte("next_follow_up_at", today)');
    expect(PAGE).toContain('.order("next_follow_up_at", { ascending: true })');
  });

  it("already-called-today still drops off, and the counts still exclude them", () => {
    expect(PAGE).toContain("const workable = deduped.filter((p) => !calledToday(p));");
    expect(PAGE).toContain('.in("type", ["call", "meeting"])');
  });

  it("Log call, No answer and the workspace link are all still on the card", () => {
    for (const s of ["Log call", "No answer", "Open workspace →", "logNoAnswer", "addActivity"]) {
      expect(PAGE, s).toContain(s);
    }
  });
});
