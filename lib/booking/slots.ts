/**
 * AI Strategy Session availability. Pure, deterministic slot generation shared
 * by the public page (server render), the booking API (authoritative
 * validation) and the client widget (display).
 *
 * A slot is a fixed wall-clock instant the visitor and AutomateIQ agree on.
 * We build each slot's ISO string with an explicit `Z` and always render it
 * back with `timeZone: "UTC"`, so the exact time the visitor picks is the time
 * everyone (customer email, owner notification, admin console) sees — the
 * "Irish time" label in the UI is the human-facing name for that instant.
 */

export const BOOKING_CONFIG = {
  // 1 = Monday … 5 = Friday. Weekends are excluded.
  workingDays: [1, 2, 3, 4, 5],
  startHour: 9,
  endHour: 17, // last slot starts before this hour
  slotMinutes: 30,
  daysAhead: 21,
  // Minimum lead time before a slot can be booked (no same-hour bookings).
  //
  // 12, not 24 — J3, decided rather than left open any longer.
  //
  // The phone script offers "would tomorrow morning suit?" and at 24 hours the
  // booking page refused it. A call at 11am Monday made everything before 11am
  // Tuesday unbookable, so the whole of the next morning was gone; a 2pm call
  // took the morning AND the early afternoon. The lead was told one thing and
  // shown another, on the page they were sent to while still on the phone.
  //
  // 12 is the value that fixes exactly that and nothing else:
  //   · tomorrow 09:00 stays bookable for any call placed up to 21:00 today,
  //     so the script's offer is always honourable;
  //   · same-day is still impossible — a 9am call reaches 9pm, and the last
  //     slot starts 16:30, so nothing today can be grabbed at short notice.
  // Lowering it only ADDS slots; no existing booking or held slot is affected.
  minLeadHours: 12,
  timezoneLabel: "Irish time (IST)",
  // 15, matching every other surface. This is a LABEL ONLY — it is shown on
  // the booking page, in the FAQ and in the confirmation email, and it does
  // not size any calendar hold. Nothing in this file ever held 45 minutes;
  // slot spacing is `slotMinutes` alone. Worth stating because the old
  // "45 minutes" string was widely believed to be the real duration, which
  // also meant slots 30 minutes apart looked like they overlapped by 15.
  // At 15 minutes against 30-minute spacing there is a genuine buffer.
  durationLabel: "15 minutes",
} as const;

export type BookingSlot = { iso: string; label: string };
export type BookingDay = { date: string; weekday: string; dayLabel: string; slots: BookingSlot[] };

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function timeLabel(hour: number, minute: number) {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const ampm = hour < 12 ? "am" : "pm";
  return `${h12}:${pad(minute)}${ampm}`;
}

/** All slot ISO strings that are structurally valid (before availability). */
function slotsForDate(dateUtc: Date): BookingSlot[] {
  const y = dateUtc.getUTCFullYear();
  const m = pad(dateUtc.getUTCMonth() + 1);
  const d = pad(dateUtc.getUTCDate());
  const out: BookingSlot[] = [];
  for (let hour = BOOKING_CONFIG.startHour; hour < BOOKING_CONFIG.endHour; hour++) {
    for (let minute = 0; minute < 60; minute += BOOKING_CONFIG.slotMinutes) {
      out.push({
        iso: `${y}-${m}-${d}T${pad(hour)}:${pad(minute)}:00.000Z`,
        label: timeLabel(hour, minute),
      });
    }
  }
  return out;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Generate the bookable calendar for the next `daysAhead` days, excluding
 * weekends, past slots and any slot inside the minimum lead time. `taken`
 * removes slots already held by an active booking.
 */
export function generateAvailability(now: Date, taken: Set<string> = new Set()): BookingDay[] {
  const minBookable = now.getTime() + BOOKING_CONFIG.minLeadHours * 3600_000;
  const days: BookingDay[] = [];

  // Anchor to UTC midnight of "today" so slot ISO strings are stable.
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  for (let i = 0; i <= BOOKING_CONFIG.daysAhead; i++) {
    const day = new Date(start.getTime() + i * 86_400_000);
    const dow = day.getUTCDay();
    if (!(BOOKING_CONFIG.workingDays as readonly number[]).includes(dow)) continue;

    const slots = slotsForDate(day).filter(
      (s) => new Date(s.iso).getTime() >= minBookable && !taken.has(s.iso)
    );
    if (slots.length === 0) continue;

    days.push({
      date: `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`,
      weekday: WEEKDAYS[dow],
      dayLabel: `${WEEKDAYS[dow]}, ${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]}`,
      slots,
    });
  }
  return days;
}

/** Server-side guard: is this ISO a real, still-bookable slot? */
export function isBookableSlot(iso: string, now: Date): boolean {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  const days = generateAvailability(now);
  return days.some((d) => d.slots.some((s) => s.iso === iso));
}

/** Human label for a stored slot, e.g. "Tuesday, 8 Jul · 2:30pm". */
export function formatSlot(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} · ${timeLabel(
    d.getUTCHours(),
    d.getUTCMinutes()
  )}`;
}
