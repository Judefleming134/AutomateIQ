import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { splitMeetings, type OrderableMeeting } from "@/lib/growth/meeting-order";

/**
 * The dashboard's "Upcoming meetings" panel filtered and ordered on the raw
 * `scheduled_at` column, which holds TWO different things:
 *
 *   a booking-page slot  Irish wall-clock stored AS UTC (14:00 -> 14:00Z)
 *   a manual meeting     a true instant
 *
 * Comparing both against real UTC now is an hour wrong for bookings in Irish
 * summer time. The panel's own RENDER already knew — it picks the timezone per
 * row (`m.strategy_booking_id ? "UTC" : "Europe/Dublin"`) — so the page showed
 * the right time and filtered on the wrong one. Exactly the shape of the
 * prospect-timeline bug in #531 and the meetings-page bug in #523.
 *
 * Two visible consequences, both on the first page Jude opens.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/** 13:30 Irish on a summer day = 12:30Z. */
const NOW = new Date("2026-08-05T12:30:00Z");

const booking = (id: string, wall: string): OrderableMeeting & { id: string } => ({
  id,
  scheduled_at: `${wall}:00+00:00`,
  strategy_booking_id: `bk-${id}`,
  status: "booked",
});

const manual = (id: string, instant: string): OrderableMeeting & { id: string } => ({
  id,
  scheduled_at: `${instant}:00.000Z`,
  strategy_booking_id: null,
  status: "booked",
});

/** What the raw-column query did: everything at or after real UTC now. */
const rawUpcoming = <T extends OrderableMeeting>(rows: T[], at: Date) =>
  rows
    .filter((m) => m.scheduled_at >= at.toISOString())
    .sort((a, b) => (a.scheduled_at < b.scheduled_at ? -1 : 1));

describe("a session already underway drops off", () => {
  it("does not list a booking that started half an hour ago", () => {
    // Irish 13:00 booking, stored 13:00Z. It is 13:30 Irish — it has started.
    const rows = [booking("started-13:00", "2026-08-05T13:00")];
    expect(splitMeetings(rows, NOW).upcoming).toEqual([]);
    // The raw comparison kept it: "13:00Z" >= "12:30Z" is true.
    expect(rawUpcoming(rows, NOW).map((m) => m.id)).toEqual(["started-13:00"]);
  });

  it("still lists one that genuinely has not happened", () => {
    const rows = [booking("later-16:00", "2026-08-05T16:00")];
    expect(splitMeetings(rows, NOW).upcoming.map((m) => m.id)).toEqual(["later-16:00"]);
  });
});

describe("a booking cannot outrank a meeting that is genuinely sooner", () => {
  it("orders the two frames against each other correctly", () => {
    // Booking stored 15:00Z is Irish 15:00 = 14:00Z real.
    // Manual stored 14:30Z is 14:30Z real — half an hour LATER.
    const rows = [
      manual("manual-14:30Z", "2026-08-05T14:30"),
      booking("booking-15:00-irish", "2026-08-05T15:00"),
    ];
    expect(splitMeetings(rows, NOW).upcoming.map((m) => m.id)).toEqual([
      "booking-15:00-irish",
      "manual-14:30Z",
    ]);
    // Sorting the raw column put them the other way round.
    expect(rawUpcoming(rows, NOW).map((m) => m.id)).toEqual([
      "manual-14:30Z",
      "booking-15:00-irish",
    ]);
  });

  it("still puts the soonest first among meetings of one kind", () => {
    const rows = [
      manual("late", "2026-08-06T09:00"),
      manual("soon", "2026-08-05T15:00"),
    ];
    expect(splitMeetings(rows, NOW).upcoming.map((m) => m.id)).toEqual(["soon", "late"]);
  });

  it("in winter the two frames agree and nothing changes", () => {
    const winter = new Date("2026-01-07T12:30:00Z");
    const rows = [
      booking("b-15:00", "2026-01-07T15:00"),
      manual("m-14:30", "2026-01-07T14:30"),
    ];
    expect(splitMeetings(rows, winter).upcoming.map((m) => m.id)).toEqual([
      "m-14:30",
      "b-15:00",
    ]);
  });
});

describe("the dashboard wiring", () => {
  const DASH = readFileSync(
    path.join(ROOT, "app", "growth", "(app)", "page.tsx"),
    "utf8"
  );

  it("over-fetches so the two frames can be resolved in memory", () => {
    // An exact `gte(now)` cannot be right for both frames at once, so the
    // window is deliberately wide and the real filtering happens after.
    expect(DASH).toContain("12 * 3600 * 1000");
    expect(DASH).toContain(".limit(24)");
  });

  it("filters and orders with the shared helper", () => {
    expect(DASH).toContain("splitMeetings(");
    expect(DASH).toContain("const nextMeetings");
    // And renders from the corrected list, not the raw rows.
    expect(DASH).toContain("{nextMeetings.map((m) => (");
    expect(DASH).not.toContain("{(upcomingMeetings ?? []).map((m) => (");
  });

  it("shares the rule with the meetings page it links to", () => {
    // The panel has an "All →" link. The two must not disagree about what is
    // next.
    expect(DASH).toContain('from "@/lib/growth/meeting-order"');
  });

  it("keeps the per-row timezone the render always had right", () => {
    expect(DASH).toContain('timeZone: m.strategy_booking_id ? "UTC" : "Europe/Dublin"');
  });

  it("the empty state says what fills it", () => {
    // A booked session is the entire point of the engine, and this was a full
    // stop on the page Jude opens first.
    const from = DASH.indexOf("Nothing booked yet.");
    expect(from, "empty state not found").toBeGreaterThan(-1);
    expect(DASH.slice(from, from + 300)).toContain("/growth/call-list");
    expect(DASH).not.toContain("No meetings booked yet.");
  });
});
