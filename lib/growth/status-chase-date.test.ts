import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveChaseDate } from "./dates";

/**
 * Changing a prospect's Status overwrote a follow-up date set by hand.
 *
 * The Details tab puts the "Next follow-up" field and the Status dropdown side
 * by side, and the field's own copy invites a deliberate date:
 *
 *   "Clear it or push it out to hold the auto-chase — e.g. if you're calling
 *    them yourself instead."
 *
 * Set "ring me back in 3 weeks", then mark them Replied in the panel beside it,
 * and `setProspectStatus` wrote `next_follow_up_at = +1 day` unconditionally.
 * The autopilot then chased someone who had asked for three weeks.
 *
 *     status set to     cadence   Jude had set        BEFORE      AFTER
 *     ───────────────   ───────   ─────────────────   ─────────   ─────────
 *     contacted         +3d       "3 weeks" (+21d)    +3d  ✗      +21d kept
 *     follow_up_sent    +4d       "after the BH"      +4d  ✗      kept
 *     replied           +1d       "3 weeks"           +1d  ✗      kept
 *     negotiation       +3d       a booked chase      +3d  ✗      kept
 *     any of them       —         nothing set          cadence     cadence
 *     any of them       —         a date already gone  cadence     cadence
 *
 * `resolveChaseDate` is the shared rule the OTHER four status-changing paths
 * already use — recordOutreachSent, addActivity, logNoAnswer, setMeetingStatus.
 * setProspectStatus was the only one that didn't.
 *
 * And this file already STATES the principle, a few lines below the bug, in
 * CHASE_DAYS_IF_UNSET: "An existing date — including one set by hand for a
 * reason — is never touched or pulled forward." Those four branches were the
 * ones that didn't honour it.
 *
 * NOT changed: `future_opportunity` (+90d) and the closed statuses (null).
 * Those are deliberate pushes, not a default cadence — parking a lead for three
 * months has to move the date, and a closed deal has no chase.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const ACTIONS = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "prospects", "actions.ts"),
  "utf8"
);
const FN = ACTIONS.slice(
  ACTIONS.indexOf("export async function setProspectStatus"),
  ACTIONS.indexOf("function followUpDate")
);

const TODAY = "2026-08-05";
const day = (n: number) => {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The cadences the four default-cadence statuses carry. */
const CADENCE = { contacted: 3, follow_up_sent: 4, replied: 1, negotiation: 3 } as const;
type Cadence = keyof typeof CADENCE;
const STATUSES = Object.keys(CADENCE) as Cadence[];

describe("a deliberate future date survives a status change", () => {
  it.each(STATUSES)("%s keeps a date three weeks out", (status) => {
    const chase = resolveChaseDate(day(21), TODAY, CADENCE[status]);
    expect(chase).toEqual({ date: day(21), kept: true });
    // The old behaviour, for contrast: the cadence, unconditionally.
    expect(day(CADENCE[status])).not.toBe(day(21));
  });

  it.each(STATUSES)("%s keeps a nearer booked chase too", (status) => {
    const chase = resolveChaseDate(day(5), TODAY, CADENCE[status]);
    expect(chase.kept).toBe(true);
    expect(chase.date).toBe(day(5));
  });

  it("the cost, replayed: a 3-week ask no longer becomes tomorrow", () => {
    const asked = day(21);
    const before = day(CADENCE.replied); // +1d — what shipped
    const after = resolveChaseDate(asked, TODAY, CADENCE.replied).date;
    expect(before).toBe(day(1));
    expect(after).toBe(asked);
  });
});

describe("the cadence still applies when there is nothing to keep", () => {
  it.each(STATUSES)("%s schedules its own gap when no date is set", (status) => {
    const chase = resolveChaseDate(null, TODAY, CADENCE[status]);
    expect(chase.kept).toBe(false);
    expect(chase.date).toBe(day(CADENCE[status]));
  });

  it.each(STATUSES)("%s reschedules a date already gone by", (status) => {
    // A spent chase is not a deliberate future plan — it must not suppress the
    // next one, or the lead sits permanently overdue until it ages out.
    const chase = resolveChaseDate(day(-4), TODAY, CADENCE[status]);
    expect(chase.kept).toBe(false);
    expect(chase.date).toBe(day(CADENCE[status]));
  });

  it("a malformed stored value is not mistaken for a deliberate date", () => {
    for (const junk of ["", "soon", "next week", "  ", "2026/08/26"]) {
      expect(resolveChaseDate(junk, TODAY, 3).kept).toBe(false);
    }
  });

  it("today is not the future — a chase due today still reschedules", () => {
    expect(resolveChaseDate(TODAY, TODAY, 3).kept).toBe(false);
  });
});

describe("the action routes through the shared rule", () => {
  it("it reads the current date before deciding", () => {
    expect(FN).toContain('.select("next_follow_up_at")');
    expect(FN.indexOf('.select("next_follow_up_at")')).toBeLessThan(
      FN.indexOf("resolveChaseDate(")
    );
  });

  it("it calls resolveChaseDate rather than composing a date itself", () => {
    expect(FN).toContain("const chase = resolveChaseDate(");
    expect(FN).toContain("update.next_follow_up_at = chase.date;");
  });

  it("the four cadences are declared in one table", () => {
    expect(FN).toContain("const CADENCE_DAYS: Record<string, number> = {");
    for (const [status, days] of Object.entries(CADENCE)) {
      expect(FN, status).toMatch(new RegExp(`${status}: ${days},`));
    }
  });

  it("no branch writes a cadence date unconditionally any more", () => {
    const code = FN.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toContain("update.next_follow_up_at = followUpDate(status === \"contacted\" ? 3 : 4)");
    expect(code).not.toMatch(/status === "replied"[\s\S]{0,120}followUpDate\(1\)/);
  });

  it("contacted and follow_up_sent still stamp last_contact_at", () => {
    expect(FN).toContain('if (status === "contacted" || status === "follow_up_sent") {');
    expect(FN).toContain("update.last_contact_at = new Date().toISOString();");
  });

  it("the timeline says when a date was KEPT, not only when one was added", () => {
    // Otherwise the one case Jude needs to trust is the only silent one.
    expect(FN).toContain("keptChase");
    expect(FN).toContain("your follow-up date of ${keptChase} was kept");
    expect(FN).toContain("follow-up scheduled for ${filledFollowUp}");
  });
});

describe("the deliberate pushes are untouched", () => {
  it("future_opportunity still parks the lead ~3 months out", () => {
    // Parking HAS to move the date — keeping a nearer one would defeat it.
    expect(FN).toContain('} else if (status === "future_opportunity") {');
    expect(FN).toContain("update.next_follow_up_at = followUpDate(90);");
  });

  it("a closed status still clears the chase entirely", () => {
    expect(FN).toContain("update.next_follow_up_at = null;");
    expect(FN).toContain("(CLOSED_STATUSES as string[]).includes(status)");
  });

  it("CHASE_DAYS_IF_UNSET still only fills a MISSING date", () => {
    // The three stages with no cadence of their own — unchanged, and the
    // principle this fix brings the other four into line with.
    expect(ACTIONS).toContain("if (current && !current.next_follow_up_at) {");
    expect(ACTIONS).toContain("qualified: 2,");
    expect(ACTIONS).toContain("proposal_sent: 7,");
  });
});

describe("nothing else about setProspectStatus changed", () => {
  it("still rejects an unknown status", () => {
    expect(FN).toContain('return { error: "Invalid status." }');
  });

  it("still writes a status_change activity naming the member", () => {
    expect(FN).toContain('type: "status_change"');
    expect(FN).toContain("by ${member.name}");
  });

  it("still refreshes every prospect surface", () => {
    expect(FN).toContain("revalidateProspectSurfaces(id)");
  });

  it("still returns the update's error rather than swallowing it", () => {
    expect(FN).toContain("if (error) return { error: error.message };");
  });
});
