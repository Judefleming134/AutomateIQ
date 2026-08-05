import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hasPassed, meetingInstant, type OrderableMeeting } from "./meeting-order";

/**
 * "Strategy Session prep" prepped you for sessions that had already happened,
 * and put the later of two ahead of the sooner.
 *
 * The panel listed every booked meeting in the query's DESCENDING order and
 * took the first two, with no date filter at all:
 *
 *     (meetings ?? []).filter(m => m.status === "booked").slice(0, 2)
 *
 * Three things wrong with that, all of which lib/growth/meeting-order.ts
 * already solves for the dashboard and the meetings page:
 *
 *  1. NO DATE FILTER. A booked meeting that has passed and was never closed out
 *     is not rare — it is the exact population the meetings page gives its own
 *     "Awaiting outcome" section to. It rendered under a heading saying "prep",
 *     as though still to come.
 *  2. DESCENDING ORDER. With two sessions ahead it showed the LATER one first.
 *     meeting-order's own doc: "'Upcoming' wants the opposite, and getting that
 *     wrong puts the meeting happening NEXT at the bottom of the page whose
 *     entire job is telling you what is coming up."
 *  3. RAW COLUMN COMPARISON. scheduled_at holds two frames — a booking stores
 *     Irish wall-clock AS UTC, a manual meeting a true instant — so sorting the
 *     raw column mixes them by an hour in summer.
 *
 * Replayed at 14:30 Irish on 2026-08-05:
 *
 *     case                        BEFORE                     AFTER
 *     ─────────────────────────   ────────────────────────   ──────────────────
 *     two sessions ahead          20 Aug, then 7 Aug     ✗   7 Aug, then 20 Aug
 *     one ahead, one lapsed       12 Aug + 29 Jul        ✗   12 Aug only
 *     only a lapsed one           29 Jul as "prep"       ✗   named as lapsed
 *     a booking underway now      shown as upcoming      ✗   named as lapsed
 *     mixed frames, manual sooner booking first          ✗   manual first
 *
 * ADDITIVE: the panel still renders, and the pitch / angle / discovery
 * questions in it are untouched — a lapsed session just says so honestly and
 * links to where the outcome is recorded, instead of presenting a stale date as
 * something to prepare for.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const PAGE = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "prospects", "[id]", "page.tsx"),
  "utf8"
);
const PANEL = PAGE.slice(
  PAGE.indexOf('aria-labelledby="prep-title"'),
  PAGE.indexOf('<h2 className="panel-title">Sales angle</h2>')
);

/** 14:30 Irish on 2026-08-05 (summer — Irish time is UTC+1). */
const NOW = new Date("2026-08-05T13:30:00Z");

const booking = (at: string): OrderableMeeting => ({
  scheduled_at: at,
  strategy_booking_id: "bk",
  status: "booked",
});
const manual = (at: string): OrderableMeeting => ({
  scheduled_at: at,
  strategy_booking_id: null,
  status: "booked",
});

/** The shipped logic, replayed. */
function shown(ms: OrderableMeeting[]) {
  const upcoming = ms
    .filter((m) => !hasPassed(m, NOW))
    .sort((a, b) => (meetingInstant(a) < meetingInstant(b) ? -1 : 1));
  if (upcoming.length > 0) {
    return { kind: "upcoming" as const, rows: upcoming.slice(0, 2) };
  }
  const lapsed = ms
    .filter((m) => hasPassed(m, NOW))
    .sort((a, b) => (meetingInstant(a) < meetingInstant(b) ? 1 : -1));
  return lapsed.length
    ? { kind: "lapsed" as const, rows: [lapsed[0]] }
    : { kind: "none" as const, rows: [] };
}

describe("the next session is the one prepped for", () => {
  it("two ahead: the SOONER comes first", () => {
    const later = booking("2026-08-20T10:00:00");
    const sooner = booking("2026-08-07T09:00:00");
    const out = shown([later, sooner]);
    expect(out.kind).toBe("upcoming");
    expect(out.rows.map((m) => m.scheduled_at)).toEqual([
      sooner.scheduled_at,
      later.scheduled_at,
    ]);
  });

  it("a lapsed one never displaces an upcoming one", () => {
    const out = shown([booking("2026-08-12T11:00:00"), booking("2026-07-29T15:00:00")]);
    expect(out.kind).toBe("upcoming");
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].scheduled_at).toBe("2026-08-12T11:00:00");
  });

  it("the two frames are ordered against each other correctly", () => {
    // A booking at 16:00 Irish is stored 16:00Z; a manual meeting at 09:00Z is
    // genuinely earlier. Sorting the raw column would agree here only by luck —
    // meetingInstant makes it true by construction.
    const bk = booking("2026-08-06T16:00:00");
    const mn = manual("2026-08-06T09:00:00Z");
    const out = shown([bk, mn]);
    expect(out.rows.map((m) => m.strategy_booking_id)).toEqual([null, "bk"]);
  });
});

describe("a session that already happened is named, not prepped", () => {
  it("only a lapsed booking: reported as lapsed", () => {
    const out = shown([booking("2026-07-29T15:00:00")]);
    expect(out.kind).toBe("lapsed");
    expect(out.rows[0].scheduled_at).toBe("2026-07-29T15:00:00");
  });

  it("a summer booking that has just finished counts as passed", () => {
    // The hour that used to keep a finished session sitting in "Upcoming":
    // 14:00 Irish is stored 14:00Z, and it is now 14:30 Irish.
    const out = shown([booking("2026-08-05T14:00:00")]);
    expect(out.kind).toBe("lapsed");
  });

  it("a booking later today is still upcoming", () => {
    const out = shown([booking("2026-08-05T16:00:00")]);
    expect(out.kind).toBe("upcoming");
  });

  it("the most RECENT lapsed one is the one named", () => {
    const out = shown([booking("2026-06-01T10:00:00"), booking("2026-07-29T15:00:00")]);
    expect(out.rows[0].scheduled_at).toBe("2026-07-29T15:00:00");
  });

  it("no booked meetings at all renders nothing", () => {
    expect(shown([]).kind).toBe("none");
  });
});

describe("the panel is wired to the shared rule", () => {
  it("it imports hasPassed and meetingInstant", () => {
    expect(PAGE).toContain(
      'import { hasPassed, meetingInstant } from "@/lib/growth/meeting-order";'
    );
  });

  it("it filters out passed meetings", () => {
    expect(PANEL).toContain(".filter((m) => !hasPassed(m))");
  });

  it("it sorts upcoming soonest-first by the real instant", () => {
    expect(PANEL).toContain(
      "(a, b) => (meetingInstant(a) < meetingInstant(b) ? -1 : 1)"
    );
  });

  it("the old unfiltered slice is gone", () => {
    const code = PANEL.replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\.filter\(\(m\) => m\.status === "booked"\)\s*\n\s*\.slice\(0, 2\)/);
  });

  it("a lapsed session says so and links to where the outcome is recorded", () => {
    expect(PANEL).toContain("hasn&apos;t been closed out");
    expect(PANEL).toContain('href="/growth/meetings"');
  });

  it("that branch is REACHABLE — the only early return is the guarded one", () => {
    // Presence of the strings is not enough: an unconditional `return null`
    // above them leaves the notice in the file and dead on the page, and a
    // source-match test cannot tell the difference. There is exactly one
    // `return null` in the panel, and it is the one guarded by the empty check.
    const returns = [...PANEL.matchAll(/return null;/g)];
    expect(returns).toHaveLength(1);
    expect(PANEL).toContain("if (lapsed.length === 0) return null;");
    // And the lapsed branch is computed only after the upcoming one returns.
    expect(PANEL.indexOf("if (upcoming.length > 0)")).toBeLessThan(
      PANEL.indexOf("const lapsed = booked")
    );
  });
});

describe("nothing was removed from the panel", () => {
  it.each([
    ["the pitch", "<strong>Pitch:</strong>"],
    ["the angle", "<strong>Angle:</strong>"],
    ["the discovery questions", 'title="Ask on the call"'],
    ["the proposal CTA", "Prepare the proposal →"],
    ["the call-notes CTA", "Log call notes"],
  ])("%s is still there", (_label, needle) => {
    expect(PANEL).toContain(needle);
  });

  it("the panel still appears for a meeting_booked prospect", () => {
    expect(PAGE).toContain('prospect.status === "meeting_booked" ||');
  });

  it("both time frames still RENDER correctly (fmt is unchanged)", () => {
    // A booking renders in UTC because it stores Irish wall-clock as UTC.
    expect(PANEL).toContain("fmt(m.scheduled_at, Boolean(m.strategy_booking_id))");
  });
});

describe("the surfaces that already used the rule still do", () => {
  it.each([
    ["the dashboard", ["app", "growth", "(app)", "page.tsx"]],
    ["the meetings page", ["app", "growth", "(app)", "meetings", "page.tsx"]],
  ])("%s still imports splitMeetings", (_label, rel) => {
    const src = readFileSync(path.join(ROOT, ...rel), "utf8");
    expect(src).toContain('from "@/lib/growth/meeting-order"');
  });
});
