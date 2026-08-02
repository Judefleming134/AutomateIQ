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
