import { describe, it, expect } from "vitest";
import {
  parseHours,
  parseTime,
  formatTime,
  hoursToText,
  hoursRows,
  openNow,
  hoursToSchema,
  dublinNow,
  type Hours,
} from "@/lib/site-agent/hours";

/**
 * A SiteIQ page had a headline, a paragraph, a list of services and a phone
 * number. That is a business card. "Are you open?" — the first thing anyone
 * checks before ringing a local business — was unanswerable.
 *
 * The parser REFUSES rather than guesses, because "9-5" could be 09:00–17:00
 * or 09:00–05:00 and a page that quietly claims the wrong closing time sends
 * a real person to a locked door.
 */

/** A Date that IS a given Irish wall-clock moment, whatever the server's zone. */
function irish(dayIso: string, time: string): Date {
  // Irish summer time is UTC+1; these fixtures pick dates either side of the
  // change so the offset is never assumed.
  const summer = new Date(`${dayIso}T12:00:00Z`).getUTCMonth() > 2 &&
    new Date(`${dayIso}T12:00:00Z`).getUTCMonth() < 9;
  const [h, m] = time.split(":").map(Number);
  const utcHour = h - (summer ? 1 : 0);
  return new Date(Date.UTC(
    Number(dayIso.slice(0, 4)),
    Number(dayIso.slice(5, 7)) - 1,
    Number(dayIso.slice(8, 10)),
    utcHour,
    m
  ));
}

describe("reading a time of day", () => {
  it("accepts the shapes people actually write", () => {
    expect(parseTime("09:00")).toBe(540);
    expect(parseTime("9:00")).toBe(540);
    expect(parseTime("9.00")).toBe(540);
    expect(parseTime("9am")).toBe(540);
    expect(parseTime("9 am")).toBe(540);
    expect(parseTime("17:30")).toBe(17 * 60 + 30);
    expect(parseTime("5:30pm")).toBe(17 * 60 + 30);
    expect(parseTime("12pm")).toBe(720);
    expect(parseTime("12am")).toBe(0);
    expect(parseTime("noon")).toBe(720);
    expect(parseTime("midnight")).toBe(0);
  });

  it("REFUSES a bare number", () => {
    // THE ambiguity. "9-5" is 09:00–17:00 to most people and 09:00–05:00 to
    // the machine, and guessing wrong publishes a wrong closing time.
    expect(parseTime("9")).toBeNull();
    expect(parseTime("5")).toBeNull();
    expect(parseTime("17")).toBeNull();
  });

  it("refuses nonsense rather than clamping it", () => {
    expect(parseTime("25:00")).toBeNull();
    expect(parseTime("09:75")).toBeNull();
    expect(parseTime("13pm")).toBeNull();
    expect(parseTime("0am")).toBeNull();
    expect(parseTime("half nine")).toBeNull();
    expect(parseTime("")).toBeNull();
  });

  it("round-trips through formatTime", () => {
    for (const m of [0, 1, 540, 720, 1035, 1439]) {
      expect(parseTime(formatTime(m))).toBe(m);
    }
  });
});

describe("reading the hours box", () => {
  it("reads a range, a single day and a closed day", () => {
    const r = parseHours("Mon-Fri 08:00-18:00\nSat 9:00-13:00\nSun closed");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hours).toHaveLength(6);
    expect(r.hours.find((h) => h.day === 1)).toEqual({ day: 1, open: 480, close: 1080 });
    expect(r.hours.find((h) => h.day === 6)).toEqual({ day: 6, open: 540, close: 780 });
    // Sunday is absent, which is how "closed" is stored.
    expect(r.hours.find((h) => h.day === 0)).toBeUndefined();
  });

  it("lets a later line override an earlier range", () => {
    // How people naturally write it: the week, then the exception under it.
    const r = parseHours("Mon-Fri 09:00-17:00\nWed 09:00-13:00");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hours.find((h) => h.day === 3)).toEqual({ day: 3, open: 540, close: 780 });
    expect(r.hours.find((h) => h.day === 2)).toEqual({ day: 2, open: 540, close: 1020 });
  });

  it("handles a range that wraps the weekend", () => {
    const r = parseHours("Fri-Mon 12:00-23:00");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hours.map((h) => h.day).sort()).toEqual([0, 1, 5, 6]);
  });

  it("accepts commas, colons, dashes and long day names", () => {
    const r = parseHours("Monday, Wednesday: 9:00 - 17:00\nSaturday – 10:00 to 14:00");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hours.map((h) => h.day)).toEqual([1, 3, 6]);
  });

  it("ignores blank lines and comments", () => {
    const r = parseHours("\n# our hours\nMon 09:00-17:00\n\n");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hours).toHaveLength(1);
  });

  it("an empty box is valid and means no hours published", () => {
    expect(parseHours("")).toEqual({ ok: true, hours: [] });
    expect(parseHours("   \n  ")).toEqual({ ok: true, hours: [] });
  });
});

describe("it refuses rather than guesses, and says which line", () => {
  const failing = (raw: string) => {
    const r = parseHours(raw);
    expect(r.ok).toBe(false);
    return r.ok ? "" : r.error;
  };

  it("rejects a bare 9-5 and names the line", () => {
    const err = failing("Mon-Fri 9-5");
    expect(err).toContain("Mon-Fri 9-5");
    expect(err).toMatch(/09:00 or 9am/);
  });

  it("rejects a day it does not recognise", () => {
    expect(failing("Munday 09:00-17:00")).toContain("Munday");
  });

  it("rejects a line with only one time", () => {
    expect(failing("Mon 09:00")).toMatch(/opening and a closing time/);
  });

  it("rejects opening and closing at the same time", () => {
    // Silently storing this would render as "09:00 – 09:00" on a live page.
    expect(failing("Mon 09:00-09:00")).toMatch(/same time/);
  });

  it("rejects a line with no times at all", () => {
    expect(failing("we open when we open")).toBeTruthy();
  });

  it("one bad line rejects the whole save", () => {
    // Partially saving would publish hours the business never confirmed.
    const r = parseHours("Mon 09:00-17:00\nTue 9-5\nWed 09:00-17:00");
    expect(r.ok).toBe(false);
  });
});

describe("hours survive a round-trip through the editor", () => {
  it("collapses identical consecutive days back into a range", () => {
    const raw = "Mon-Fri 08:00-18:00\nSat 09:00-13:00\nSun closed";
    const parsed = parseHours(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const text = hoursToText(parsed.hours);
    expect(text).toBe("Mon-Fri 08:00-18:00\nSat 09:00-13:00\nSun closed");
  });

  it("re-parses to exactly the same hours", () => {
    // The property that matters: opening the editor and pressing Save must
    // never quietly change the published hours.
    for (const raw of [
      "Mon-Fri 08:00-18:00\nSat 09:00-13:00\nSun closed",
      "Mon 09:00-17:00",
      "Sat-Sun 10:00-16:00",
      "Mon-Sun 00:00-23:30",
      "Mon-Thu 09:00-17:00\nFri 09:00-15:00",
    ]) {
      const first = parseHours(raw);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const second = parseHours(hoursToText(first.hours));
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.hours).toEqual(first.hours);
    }
  });

  it("shows every day, so none looks forgotten", () => {
    const parsed = parseHours("Mon 09:00-17:00");
    if (!parsed.ok) return;
    const rows = hoursRows(parsed.hours);
    expect(rows).toHaveLength(7);
    expect(rows[0]).toEqual({ day: "Monday", text: "09:00 – 17:00", closed: false });
    expect(rows[6]).toEqual({ day: "Sunday", text: "Closed", closed: true });
  });
});

describe("open now", () => {
  const weekday: Hours = [
    { day: 1, open: 540, close: 1020 },
    { day: 2, open: 540, close: 1020 },
    { day: 3, open: 540, close: 1020 },
    { day: 4, open: 540, close: 1020 },
    { day: 5, open: 540, close: 1020 },
  ];

  it("is open during opening hours", () => {
    // Wednesday 2026-08-05, 11:00 Irish time.
    expect(openNow(weekday, irish("2026-08-05", "11:00"))).toEqual({
      open: true,
      closesAt: "17:00",
    });
  });

  it("is shut before opening and after closing", () => {
    expect(openNow(weekday, irish("2026-08-05", "08:30"))).toEqual({
      open: false,
      opensAt: "today at 09:00",
    });
    expect(openNow(weekday, irish("2026-08-05", "17:30"))).toEqual({
      open: false,
      opensAt: "tomorrow at 09:00",
    });
  });

  it("closes exactly on the closing minute, not a minute after", () => {
    expect(openNow(weekday, irish("2026-08-05", "16:59")).open).toBe(true);
    expect(openNow(weekday, irish("2026-08-05", "17:00")).open).toBe(false);
  });

  it("names the next open day across a closed weekend", () => {
    // Saturday. Next opening is Monday, not "tomorrow".
    expect(openNow(weekday, irish("2026-08-08", "11:00"))).toEqual({
      open: false,
      opensAt: "Monday at 09:00",
    });
  });

  it("uses IRISH time, not the server's UTC clock", () => {
    // 08:30 UTC on a summer day is 09:30 in Dublin — open. Reading the
    // server's clock would tell a visitor the shop is shut.
    const at = new Date("2026-08-05T08:30:00Z");
    expect(openNow(weekday, at).open).toBe(true);
    // And in winter, when Dublin IS UTC, 08:30 is genuinely before opening.
    expect(openNow(weekday, new Date("2026-01-07T08:30:00Z")).open).toBe(false);
  });

  it("handles hours that run past midnight", () => {
    // A takeaway open 17:00–01:00. The classic version of this bug says
    // "closed" at half twelve while the kitchen is still going.
    const takeaway: Hours = [{ day: 5, open: 1020, close: 60 }];
    expect(openNow(takeaway, irish("2026-08-07", "23:30"))).toEqual({
      open: true,
      closesAt: "01:00",
    });
    // Saturday 00:30 — still Friday's session.
    expect(openNow(takeaway, irish("2026-08-08", "00:30"))).toEqual({
      open: true,
      closesAt: "01:00",
    });
    // Saturday 01:30 — shut.
    expect(openNow(takeaway, irish("2026-08-08", "01:30")).open).toBe(false);
  });

  it("says nothing at all when no hours are published", () => {
    expect(openNow([], new Date())).toEqual({ open: false, opensAt: null });
  });

  it("dublinNow returns a real weekday and minute", () => {
    const { day, minutes } = dublinNow(new Date("2026-08-05T11:00:00Z"));
    expect(day).toBe(3); // Wednesday
    expect(minutes).toBe(12 * 60); // 12:00 Irish in summer
  });
});

describe("what a search engine reads", () => {
  it("emits schema.org opening hours", () => {
    const parsed = parseHours("Mon 09:00-17:00\nSat 10:00-14:00");
    if (!parsed.ok) return;
    expect(hoursToSchema(parsed.hours)).toEqual([
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: "https://schema.org/Monday",
        opens: "09:00",
        closes: "17:00",
      },
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: "https://schema.org/Saturday",
        opens: "10:00",
        closes: "14:00",
      },
    ]);
  });

  it("emits nothing when there are no hours, rather than an empty claim", () => {
    expect(hoursToSchema([])).toEqual([]);
  });
});
