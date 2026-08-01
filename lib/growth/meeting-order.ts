/**
 * Ordering the meetings list.
 *
 * Two things make this harder than a sort on one column, and both have bitten
 * before:
 *
 * 1. TWO TIME FRAMES IN ONE COLUMN. A slot booked through the public page
 *    stores Irish wall-clock AS UTC (a 14:00 session is stored 14:00Z, because
 *    that is what the confirmation email told the customer). A meeting Jude
 *    records by hand stores a true instant. Sorting or comparing the raw
 *    column mixes the two, so in summer a 14:00 booking and a 14:00 manual
 *    meeting sit an hour apart.
 *
 * 2. THE QUERY IS DESCENDING, because the past lists want newest first.
 *    "Upcoming" wants the opposite, and getting that wrong puts the meeting
 *    happening NEXT at the bottom of the page whose entire job is telling you
 *    what is coming up.
 *
 * Pulled out of the page so it can be tested. The page did the same work
 * inline and got (2) wrong for the whole life of the fix that was meant to
 * correct it.
 */

import { dublinLocalToUtcISO } from "./dates";

export type OrderableMeeting = {
  scheduled_at: string;
  strategy_booking_id: string | null;
  status?: string | null;
};

/**
 * The real instant a meeting happens at, whichever way it was created.
 *
 * A booking's stored value is Irish wall-clock wearing a UTC label, so it is
 * converted; a manual meeting is already a true instant and is left alone.
 */
export function meetingInstant(m: OrderableMeeting): string {
  if (!m.strategy_booking_id) return String(m.scheduled_at);
  return (
    dublinLocalToUtcISO(String(m.scheduled_at).slice(0, 16)) ?? String(m.scheduled_at)
  );
}

/**
 * Irish wall-clock "now", in the same shape the booking rows are stored in.
 * A booking is compared against this rather than against real UTC now —
 * otherwise a finished summer session sits in "Upcoming", with no outcome
 * buttons, for an extra hour.
 */
export function dublinWallNow(at: Date = new Date()): string {
  return at.toLocaleString("sv-SE", { timeZone: "Europe/Dublin" }).replace(" ", "T");
}

export function hasPassed(m: OrderableMeeting, at: Date = new Date()): boolean {
  return m.strategy_booking_id
    ? String(m.scheduled_at).slice(0, 19) < dublinWallNow(at)
    : String(m.scheduled_at) < at.toISOString();
}

/**
 * The three lists the page shows.
 *
 * `upcoming` is SOONEST FIRST — the next meeting is the one Jude needs to see
 * without scrolling. `awaitingOutcome` is a call that has happened and was
 * never closed out; it gets its own section so it can't be lost among finished
 * meetings. `past` keeps the query's newest-first order.
 */
export function splitMeetings<T extends OrderableMeeting>(
  meetings: T[],
  at: Date = new Date()
): { upcoming: T[]; awaitingOutcome: T[]; past: T[] } {
  const booked = meetings.filter((m) => m.status === "booked");
  return {
    upcoming: booked
      .filter((m) => !hasPassed(m, at))
      // Ascending, and this is the ONLY place the order is decided. The page
      // used to sort here and then reverse the result at render, which put the
      // furthest-away meeting first again.
      .sort((a, b) => (meetingInstant(a) < meetingInstant(b) ? -1 : 1)),
    awaitingOutcome: booked.filter((m) => hasPassed(m, at)),
    past: meetings.filter((m) => m.status !== "booked"),
  };
}
