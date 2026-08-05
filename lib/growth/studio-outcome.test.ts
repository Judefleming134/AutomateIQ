import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveChaseDate } from "./dates";

/**
 * The Message Studio told Jude the same thing after every send, and it was
 * usually wrong.
 *
 *     "Email sent ✓ — prospect moved to Contacted, follow-up scheduled in
 *      3 days."
 *
 * Neither half of that is fixed. `recordOutreachSent` — the shared bookkeeping
 * every send path runs — is careful about both:
 *
 *   STATUS   new/researched → Contacted; a second touch → Follow-up sent;
 *            and "later stages (replied, qualified, …) are never regressed by
 *            sending another message".
 *   CHASE    resolveChaseDate: a date already booked for a LATER day is KEPT.
 *            Its own comment names the case — a prospect who said "try us
 *            after the summer" had that date pulled from September to three
 *            days out, "a cold DM six weeks early to someone who explicitly
 *            asked to be left alone until then".
 *
 * So the prospect the engine handled most carefully was the one the toast lied
 * about. Replayed over six real shapes, five were wrong:
 *
 *     prospect                        toast said            truth
 *     ─────────────────────────────   ───────────────────   ────────────────────
 *     fresh researched lead           Contacted, +3d    ✓   Contacted, +3d
 *     "after the summer" (Sep date)   Contacted, +3d    ✗   Follow-up sent, Sep kept
 *     second touch, no date           Contacted, +3d    ✗   Follow-up sent, +3d
 *     they already replied            Contacted, +3d    ✗   still Replied
 *     mid-negotiation                 Contacted, +3d    ✗   still Negotiation, date kept
 *     qualified, chase next week      Contacted, +3d    ✗   still Qualified, date kept
 *
 * The TIMELINE line was already honest — "Says what actually happened rather
 * than asserting a 3-day follow-up that may not have been scheduled at all."
 * Only the on-screen message was still guessing. recordOutreachSent now
 * returns what it wrote, and the Studio renders that.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");
const OUTREACH = read("lib", "growth", "outreach.ts");
const ACTIONS = read("app", "growth", "(app)", "inbox", "actions.ts");
const STUDIO = read("components", "growth", "message-studio.tsx");

const TODAY = "2026-08-05";
const day = (n: number) => {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

type Outcome = {
  status: string;
  statusChanged: boolean;
  chaseDate: string;
  chaseKept: boolean;
};

/** recordOutreachSent's decision, replayed. */
function record(
  status: string,
  existingChase: string | null,
  opts: { explicitFollowUp?: boolean; sameTouchWindow?: boolean } = {}
): Outcome {
  const chase = resolveChaseDate(existingChase, TODAY, 3);
  const { explicitFollowUp = false, sameTouchWindow = false } = opts;
  let next = status;
  if (["new", "researching", "research_complete", "outreach_ready"].includes(status)) {
    next = "contacted";
  } else if (
    (["contacted", "follow_up_sent"].includes(status) &&
      (explicitFollowUp || !sameTouchWindow)) ||
    (explicitFollowUp &&
      !["replied", "qualified", "meeting_booked", "proposal_in_progress",
        "proposal_sent", "negotiation", "won"].includes(status))
  ) {
    next = "follow_up_sent";
  }
  return {
    status: next,
    statusChanged: next !== status,
    chaseDate: chase.date,
    chaseKept: chase.kept,
  };
}

/** What the old toast asserted, for every send. */
const OLD_CLAIM = { status: "contacted", statusChanged: true, chaseKept: false };
const matchesOldClaim = (o: Outcome) =>
  o.status === OLD_CLAIM.status &&
  o.statusChanged === OLD_CLAIM.statusChanged &&
  o.chaseKept === OLD_CLAIM.chaseKept;

describe("what the send actually did", () => {
  it("a fresh researched lead really does go to Contacted with +3d", () => {
    const o = record("research_complete", null);
    expect(o).toEqual({
      status: "contacted",
      statusChanged: true,
      chaseDate: day(3),
      chaseKept: false,
    });
    // The one case the old toast got right.
    expect(matchesOldClaim(o)).toBe(true);
  });

  it('"try us after the summer" keeps September — the case the comment names', () => {
    const o = record("contacted", "2026-09-15");
    expect(o.chaseKept).toBe(true);
    expect(o.chaseDate).toBe("2026-09-15");
    expect(o.status).toBe("follow_up_sent");
    expect(matchesOldClaim(o)).toBe(false);
  });

  it("a second touch goes to Follow-up sent, not Contacted", () => {
    const o = record("contacted", null);
    expect(o.status).toBe("follow_up_sent");
    expect(matchesOldClaim(o)).toBe(false);
  });

  it.each(["replied", "qualified", "negotiation", "won", "proposal_sent"])(
    "a %s lead is NOT regressed by sending another message",
    (status) => {
      const o = record(status, null);
      expect(o.status).toBe(status);
      expect(o.statusChanged).toBe(false);
      expect(matchesOldClaim(o)).toBe(false);
    }
  );

  it("five of the six real shapes did not match the old toast", () => {
    const shapes: Array<[string, string, string | null]> = [
      ["fresh researched lead", "research_complete", null],
      ["after the summer", "contacted", "2026-09-15"],
      ["second touch", "contacted", null],
      ["already replied", "replied", null],
      ["mid-negotiation", "negotiation", "2026-08-09"],
      ["qualified", "qualified", "2026-08-12"],
    ];
    const wrong = shapes.filter(([, s, c]) => !matchesOldClaim(record(s, c)));
    expect(wrong).toHaveLength(5);
  });
});

describe("recordOutreachSent reports what it wrote", () => {
  it("it returns the outcome type", () => {
    expect(OUTREACH).toContain("export type OutreachOutcome = {");
    expect(OUTREACH).toContain("): Promise<OutreachOutcome> {");
  });

  it("the returned status is what was actually written, not what was asked", () => {
    expect(OUTREACH).toContain(
      "const nextStatus = (bump.status as string | undefined) ?? prospect.status;"
    );
    expect(OUTREACH).toContain("statusChanged: nextStatus !== prospect.status,");
  });

  it("it reports whether the chase date was kept", () => {
    expect(OUTREACH).toContain("chaseDate: chase.date,");
    expect(OUTREACH).toContain("chaseKept: chase.kept,");
  });

  it("the chase rule itself is unchanged — a booked date is still kept", () => {
    expect(OUTREACH).toContain(
      "const chase = resolveChaseDate(fresh?.next_follow_up_at as string | null);"
    );
    expect(OUTREACH).toContain("if (!chase.kept) bump.next_follow_up_at = chase.date;");
  });

  it("the timeline line it already wrote is untouched", () => {
    expect(OUTREACH).toContain("? ` — chase kept for ${chase.date}`");
    expect(OUTREACH).toContain(": ` — follow-up scheduled for ${chase.date}`");
  });
});

describe("the outcome reaches the screen", () => {
  it("composeMessage passes it through", () => {
    expect(ACTIONS).toContain("let outcome: OutreachOutcome | undefined;");
    expect(ACTIONS).toContain("return { ok: true, messageId: message.id, outcome };");
  });

  it("it is captured on BOTH send paths", () => {
    expect(ACTIONS).toContain(
      'outcome = await recordOutreachSent(prospect, message.id, "email"'
    );
    expect(ACTIONS).toContain(
      "outcome = await recordOutreachSent(prospect, message.id, input.channel"
    );
  });

  it("the field is optional, so nothing that ignores it breaks", () => {
    expect(ACTIONS).toContain("outcome?: OutreachOutcome");
  });

  it("the Studio renders the real status and date", () => {
    expect(STUDIO).toContain("const did = result.outcome;");
    expect(STUDIO).toContain("did.statusChanged");
    expect(STUDIO).toContain("did.chaseKept");
    expect(STUDIO).toContain("your follow-up date of ${did.chaseDate} kept");
  });

  it("it uses the shared status labels, not its own copy", () => {
    expect(STUDIO).toContain("PROSPECT_STATUS_META[did.status as ProspectStatus]?.label");
  });

  it("the unconditional claim is gone", () => {
    const code = STUDIO.replace(/\/\/.*$/gm, "");
    expect(code).not.toContain("prospect moved to Contacted, follow-up scheduled in 3 days");
  });

  it("it degrades to a plain confirmation if no outcome comes back", () => {
    // A draft-save has no outcome; the message must still make sense.
    expect(STUDIO).toContain(': "recorded"');
  });
});

describe("nothing else about the Studio changed", () => {
  it("the three send verbs are still distinguished", () => {
    expect(STUDIO).toContain('"Email sent ✓"');
    expect(STUDIO).toContain('"Call logged ✓"');
    expect(STUDIO).toContain('"Recorded as sent ✓"');
  });

  it("a sent draft still clears the box and the undo", () => {
    expect(STUDIO).toContain("[key(channel, purpose)]: emptyDraft");
    expect(STUDIO).toContain("setUndo(null);");
  });

  it("draft-saving still keeps the row id so it can't duplicate", () => {
    expect(STUDIO).toContain("setActive({ messageId: result.messageId });");
    expect(STUDIO).toContain('setNotice({ kind: "ok", text: "Draft saved." });');
  });

  it("an email still needs a subject before it can go", () => {
    expect(STUDIO).toContain("Add a subject line first");
  });
});
