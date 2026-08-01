import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  splitMeetings,
  meetingInstant,
  hasPassed,
  type OrderableMeeting,
} from "@/lib/growth/meeting-order";

/**
 * The meetings page exists to answer one question: what is coming up next?
 *
 * It sorted "Upcoming" soonest-first — with a comment explaining exactly why
 * that mattered — and then reversed the result at render, putting the
 * furthest-away meeting back at the top. The next session was the last thing
 * on the page for the whole life of the fix that was meant to correct it.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/** Summer: Irish time is UTC+1, so the two frames genuinely disagree. */
const SUMMER_NOW = new Date("2026-08-05T09:00:00Z"); // 10:00 Irish

const booking = (id: string, wallClock: string, status = "booked"): OrderableMeeting & { id: string } => ({
  id,
  // Stored Irish wall-clock wearing a UTC label, the way the booking page does.
  scheduled_at: `${wallClock}:00+00:00`,
  strategy_booking_id: `bk-${id}`,
  status,
});

const manual = (id: string, instant: string, status = "booked"): OrderableMeeting & { id: string } => ({
  id,
  scheduled_at: `${instant}:00.000Z`,
  strategy_booking_id: null,
  status,
});

describe("what is coming up next is at the top", () => {
  it("orders upcoming soonest first", () => {
    // Arriving in the query's DESCENDING order, as they really do.
    const { upcoming } = splitMeetings(
      [
        manual("friday", "2026-08-07T14:00"),
        manual("thursday", "2026-08-06T14:00"),
        manual("today", "2026-08-05T14:00"),
      ],
      SUMMER_NOW
    );
    expect(upcoming.map((m) => m.id)).toEqual(["today", "thursday", "friday"]);
  });

  it("puts the next meeting first even when it arrives last", () => {
    // THE regression. A render-time .reverse() on top of the sort put this
    // meeting at the bottom.
    const { upcoming } = splitMeetings(
      [manual("later", "2026-08-30T09:00"), manual("next", "2026-08-05T15:00")],
      SUMMER_NOW
    );
    expect(upcoming[0].id).toBe("next");
  });

  it("orders a single meeting without incident", () => {
    const { upcoming } = splitMeetings([manual("only", "2026-08-06T09:00")], SUMMER_NOW);
    expect(upcoming.map((m) => m.id)).toEqual(["only"]);
  });
});

describe("bookings and manual meetings sort in the same frame", () => {
  it("a 14:00 booking is really 13:00Z in summer", () => {
    expect(meetingInstant(booking("b", "2026-08-05T14:00"))).toBe("2026-08-05T13:00:00.000Z");
  });

  it("a manual meeting is already an instant and is left alone", () => {
    expect(meetingInstant(manual("m", "2026-08-05T14:00"))).toBe("2026-08-05T14:00:00.000Z");
  });

  it("interleaves the two correctly rather than an hour apart", () => {
    // Irish wall-clock: booking at 14:00, manual at 14:30 UTC = 15:30 Irish.
    // Sorting the raw column would put the manual meeting first.
    const { upcoming } = splitMeetings(
      [manual("manual-1330Z", "2026-08-05T13:30"), booking("booking-1400", "2026-08-05T14:00")],
      SUMMER_NOW
    );
    expect(upcoming.map((m) => m.id)).toEqual(["booking-1400", "manual-1330Z"]);
  });

  it("in winter the two frames agree", () => {
    const winter = new Date("2026-01-07T09:00:00Z");
    expect(meetingInstant(booking("b", "2026-01-07T14:00"))).toBe("2026-01-07T14:00:00.000Z");
    const { upcoming } = splitMeetings(
      [manual("m", "2026-01-07T15:00"), booking("b", "2026-01-07T14:00")],
      winter
    );
    expect(upcoming.map((m) => m.id)).toEqual(["b", "m"]);
  });
});

describe("a call that has happened stops being 'upcoming'", () => {
  it("moves a passed booking to awaiting outcome", () => {
    const { upcoming, awaitingOutcome } = splitMeetings(
      [booking("done", "2026-08-05T09:00"), booking("later", "2026-08-05T16:00")],
      SUMMER_NOW
    );
    expect(upcoming.map((m) => m.id)).toEqual(["later"]);
    expect(awaitingOutcome.map((m) => m.id)).toEqual(["done"]);
  });

  it("compares a booking against IRISH now, not UTC now", () => {
    // 09:30 Irish, which is 08:30Z. A booking stored 09:30 has NOT passed.
    // Comparing it against real UTC now (09:00Z) would say it had, and drop a
    // session that hasn't happened into "Awaiting outcome" with its outcome
    // buttons showing.
    const at = new Date("2026-08-05T08:00:00Z"); // 09:00 Irish
    expect(hasPassed(booking("b", "2026-08-05T09:30"), at)).toBe(false);
    expect(hasPassed(booking("b", "2026-08-05T08:30"), at)).toBe(true);
  });

  it("a passed booking is never lost — it is in exactly one list", () => {
    const rows = [booking("done", "2026-08-05T09:00"), booking("later", "2026-08-05T16:00")];
    const { upcoming, awaitingOutcome, past } = splitMeetings(rows, SUMMER_NOW);
    expect(upcoming.length + awaitingOutcome.length + past.length).toBe(rows.length);
  });
});

describe("the past list", () => {
  it("holds everything not still booked, newest first as the query returned it", () => {
    const { past, upcoming, awaitingOutcome } = splitMeetings(
      [
        manual("c1", "2026-08-04T14:00", "completed"),
        manual("c2", "2026-08-03T14:00", "no_show"),
        manual("c3", "2026-08-02T14:00", "cancelled"),
        manual("open", "2026-08-06T14:00"),
      ],
      SUMMER_NOW
    );
    expect(past.map((m) => m.id)).toEqual(["c1", "c2", "c3"]);
    expect(upcoming.map((m) => m.id)).toEqual(["open"]);
    expect(awaitingOutcome).toEqual([]);
  });

  it("handles an empty list", () => {
    expect(splitMeetings([], SUMMER_NOW)).toEqual({
      upcoming: [],
      awaitingOutcome: [],
      past: [],
    });
  });

  it("does not mutate the array it was given", () => {
    const rows = [manual("b", "2026-08-07T14:00"), manual("a", "2026-08-06T14:00")];
    splitMeetings(rows, SUMMER_NOW);
    expect(rows.map((m) => m.id)).toEqual(["b", "a"]);
  });
});

describe("the page uses the shared ordering and does not re-order it", () => {
  const PAGE = readFileSync(
    path.join(ROOT, "app", "growth", "(app)", "meetings", "page.tsx"),
    "utf8"
  );

  it("takes all three lists from splitMeetings", () => {
    expect(PAGE).toContain("splitMeetings(meetings ?? [])");
  });

  it("does NOT reverse the upcoming list at render", () => {
    // The whole bug: a sort followed by a reverse is the sort undone.
    expect(PAGE).not.toMatch(/upcoming\]?\s*\.reverse\(\)/);
    expect(PAGE).toContain("{upcoming.map((m) => (");
  });
});
