import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveChaseDate, addDays } from "./dates";

/**
 * Marking a meeting no-show or cancelled wrote a line to the prospect's
 * timeline that was not always true.
 *
 * The UPDATE carried `.is("next_follow_up_at", null)` — correct, and the same
 * "never move a date already in the diary" rule as K7. But the activity was
 * written as "follow-up set for <date>" REGARDLESS of whether that update
 * matched a row. So a prospect who already had a chase booked got a timeline
 * entry naming a date that was never written.
 *
 *     lead's date   marked      stored        timeline said
 *     ───────────   ─────────   ───────────   ─────────────────────────
 *     none          no-show     tomorrow      follow-up set for tomorrow  ✓
 *     Fri 7 Aug     no-show     Fri 7 Aug     follow-up set for 4 Aug     ✗
 *     Oct nurture   cancelled   Oct           follow-up set for 6 Aug     ✗
 *
 * The October one is the sting: a lead who said "come back after the summer"
 * keeps their date (right), and the record Jude reads before the next call
 * told him it had been pulled forward eight weeks.
 *
 * "Reporting success for work that didn't happen", on the timeline — which is
 * the surface that has to be trusted, because it is the only place the promise
 * was ever visible.
 *
 * Fixed by routing through resolveChaseDate, the shared rule addActivity,
 * logNoAnswer and recordOutreachSent already use, and saying which of the two
 * actually happened.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const ACTIONS = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "meetings", "actions.ts"),
  "utf8"
);
const FN = ACTIONS.slice(
  ACTIONS.indexOf("export async function setMeetingStatus"),
  ACTIONS.indexOf("export async function syncStrategyBookings")
);

const TODAY = "2026-08-03";
/** The fallbacks the action uses: no-show tomorrow, cancelled in three days. */
const FALLBACK = { no_show: 1, cancelled: 3 } as const;

describe("what the timeline now says matches what was stored", () => {
  it("a lead with no date gets one, and is told so", () => {
    const chase = resolveChaseDate(null, TODAY, FALLBACK.no_show);
    expect(chase.kept).toBe(false);
    // This used to read `dublinDate(FALLBACK.no_show)`, with a comment saying
    // the fallback was computed from the real clock rather than from `today`.
    // That WAS true, and it was the bug: the function compared against the
    // caller's `today` and then counted forward from Dublin's, so it answered
    // two different questions in one call. It went red for the hour between
    // 23:00 UTC and Dublin midnight every summer night. Both halves now use
    // the `today` they were given.
    expect(chase.date).toBe(addDays(TODAY, FALLBACK.no_show));
    expect(chase.date).toBe("2026-08-04");
  });

  it("a lead with a chase already booked KEEPS it — and the line says kept", () => {
    // The case the old line lied about.
    const chase = resolveChaseDate("2026-08-07", TODAY, FALLBACK.no_show);
    expect(chase).toEqual({ date: "2026-08-07", kept: true });
  });

  it("a deliberate long nurture is never pulled forward", () => {
    // "Come back after the summer" must survive a cancelled meeting.
    const chase = resolveChaseDate("2026-10-01", TODAY, FALLBACK.cancelled);
    expect(chase).toEqual({ date: "2026-10-01", kept: true });
  });

  it("a date already gone by IS rescheduled", () => {
    // Deliberate behaviour change, and the reason it is right: you just tried
    // them and they didn't show, so a chase that was due in July is spent.
    // Leaving it put the lead permanently "overdue" until it aged out to
    // gone-cold at 7 days. Same rule as the other three call sites.
    const chase = resolveChaseDate("2026-07-20", TODAY, FALLBACK.no_show);
    expect(chase.kept).toBe(false);
    expect(chase.date > TODAY).toBe(true);
  });

  it("no-show comes back sooner than a cancellation", () => {
    const noShow = resolveChaseDate(null, TODAY, FALLBACK.no_show);
    const cancelled = resolveChaseDate(null, TODAY, FALLBACK.cancelled);
    expect(noShow.date < cancelled.date).toBe(true);
  });

  it("a malformed stored date is not mistaken for a deliberate future one", () => {
    // Otherwise garbage in the column would suppress the chase entirely.
    //
    // The guard is a SHAPE check, and that is sufficient here rather than a
    // gap: ge_prospects.next_follow_up_at is a Postgres `date` (0013), so a
    // calendar-impossible value like "2026-13-99" is rejected on write and
    // cannot reach this function. Only genuinely shapeless values can, and
    // those are what this covers.
    for (const junk of ["", "soon", "next week", "  ", "2026/08/07"]) {
      expect(resolveChaseDate(junk, TODAY, FALLBACK.no_show).kept).toBe(false);
    }
  });
});

describe("the action routes through the shared rule", () => {
  it("calls resolveChaseDate rather than composing a date itself", () => {
    expect(ACTIONS).toContain('resolveChaseDate');
    expect(FN).toContain("resolveChaseDate(");
  });

  it("reads the prospect's current date before deciding", () => {
    // Without the read there is nothing to keep.
    expect(FN).toContain('.select("next_follow_up_at")');
    expect(FN.indexOf('.select("next_follow_up_at")')).toBeLessThan(
      FN.indexOf("resolveChaseDate(")
    );
  });

  it("writes one line for kept and a different one for scheduled", () => {
    expect(FN).toContain("chase kept for");
    expect(FN).toContain("follow-up scheduled for");
  });

  it("no longer claims a date unconditionally", () => {
    // The exact wording of the bug.
    const code = FN.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toContain("follow-up set for");
    expect(code).not.toContain('.is("next_follow_up_at", null)');
  });

  it("says so when the write FAILS, instead of naming a date anyway", () => {
    expect(FN).toContain("could NOT be scheduled");
    expect(FN).toContain("set the next step by hand");
  });

  it("keeps the fallbacks that were there: 1 day, 3 days", () => {
    expect(FN).toContain("no_show: 1");
    expect(FN).toContain("cancelled: 3");
  });

  it("refreshes the call list, whose tiering just changed", () => {
    expect(FN).toContain("revalidateProspectSurfaces(meeting.prospect_id)");
  });
});

describe("nothing about the working path changed", () => {
  it("still rejects an unknown status", () => {
    expect(FN).toContain('["booked", "completed", "cancelled", "no_show"].includes(status)');
  });

  it("still refuses a meeting that isn't there", () => {
    expect(FN).toContain('return { error: "Meeting not found." }');
  });

  it("still checks the meeting update's own error first", () => {
    expect(FN.indexOf("const { error } = await admin")).toBeLessThan(
      FN.indexOf("resolveChaseDate(")
    );
  });

  it("still only acts on a real change, and never on 'booked'", () => {
    expect(FN).toContain('status !== meeting.status && status !== "booked"');
  });

  it("a COMPLETED meeting still sets no chase date", () => {
    // Completed is a good outcome; the next step is a proposal, not a chase.
    expect(FN).toContain("const days = fallbackDays[status]");
    expect(FN).toContain("days !== undefined");
  });

  it("still logs the outcome to the timeline", () => {
    expect(FN).toContain('type: "meeting"');
    expect(FN).toContain("marked by ${member.name}");
  });
});
