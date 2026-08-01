/**
 * Opening hours for a SiteIQ page.
 *
 * The page had a headline, a paragraph, a list of services and a phone
 * number. That is a business card. The three things a person actually looks
 * for on a local business page — are you open, do you cover my area, how do I
 * reach you right now — were none of them answerable, and Google could not
 * read any of it either.
 *
 * Hours are the hardest of the three to get right, so they live here on their
 * own, pure, with no database or request anywhere near them.
 *
 * The parser REFUSES rather than guesses. "9-5" could be 09:00–17:00 or
 * 09:00–05:00, and a page that quietly claims the wrong closing time sends
 * someone to a locked door. Every ambiguity below is an error naming the line
 * that caused it.
 */

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** schema.org day URIs, in the same 0=Sunday order. */
const SCHEMA_DAYS = [
  "https://schema.org/Sunday",
  "https://schema.org/Monday",
  "https://schema.org/Tuesday",
  "https://schema.org/Wednesday",
  "https://schema.org/Thursday",
  "https://schema.org/Friday",
  "https://schema.org/Saturday",
] as const;

/**
 * One day's hours. `day` is 0=Sunday … 6=Saturday, matching JS and the
 * Dublin helpers in lib/growth/dates.ts.
 *
 * A day that is simply ABSENT from the list is closed. That is deliberate:
 * a business fills in the days it opens, and anything it did not mention is
 * shown as "Closed" rather than as an unknown.
 */
export type DayHours = { day: number; open: number; close: number };

/** Minutes since midnight. Kept as a number so comparisons are trivial. */
export type Hours = DayHours[];

export type ParseResult =
  | { ok: true; hours: Hours }
  | { ok: false; error: string };

const DAY_WORDS: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

/**
 * A time of day, in minutes since midnight.
 *
 * Accepts 9:00, 09:00, 9.00, 9am, 9 am, 9:30pm, 17:30, and midnight/noon.
 * Rejects a bare "9" — see the refuse-rather-than-guess note above.
 */
export function parseTime(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  if (s === "midnight") return 0;
  if (s === "noon" || s === "midday") return 12 * 60;

  const m = /^(\d{1,2})([:.](\d{2}))?(am|pm)?$/.exec(s);
  if (!m) return null;

  let hour = Number(m[1]);
  const minute = m[3] ? Number(m[3]) : 0;
  const meridiem = m[4];

  if (minute > 59) return null;

  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  } else {
    // No am/pm, so it must be unambiguous 24-hour. A bare "9" with no minutes
    // and no meridiem is exactly the ambiguity this parser refuses.
    if (!m[3]) return null;
    if (hour > 23) return null;
  }
  return hour * 60 + minute;
}

/** "09:00" from 540. Always two digits, always 24-hour — no ambiguity stored. */
export function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function parseDayList(raw: string): number[] | null {
  const days: number[] = [];
  for (const part of raw.split(",")) {
    const chunk = part.trim().toLowerCase();
    if (!chunk) continue;
    // "mon-fri" — a range, inclusive, wrapping is not allowed.
    const range = /^([a-z]+)\s*(?:-|–|—|to)\s*([a-z]+)$/.exec(chunk);
    if (range) {
      const from = DAY_WORDS[range[1]];
      const to = DAY_WORDS[range[2]];
      if (from === undefined || to === undefined) return null;
      // Iterate forward with wraparound so "Fri-Mon" means Fri, Sat, Sun, Mon
      // rather than nothing.
      for (let d = from; ; d = (d + 1) % 7) {
        days.push(d);
        if (d === to) break;
      }
      continue;
    }
    const single = DAY_WORDS[chunk];
    if (single === undefined) return null;
    days.push(single);
  }
  return days.length ? days : null;
}

/**
 * Parses the hours textarea.
 *
 *   Mon-Fri 08:00-18:00
 *   Sat 9:00-13:00
 *   Sun closed
 *
 * Later lines win, so a business can write a weekday range and then override
 * one day underneath it — which is how people naturally write this.
 */
export function parseHours(raw: string): ParseResult {
  const byDay = new Map<number, DayHours | null>();

  for (const line of (raw ?? "").split("\n")) {
    const text = line.trim();
    if (!text || text.startsWith("#")) continue;

    // Split the day part from the time part at the first digit or the word
    // "closed", so "Mon-Fri 08:00-18:00" and "Mon - Fri: 8am - 6pm" both work.
    const m = /^([a-z,\s\-–—]+?)\s*:?\s*(closed|shut|[\d].*)$/i.exec(text);
    if (!m) {
      return { ok: false, error: `Couldn't read "${text}" — try "Mon-Fri 09:00-17:00" or "Sun closed".` };
    }

    // A trailing separator belongs to the LINE, not to the day list.
    // "Saturday – 10:00 to 14:00" is a perfectly normal thing to write, and
    // without this the dash is swallowed into the day part and the whole line
    // is rejected as an unrecognised day.
    const days = parseDayList(m[1].replace(/[\s:,\-–—]+$/, ""));
    if (!days) {
      return { ok: false, error: `Couldn't read the day in "${text}" — use names like Mon, Tue, Sat.` };
    }

    const rest = m[2].trim().toLowerCase();
    if (rest === "closed" || rest === "shut") {
      for (const d of days) byDay.set(d, null);
      continue;
    }

    const times = /^(.+?)\s*(?:-|–|—|to)\s*(.+)$/.exec(rest);
    if (!times) {
      return { ok: false, error: `"${text}" needs an opening and a closing time, like 09:00-17:00.` };
    }
    const open = parseTime(times[1]);
    const close = parseTime(times[2]);
    if (open === null) {
      return { ok: false, error: `Couldn't read the opening time in "${text}" — write it as 09:00 or 9am, not 9.` };
    }
    if (close === null) {
      return { ok: false, error: `Couldn't read the closing time in "${text}" — write it as 17:00 or 5pm, not 5.` };
    }
    if (open === close) {
      return { ok: false, error: `"${text}" opens and closes at the same time. Write "closed" if you don't open.` };
    }
    for (const d of days) byDay.set(d, { day: d, open, close });
  }

  const hours = [...byDay.values()]
    .filter((h): h is DayHours => h !== null)
    .sort((a, b) => a.day - b.day);
  return { ok: true, hours };
}

/** Turns stored hours back into the text the parser accepts, for the editor. */
export function hoursToText(hours: Hours): string {
  const byDay = new Map(hours.map((h) => [h.day, h]));
  const lines: string[] = [];
  // Monday-first, the way an Irish business reads its own week.
  const order = [1, 2, 3, 4, 5, 6, 0];

  let run: { start: number; h: DayHours | null } | null = null;
  const flush = (endIdx: number) => {
    if (!run) return;
    const startDay = order[run.start];
    const endDay = order[endIdx];
    const label = run.start === endIdx ? DAY_SHORT[startDay] : `${DAY_SHORT[startDay]}-${DAY_SHORT[endDay]}`;
    lines.push(run.h ? `${label} ${formatTime(run.h.open)}-${formatTime(run.h.close)}` : `${label} closed`);
    run = null;
  };

  order.forEach((day, i) => {
    const h = byDay.get(day) ?? null;
    const same =
      run &&
      ((run.h === null && h === null) ||
        (run.h !== null && h !== null && run.h.open === h.open && run.h.close === h.close));
    if (!same) {
      flush(i - 1);
      run = { start: i, h };
    }
  });
  flush(order.length - 1);
  return lines.join("\n");
}

/** Monday-first rows for display, every day present so none looks forgotten. */
export function hoursRows(hours: Hours): { day: string; text: string; closed: boolean }[] {
  const byDay = new Map(hours.map((h) => [h.day, h]));
  return [1, 2, 3, 4, 5, 6, 0].map((day) => {
    const h = byDay.get(day);
    return {
      day: DAY_NAMES[day],
      text: h ? `${formatTime(h.open)} – ${formatTime(h.close)}` : "Closed",
      closed: !h,
    };
  });
}

/**
 * Irish wall-clock weekday and minute-of-day.
 *
 * Opening hours are what the sign on the door says, so they are Irish local
 * time — never the server's UTC clock, which is an hour out for most of the
 * year and would tell a visitor a shop is shut when it is open.
 */
export function dublinNow(at: Date = new Date()): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Dublin",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[get("weekday")] ?? 0;
  // en-GB renders midnight as "24" in some runtimes; normalise it to 0.
  const hour = Number(get("hour")) % 24;
  return { day, minutes: hour * 60 + Number(get("minute")) };
}

export type OpenState =
  | { open: true; closesAt: string }
  | { open: false; opensAt: string | null };

/**
 * Whether the business is open right now.
 *
 * Handles hours that run past midnight (a takeaway open 17:00–01:00): the
 * previous day's entry is what keeps it open at 00:30, and forgetting that is
 * the classic version of this bug.
 */
export function openNow(hours: Hours, at: Date = new Date()): OpenState {
  if (hours.length === 0) return { open: false, opensAt: null };
  const { day, minutes } = dublinNow(at);
  const byDay = new Map(hours.map((h) => [h.day, h]));

  const today = byDay.get(day);
  if (today) {
    const overnight = today.close <= today.open;
    if (!overnight && minutes >= today.open && minutes < today.close) {
      return { open: true, closesAt: formatTime(today.close) };
    }
    if (overnight && minutes >= today.open) {
      return { open: true, closesAt: formatTime(today.close) };
    }
  }

  // Still open from yesterday evening?
  const yesterday = byDay.get((day + 6) % 7);
  if (yesterday && yesterday.close <= yesterday.open && minutes < yesterday.close) {
    return { open: true, closesAt: formatTime(yesterday.close) };
  }

  // Closed. Find the next opening, looking up to a week ahead.
  if (today && minutes < today.open) {
    return { open: false, opensAt: `today at ${formatTime(today.open)}` };
  }
  for (let ahead = 1; ahead <= 7; ahead += 1) {
    const next = byDay.get((day + ahead) % 7);
    if (next) {
      const when = ahead === 1 ? "tomorrow" : DAY_NAMES[(day + ahead) % 7];
      return { open: false, opensAt: `${when} at ${formatTime(next.open)}` };
    }
  }
  return { open: false, opensAt: null };
}

/**
 * schema.org openingHoursSpecification.
 *
 * This is the half of the work a visitor never sees and the business feels
 * most: it is what lets Google show the opening hours, the phone number and
 * the area served directly in the result, instead of a blue link.
 */
export function hoursToSchema(hours: Hours) {
  return hours.map((h) => ({
    "@type": "OpeningHoursSpecification",
    dayOfWeek: SCHEMA_DAYS[h.day],
    opens: formatTime(h.open),
    closes: formatTime(h.close),
  }));
}
