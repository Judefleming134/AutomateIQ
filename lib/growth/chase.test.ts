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

describe("every send path is wired to it too", () => {
  // recordOutreachSent is reached from "Mark sent" on the DM list, the message
  // composer, the inbox queue view AND the 07:00 autopilot — so the same
  // unconditional +3 was rewriting the diary on every outreach path in the
  // engine, not just one button. A prospect who said "try us after the
  // summer" had that September date pulled to three days out.
  const OUT = readFileSync(
    path.resolve(import.meta.dirname, "outreach.ts"),
    "utf8"
  );

  it("recordOutreachSent resolves the chase through the shared rule", () => {
    expect(OUT).toContain("resolveChaseDate");
  });

  it("no longer writes an unconditional +3 on every send", () => {
    expect(OUT).not.toMatch(/next_follow_up_at:\s*dublinDate\(3\)/);
  });

  it("reads the existing date before deciding", () => {
    // It only selected last_contact_at, so it could not have known.
    expect(OUT).toMatch(/select\("last_contact_at, next_follow_up_at"\)/);
  });

  it("stops claiming a 3-day follow-up it may not have scheduled", () => {
    // The activity line said "follow-up scheduled in 3 days" regardless.
    expect(OUT).not.toContain("follow-up scheduled in 3 days");
    expect(OUT).toContain("chase kept for");
  });
});

describe("the fallback is configurable, the KEEP half never is (K7)", () => {
  // "No answer" wants the lead back tomorrow, not in three days. That is the
  // ONLY thing that differs — the half of the rule that protects an agreed
  // date has to behave identically, or the new caller reintroduces the bug.
  it("schedules tomorrow instead of +3 when asked", () => {
    expect(resolveChaseDate(null, today, 1)).toEqual({ date: day(1), kept: false });
  });

  it("still defaults to +3 for every existing caller", () => {
    expect(resolveChaseDate(null)).toEqual({ date: day(3), kept: false });
    expect(resolveChaseDate(null, today)).toEqual({ date: day(3), kept: false });
  });

  it("reschedules an overdue chase to the fallback, not to +3", () => {
    expect(resolveChaseDate(day(-4), today, 1)).toEqual({ date: day(1), kept: false });
  });

  it("reschedules a chase due today, so the lead does come back tomorrow", () => {
    // Otherwise a no-answer on a due chase leaves the date at today and the
    // lead sits on the list for good.
    expect(resolveChaseDate(today, today, 1)).toEqual({ date: day(1), kept: false });
  });

  it.each([
    ["they said ring me Monday", 4],
    ["proposal sent — 7-day decision nudge", 7],
    ["review booked in a fortnight", 14],
    ["future_opportunity — 90-day nurture", 90],
  ])("a no-answer never pulls %s forward to tomorrow", (_label, days) => {
    const existing = day(days);
    expect(resolveChaseDate(existing, today, 1)).toEqual({ date: existing, kept: true });
  });

  it("keeps a chase booked for tomorrow rather than rewriting it", () => {
    // Same date either way, but kept:false would write the column for no
    // reason — and it is the flag the activity line reads.
    expect(resolveChaseDate(day(1), today, 1)).toEqual({ date: day(1), kept: true });
  });

  it("still schedules rather than suppresses on a malformed value", () => {
    for (const junk of ["", "not-a-date", "31/07/2026"]) {
      expect(resolveChaseDate(junk, today, 1), junk).toEqual({ date: day(1), kept: false });
    }
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

  // --- logNoAnswer (K7) -----------------------------------------------------
  // The last path still writing the date unconditionally. It is reached from
  // the "No answer" button on the call list, which is the single most-tapped
  // control on a dial day.
  const NO_ANSWER = SRC.slice(
    SRC.indexOf("export async function logNoAnswer"),
    SRC.indexOf("export async function addActivity")
  );

  it("logNoAnswer goes through the shared rule too", () => {
    expect(NO_ANSWER).toContain("resolveChaseDate");
  });

  it("logNoAnswer no longer stamps tomorrow unconditionally", () => {
    // The bug, in one line: `next_follow_up_at: dublinDate(1)`. Both the
    // object-literal AND the assignment form — reverting the fix to
    // `bump.next_follow_up_at = dublinDate(1)` slipped past the colon-only
    // pattern when this guard was first written.
    expect(NO_ANSWER).not.toMatch(/next_follow_up_at:\s*dublinDate\(1\)/);
    expect(NO_ANSWER).not.toMatch(/next_follow_up_at\s*=\s*dublinDate\(1\)/);
  });

  it("asks for tomorrow as the fallback, not the default +3", () => {
    // A no-answer must still bring an undated lead back TOMORROW — the fix
    // must not quietly turn every voicemail into three days of silence.
    expect(NO_ANSWER).toMatch(/resolveChaseDate\([^)]*,\s*dublinDate\(\),\s*1\)/);
  });

  it("reads the existing date before deciding", () => {
    expect(NO_ANSWER).toMatch(/select\("next_follow_up_at"\)/);
  });

  it("only writes the date when it is genuinely being rescheduled", () => {
    expect(NO_ANSWER).toMatch(/if \(!chase\.kept\) bump\.next_follow_up_at/);
  });

  it("stops promising 'tomorrow' when it kept a later date", () => {
    // The activity line is the ONLY place this promise is visible — the
    // call-list card's "back on the list TOMORROW" is a JSX comment.
    expect(NO_ANSWER).toContain("Chase stays");
    expect(NO_ANSWER).toMatch(/chase\.kept\s*\n?\s*\?/);
  });

  it("still stamps last_contact_at, so the lead drops off today's list", () => {
    expect(NO_ANSWER).toMatch(/last_contact_at: new Date\(\)\.toISOString\(\)/);
  });

  it("never advances the pipeline stage — an unanswered ring isn't contact", () => {
    expect(NO_ANSWER).not.toMatch(/status:\s*["']contacted["']/);
  });

  it("does not report success when the reschedule failed", () => {
    // Without last_contact_at the lead never drops off the call list, so a
    // silent ok here is a number Jude redials all afternoon.
    expect(NO_ANSWER).toContain("bumpError");
    expect(NO_ANSWER).toMatch(/if \(bumpError\)/);
  });
});

describe("the call-list card no longer contradicts what happens", () => {
  const CARD = readFileSync(
    path.resolve(
      import.meta.dirname, "..", "..", "app", "growth", "(app)", "call-list", "page.tsx"
    ),
    "utf8"
  );

  it("still shows a booked-ahead chase on the card before the number is tapped", () => {
    // This is what makes keeping the date legible rather than mysterious.
    expect(CARD).toContain("chase booked for");
    expect(CARD).toContain("not due yet");
  });

  it("keeps both outcome buttons — nothing Jude uses was removed", () => {
    expect(CARD).toContain("logNoAnswer");
    expect(CARD).toContain("No answer");
    expect(CARD).toContain("Log call");
  });
});
