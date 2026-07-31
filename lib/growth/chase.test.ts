import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveChaseDate, dublinDate } from "@/lib/growth/dates";

/**
 * "Log call" and the chase date.
 *
 * The bug: logging a call overwrote `next_follow_up_at` with today+3
 * UNCONDITIONALLY, so one tap destroyed whatever was in the diary — in both
 * directions. A prospect who said "ring me tomorrow" was pushed out to day 3
 * and rung two days after he was promised; a 90-day nurture was yanked forward
 * to day 3 and chased 87 days early. Nothing on screen said the date had moved.
 *
 * The rule: a call can PUT a chase in the diary, but it can never MOVE one
 * that is already there. Which is exactly what setProspectStatus already
 * claimed in its own comment — two paths to the same outcome were following
 * different rules.
 */

const today = dublinDate();
const day = (n: number) => dublinDate(n);

describe("a call schedules a chase when there isn't one", () => {
  it("gives a never-contacted prospect a +3 chase", () => {
    expect(resolveChaseDate(null)).toEqual({ date: day(3), kept: false });
  });

  it("treats undefined the same as missing", () => {
    expect(resolveChaseDate(undefined).kept).toBe(false);
  });

  it("reschedules a chase that was already overdue", () => {
    // That overdue date IS the chase this call just was. Rescheduling is what
    // stops the same lead reappearing on the call list every single day.
    expect(resolveChaseDate(day(-4))).toEqual({ date: day(3), kept: false });
  });

  it("reschedules a chase that was due today", () => {
    expect(resolveChaseDate(today)).toEqual({ date: day(3), kept: false });
  });
});

describe("a call never moves a chase that is already booked", () => {
  it.each([
    ["they said ring me tomorrow", 1],
    ["they said ring me Monday", 4],
    ["proposal sent — 7-day decision nudge", 7],
    ["review booked in a fortnight", 14],
    ["future_opportunity — 90-day nurture", 90],
  ])("keeps %s", (_label, days) => {
    const existing = day(days);
    expect(resolveChaseDate(existing)).toEqual({ date: existing, kept: true });
  });

  it("never pushes a promised callback further out", () => {
    // The damaging direction: a callback agreed on the phone for tomorrow.
    const promised = day(1);
    const { date } = resolveChaseDate(promised);
    expect(date).toBe(promised);
    expect(date < day(3)).toBe(true);
  });

  it("never pulls a long nurture forward", () => {
    const nurture = day(90);
    expect(resolveChaseDate(nurture).date).toBe(nurture);
  });
});

describe("it handles the shapes the database actually returns", () => {
  it("accepts a full timestamp and compares on the date part", () => {
    expect(resolveChaseDate(`${day(5)}T09:30:00.000Z`)).toEqual({
      date: day(5),
      kept: true,
    });
  });

  it("schedules rather than suppresses when the value is malformed", () => {
    // A junk value must never be read as "a deliberate future date" — that
    // would silently leave the lead with no chase at all, which is the leak
    // this whole path exists to prevent.
    for (const junk of ["", "   ", "not-a-date", "9999", "31/07/2026"]) {
      const r = resolveChaseDate(junk);
      expect(r.kept, junk).toBe(false);
      expect(r.date, junk).toBe(day(3));
    }
  });

  it("is pure — same input, same answer", () => {
    expect(resolveChaseDate(day(9))).toEqual(resolveChaseDate(day(9)));
  });
});

describe("the caller records what it did", () => {
  it("distinguishes a kept date from a scheduled one", () => {
    // The activity line says "chase kept for X" or "follow-up scheduled for X"
    // off this flag, so a date being left alone is never a silent surprise.
    expect(resolveChaseDate(day(30)).kept).toBe(true);
    expect(resolveChaseDate(null).kept).toBe(false);
  });
});

describe("the action is actually wired to it", () => {
  // The lesson from lib/routing/wiring.test.ts: a pure function can be
  // perfectly correct and perfectly tested while nothing calls it. These check
  // the join, by reading the server action itself.
  const SRC = readFileSync(
    path.resolve(import.meta.dirname, "..", "..", "app", "growth", "(app)", "prospects", "actions.ts"),
    "utf8"
  );

  it("addActivity resolves the chase date through the shared rule", () => {
    expect(SRC).toContain("resolveChaseDate");
  });

  it("no longer writes an unconditional +3 chase", () => {
    // This exact line is the bug: one tap of "Log call" overwriting whatever
    // was in the diary.
    expect(SRC).not.toMatch(/next_follow_up_at:\s*dublinDate\(3\)/);
  });

  it("only writes the date when it is genuinely being rescheduled", () => {
    expect(SRC).toMatch(/if \(chase && !chase\.kept\) bump\.next_follow_up_at/);
  });
});
