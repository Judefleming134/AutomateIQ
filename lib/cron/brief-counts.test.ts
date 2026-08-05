import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The morning brief is the one thing Jude reads every day at 07:00, and the
 * numbers in it are how he decides whether the engine ran.
 *
 * Three of them were the size of a DISPLAY LIMIT, not a measurement:
 *
 *   "📤 SENT THIS MORNING (35)"        — the query was .limit(35)
 *   "🔴 STILL WAITING ON YOU (10)"     — the array was .slice(0, 10)
 *   "📬 DELIVERY ISSUES (15)"          — the query was .limit(15)
 *
 * The send ramp climbs from 20/day to 200/day in about six days (RAMP_STEP in
 * lib/growth/autopilot.ts). The morning it passes 35, the brief starts saying
 * "35 emails sent" whatever actually went — and keeps saying 35 forever. The
 * waiting-on-you section, which this file's own comments call "the one section
 * that exists to be trusted", froze at 10. Delivery issues — the ground truth
 * on whether the sending domain is in trouble — froze at 15, in the direction
 * that under-reports trouble.
 *
 * Every capped list in the brief now carries a separately-counted total, and
 * says how many it isn't showing.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const BRIEF = readFileSync(path.join(ROOT, "lib", "cron", "jarvis-morning-brief.ts"), "utf8");
const AUTOPILOT = readFileSync(path.join(ROOT, "lib", "growth", "autopilot.ts"), "utf8");

describe("the numbers are measurements, not display limits", () => {
  it("counts what was sent this morning separately from what it lists", () => {
    expect(BRIEF).toContain('.select("id", { count: "exact", head: true })');
    expect(BRIEF).toContain("const sentTodayTotal");
    // And no sentence reports the capped array's length any more.
    expect(BRIEF).not.toMatch(/\$\{\(sentToday \?\? \[\]\)\.length\}/);
  });

  it("counts everyone still waiting, not the ten it prints", () => {
    expect(BRIEF).toContain("const awaitingTotal = stillWaiting.length;");
    expect(BRIEF).toContain("STILL WAITING ON YOU (${awaitingTotal})");
    expect(BRIEF).not.toContain("STILL WAITING ON YOU (${awaitingLines.length})");
  });

  it("counts every delivery problem, not the fifteen it prints", () => {
    expect(BRIEF).toContain("const deliveryTotal");
    expect(BRIEF).toContain("DELIVERY ISSUES (${deliveryTotal})");
    expect(BRIEF).not.toContain("DELIVERY ISSUES (${deliveryLines.length})");
  });

  it("says how many it is NOT showing, in all three sections", () => {
    // A header that says 200 above a list of 35 is its own confusion. Each
    // capped block now closes the gap out loud.
    expect(BRIEF).toContain("sentTodayTotal - (sentToday ?? []).length");
    expect(BRIEF).toContain("awaitingTotal - awaitingLines.length");
    expect(BRIEF).toContain("deliveryTotal - deliveryLines.length");
  });

  it("never reports fewer than it can actually list", () => {
    // If a count read fails and returns null, the rows in hand are a floor —
    // reporting 0 while printing 35 lines would be worse than the bug.
    expect(BRIEF).toContain("Math.max(sentTodayTotalRaw ?? 0, (sentToday ?? []).length)");
    expect(BRIEF).toContain("Math.max(deliveryTotalRaw ?? 0, (deliveryActs ?? []).length)");
  });

  it("keeps the counts cheap — head:true fetches no rows", () => {
    const heads = BRIEF.match(/count: "exact", head: true/g) ?? [];
    expect(heads.length).toBeGreaterThanOrEqual(4);
  });
});

describe("the sections that already had real totals still do", () => {
  it("follow-ups due, ready to send and the nightly log are unchanged", () => {
    for (const name of ["dueTotal", "readyTotal", "nightlyTotal"]) {
      expect(BRIEF, name).toContain(name);
    }
  });
});

describe("the cap this outgrew is real", () => {
  it("the send ramp genuinely climbs past every one of these limits", () => {
    // Not a hypothetical: the ramp's own comment says it reaches 200/day from
    // 20 in about six days.
    expect(AUTOPILOT).toContain("const RAMP_FLOOR = 20");
    expect(AUTOPILOT).toMatch(/reaches 200\/day/);
  });
});

/**
 * The two readers the fix above never reached.
 *
 * `nightlyTotal` — the real count of what Jarvis caught and fixed overnight —
 * was computed, and then used by the BLOCK HEADER only. The weekend subject
 * line and the cron's own summary both went on reading `nightlyLines.length`:
 * the length of a list `.limit(20)` had already truncated.
 *
 * So on a night with 63 catches, the email arrived titled
 *
 *   "Jarvis weekend brief — 2026-08-08: 12 added, 20 overnight fixes, 3 replies"
 *
 * and the body of that same email said "CATCHES & FIXES (63)". The push
 * notification and the thing it opens disagreed about the one number the
 * notification existed to carry — CLAUDE.md's "a count that doesn't match what
 * its click-through shows", where the click-through is the email itself.
 *
 * Both now read one named total.
 */
describe("the overnight-fix count is the same number everywhere it appears", () => {
  it("is named once, from the counted total", () => {
    expect(BRIEF).toContain("const nightlyFixTotal = nightlyTotal ?? nightlyLines.length;");
  });

  it("the block header, the weekend subject and the cron summary all use it", () => {
    expect(BRIEF).toContain("CATCHES & FIXES (${nightlyFixTotal})");
    expect(BRIEF).toContain("${nightlyFixTotal} overnight fixes, ${replyCountLabel} replies");
    expect(BRIEF).toContain("(${replyCountLabel} replies, ${nightlyFixTotal} overnight fixes)");
  });

  it("nothing reports the truncated list's length as a total any more", () => {
    // The exact shape of the bug, in both places it lived.
    expect(BRIEF).not.toContain("${nightlyLines.length} overnight fixes");
    // `nightlyLines.length` survives ONLY where it is genuinely the count of
    // printed lines: the fallback, the "…and N more" arithmetic (twice) and
    // the "is there anything to print" guard. Comment lines are stripped first
    // — the note explaining the bug quotes the old expression, and a test that
    // fires on its own documentation is one that gets weakened to shut it up.
    const code = BRIEF.split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
    const uses = code.match(/nightlyLines\.length/g) ?? [];
    expect(uses.length).toBe(4);
  });

  it("still falls back to the printed lines if the count read failed", () => {
    // Same rule as sentTodayTotal and deliveryTotal: a null count must not
    // report zero above a list of twenty.
    expect(BRIEF).toContain("nightlyTotal ?? nightlyLines.length");
  });
});

/**
 * The needle-mover line said "Yesterday" about a window that runs to right now.
 *
 * Every count in that block is `.gte(..., since24h)` with NO upper bound, and
 * the 07:00 dispatch runs the autopilot BEFORE it builds the brief
 * (emailAutopilot → brief, in app/api/cron/dispatch/route.ts). So this
 * morning's send is inside "yesterday".
 *
 * Which printed the same emails twice under two headings — "📤 SENT THIS
 * MORNING (30)" and "Yesterday: 30 sent" — and read as sixty. "Sent" is the
 * number Jude uses to decide whether the engine ran at all.
 *
 * The window is deliberately unchanged: the score compares it against a 7-day
 * window built the same way, so moving the boundary would move the score. The
 * label was the false part.
 */
describe("the needle-mover window is labelled as what it measures", () => {
  const DISPATCH = readFileSync(
    path.join(ROOT, "app", "api", "cron", "dispatch", "route.ts"),
    "utf8"
  );

  it("no longer calls a to-this-instant window 'Yesterday'", () => {
    expect(BRIEF).not.toContain("`Yesterday: ${nmSentY");
  });

  it("says what it is, and names the overlap beside the number it affects", () => {
    expect(BRIEF).toContain("`Last 24h: ${nmSentY ?? 0} sent (includes this morning's autopilot run)");
  });

  it("the overlap it warns about is real — the send runs before the brief", () => {
    // If this ever stopped being true the note would be the wrong caveat, so
    // it is pinned to the dispatch order rather than to a memory of it.
    const sendAt = DISPATCH.indexOf('isolated("emailAutopilot"');
    const briefAt = DISPATCH.indexOf('isolated("jarvisBrief"');
    expect(sendAt).toBeGreaterThan(-1);
    expect(briefAt).toBeGreaterThan(-1);
    expect(sendAt).toBeLessThan(briefAt);
  });

  it("the window itself is untouched — only the label moved", () => {
    // The score's baseline is a 7-day window built the same way; changing one
    // side and not the other would silently rescore every morning.
    expect(BRIEF).toContain('.gte("sent_at", since24h)');
    expect(BRIEF).toContain('.gte("sent_at", since7d)');
    expect(BRIEF).toContain("nmDailyAvg");
  });

  it("SENT THIS MORNING is still its own, differently-bounded number", () => {
    // It counts from today's Dublin midnight, not a rolling 24h — which is why
    // the two can never be added together.
    expect(BRIEF).toContain('.gte("sent_at", `${today}T00:00:00`)');
  });
});
