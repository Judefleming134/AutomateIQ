import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The call list hid everyone the 07:00 email run had just touched.
 *
 * It decided "already called today" from `last_contact_at >= todayStart`. That
 * column is stamped by recordOutreachSent on EVERY outreach touch — the email
 * autopilot, "Mark sent" on the DM list, the composer, the inbox Send button —
 * not just by a call.
 *
 * So on an ordinary morning the autopilot emailed its thirty best-scored ready
 * prospects, and those same thirty vanished from the call list before Jude
 * opened it. They are the top-scored thirty BY CONSTRUCTION, because that is
 * exactly who the autopilot picks. Then the page congratulated him — "30 done
 * today", in green — before he had dialled a number.
 *
 * Two of this codebase's named bug classes at once: a count that doesn't match
 * what its click-through shows, and reporting work that didn't happen.
 *
 * Worse for the one thing the page is built to protect: a DUE CHASE that had
 * been emailed this morning was removed by the filter BEFORE the due-first tier
 * sort ran, so the sort that exists to float it to the top never saw it.
 *
 * The signal is now the timeline — a ge_activities row of type call or meeting
 * today — which is written by Log call, by a logged meeting, and by No answer.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const PAGE = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "call-list", "page.tsx"),
  "utf8"
);
const ACTIONS = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "prospects", "actions.ts"),
  "utf8"
);
const OUTREACH = readFileSync(path.join(ROOT, "lib", "growth", "outreach.ts"), "utf8");

const TODAY_START = "2026-08-03T23:00:00Z"; // Dublin midnight, summer

type P = { id: string; score: number; last_contact_at: string; due?: boolean };

/** 60 callable leads. The autopilot emailed the top 30 at 07:00 this morning. */
const pool: P[] = Array.from({ length: 60 }, (_, i) => ({
  id: `p${i + 1}`,
  score: 100 - i,
  last_contact_at: i < 30 ? "2026-08-04T06:00:00Z" : "2026-07-28T10:00:00Z",
  due: i === 12 || i === 41,
}));

/** The old rule: any contact today, by any channel. */
const before = (p: P) => p.last_contact_at >= TODAY_START;
/** The new rule: a call or meeting logged today. */
const after = (worked: string[]) => (p: P) => worked.includes(p.id);

/** Filter, then tier-sort due first, then cap — the page's real order. */
function view(called: (p: P) => boolean) {
  const left = pool.filter((p) => !called(p));
  const shown = [...left]
    .sort((a, b) => (a.due ? 0 : 1) - (b.due ? 0 : 1))
    .slice(0, 40);
  return {
    shown,
    doneToday: pool.filter(called).length,
    topScore: shown.length ? shown[0].score : null,
    dueShown: shown.filter((p) => p.due).length,
  };
}

describe("the morning the engine emailed thirty people", () => {
  it("no longer reports calls Jude has not made", () => {
    expect(view(before).doneToday).toBe(30); // rung nobody
    expect(view(after([])).doneToday).toBe(0);
  });

  it("counts up as he actually works, not from 30", () => {
    const worked = ["p35", "p36", "p37"];
    // The old number was stuck at 30 all day — it could not fall, because the
    // emails that set it were sent before he started.
    expect(view(before).doneToday).toBe(30);
    expect(view(after(worked)).doneToday).toBe(3);
  });

  it("gives him back the top of his own list", () => {
    expect(view(before).shown).toHaveLength(30);
    expect(view(after([])).shown).toHaveLength(40);
    expect(view(before).topScore).toBe(59);
    expect(view(after([])).topScore).toBe(88);
  });

  it("stops a due chase being filtered out before the due-first sort", () => {
    // The tier sort floats due chases to the top. It cannot rescue a row the
    // filter already removed — which is what happened to the due chase that
    // had been emailed this morning.
    expect(view(before).dueShown).toBe(1);
    expect(view(after([])).dueShown).toBe(2);
  });

  it("still drops the person he just rang", () => {
    // The whole point of the filter survives: log a call, they go.
    const shownIds = view(after(["p35"])).shown.map((p) => p.id);
    expect(shownIds).not.toContain("p35");
    expect(shownIds).toContain("p36");
  });

  it("a lead emailed on a PREVIOUS day was never the problem", () => {
    // Only today's stamp hid anyone; this pins that the fix isn't papering
    // over a wider staleness issue.
    expect(pool.filter((p) => p.last_contact_at < TODAY_START).every((p) => !before(p))).toBe(
      true
    );
  });
});

describe("the page asks the timeline, not the contact stamp", () => {
  it("queries call/meeting activities from today", () => {
    expect(PAGE).toContain('.from("ge_activities")');
    expect(PAGE).toContain('.in("type", ["call", "meeting"])');
    expect(PAGE).toContain('.gte("created_at", todayStart)');
  });

  it("the drop rule reads the activity set, not last_contact_at", () => {
    const rule = PAGE.slice(
      PAGE.indexOf("const calledToday ="),
      PAGE.indexOf("const merged =")
    );
    expect(rule).toContain("workedTodayIds.has(p.id)");
    expect(rule).not.toContain(">= todayStart");
  });

  it("no prospect query filters on last_contact_at any more", () => {
    // The exact expression that hid them. Comments stripped so the note
    // explaining the old behaviour doesn't satisfy its own test.
    const code = PAGE.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toContain('.gte("last_contact_at", todayStart)');
  });

  it("still shows last_contact_at ON the card, which is now reachable", () => {
    // A lead emailed at 07:00 stays on the list and reads "Last contact today"
    // in orange — which is useful before dialling, and was unreachable while
    // those leads were being filtered out.
    expect(PAGE).toContain("lastContactLabel(p.last_contact_at, today)");
    expect(PAGE).toContain('lastContact === "yesterday" || lastContact === "today"');
  });
});

describe("the two counts mean two different things, on purpose", () => {
  it("credits every call, but only subtracts pool members", () => {
    expect(PAGE).toContain("const callsToday = workedTodayIds.size");
    expect(PAGE).toContain("const workedInPool = (workedInPoolRows ?? []).length");
    expect(PAGE).toContain("- workedInPool - prospects.length");
    // The display number must be the generous one: a call that moved a lead
    // out of the callable pool is still a call he made.
    expect(PAGE).toContain("{callsToday} done today");
  });

  it("chunks the pool lookup rather than serialising ids into a URL", () => {
    // ~40 chars per UUID: a heavy dialling day would build a URL that fails,
    // and a failed count here reads as "nobody worked today" — inflating the
    // very number it exists to keep honest.
    expect(PAGE).toContain("selectAllRowsByIds");
    expect(PAGE).toContain('import { selectAllRowsByIds } from "@/lib/growth/db"');
  });

  it("does not add a round trip — it rides with the research fetch", () => {
    const tail = PAGE.slice(PAGE.indexOf("const [{ data: researchRows }"));
    expect(tail.slice(0, 200)).toContain("Promise.all");
  });
});

describe("why last_contact_at was the wrong signal", () => {
  it("every outreach send stamps it", () => {
    expect(OUTREACH).toContain("last_contact_at: new Date().toISOString()");
    expect(OUTREACH).toContain("export async function recordOutreachSent");
  });

  it("and the autopilot calls that on every email it sends", () => {
    const AUTOPILOT = readFileSync(path.join(ROOT, "lib", "growth", "autopilot.ts"), "utf8");
    expect(AUTOPILOT).toContain("recordOutreachSent(");
  });

  it("while a call and a no-answer both write a 'call' activity", () => {
    expect(ACTIONS).toContain('type: "call"'); // logNoAnswer
    expect(ACTIONS).toContain('if (!["note", "call", "meeting"].includes(type))');
    // logNoAnswer's activity is written before its prospect update, so a
    // no-answer drops off today's list even if the reschedule half fails.
    const noAnswer = ACTIONS.slice(
      ACTIONS.indexOf("export async function logNoAnswer"),
      ACTIONS.indexOf("export async function addActivity")
    );
    expect(noAnswer.indexOf('.from("ge_activities")')).toBeLessThan(
      noAnswer.indexOf('.from("ge_prospects")\n    .update(bump)')
    );
  });
});
