import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { dublinDate } from "./dates";

/**
 * "Mark proposal as sent" wrote a promise to the timeline that it kept in only
 * one of four cases.
 *
 * The activity line read, unconditionally:
 *
 *     Proposal marked as sent by Jude — follow-up scheduled in 7 days
 *
 * while the UPDATE that schedules that follow-up is skipped for a CLOSED lead,
 * skipped when the prospect row can't be read, and — because its error was
 * discarded outright — silently absent whenever the write failed.
 *
 *     prospect state          chase actually set   timeline said
 *     ─────────────────────   ──────────────────   ────────────────────────────
 *     contacted               +7 days              scheduled in 7 days      ✓
 *     negotiation             +7 days, no regress  scheduled in 7 days      ✓
 *     won / lost / archived   NONE, deliberately   scheduled in 7 days      ✗
 *     row unreadable          NONE                 scheduled in 7 days      ✗
 *     update failed           NONE                 scheduled in 7 days      ✗
 *
 * A proposal is the deal-closing document. A proposal with no chase date is one
 * nobody follows up — and the one surface that would have shown that said the
 * opposite, so there was nothing to notice.
 *
 * Two other things were wrong in the same block: the prospect update's error was
 * never captured at all, and this file was missed by the revalidateProspectSurfaces
 * sweep — so a changed next_follow_up_at left the call list showing the old tier.
 *
 * Same defect class and the same fix as setMeetingStatus (meeting-outcome.test.ts):
 * say which of the outcomes actually happened.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const ACTIONS = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "prospects", "proposal-actions.ts"),
  "utf8"
);
const FN = ACTIONS.slice(
  ACTIONS.indexOf("export async function markProposalSent"),
  ACTIONS.indexOf("export async function deleteProposal")
);
/** Comments stripped — the file explains at length what it used to do. */
const CODE = FN.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const CLOSED = ["won", "lost", "do_not_contact", "archived"];
const LATER_THAN_SENT = ["proposal_sent", "negotiation"];

type Outcome = { note: string; wrote: Record<string, unknown> | null };

/**
 * A replay of the shipped branch, so the table above can be asserted rather
 * than described. Mirrors markProposalSent's chaseNote block exactly.
 */
function markSent(prospect: { status: string } | null, writeFails = false): Outcome {
  if (!prospect) {
    return {
      note: " — but the prospect couldn't be read, so NO follow-up was scheduled. Set the next step by hand.",
      wrote: null,
    };
  }
  if (CLOSED.includes(prospect.status)) {
    return { note: ` — no follow-up scheduled, this lead is '${prospect.status}'.`, wrote: null };
  }
  const update: Record<string, unknown> = {
    last_contact_at: "now",
    next_follow_up_at: dublinDate(7),
  };
  if (!LATER_THAN_SENT.includes(prospect.status)) update.status = "proposal_sent";
  if (writeFails) {
    return {
      note: " — BUT scheduling the follow-up failed (timeout). There is NO chase date on this proposal; set one by hand.",
      wrote: null,
    };
  }
  return { note: ` — follow-up scheduled for ${dublinDate(7)}`, wrote: update };
}

/** What the line said before the fix, in every one of these cases. */
const OLD_NOTE = " — follow-up scheduled in 7 days";
const promisesAChase = (note: string) => /follow-up scheduled (in|for)/.test(note);

describe("the timeline now says what actually happened", () => {
  it("a working send: chase set, and the line names the date", () => {
    const out = markSent({ status: "contacted" });
    expect(out.wrote).toMatchObject({ status: "proposal_sent", next_follow_up_at: dublinDate(7) });
    expect(out.note).toBe(` — follow-up scheduled for ${dublinDate(7)}`);
    expect(promisesAChase(out.note)).toBe(true);
  });

  it.each(CLOSED)("a '%s' lead gets no chase — and is no longer told it did", (status) => {
    const out = markSent({ status });
    expect(out.wrote).toBeNull();
    expect(promisesAChase(out.note)).toBe(false);
    expect(out.note).toContain(status);
    // The old line, on this exact row, was simply false.
    expect(promisesAChase(OLD_NOTE)).toBe(true);
  });

  it("an unreadable prospect row says so and asks for the step by hand", () => {
    const out = markSent(null);
    expect(out.wrote).toBeNull();
    expect(promisesAChase(out.note)).toBe(false);
    expect(out.note).toContain("NO follow-up was scheduled");
    expect(out.note).toContain("by hand");
  });

  it("a FAILED write is reported as failed, not as a scheduled chase", () => {
    // The sharpest of the three: nothing else anywhere records this.
    const out = markSent({ status: "contacted" }, true);
    expect(out.wrote).toBeNull();
    expect(promisesAChase(out.note)).toBe(false);
    expect(out.note).toContain("NO chase date");
  });

  it("every case that sets no chase date now says no chase date", () => {
    const cases: Outcome[] = [
      markSent(null),
      ...CLOSED.map((status) => markSent({ status })),
      markSent({ status: "contacted" }, true),
    ];
    for (const out of cases) {
      expect(out.wrote, out.note).toBeNull();
      expect(promisesAChase(out.note), out.note).toBe(false);
    }
    // ...and the old line promised one in all six.
    expect(cases.every(() => promisesAChase(OLD_NOTE))).toBe(true);
  });
});

describe("the forward-only status rule survived the fix", () => {
  it("an early-stage lead is moved to proposal_sent", () => {
    for (const status of ["new", "researched", "contacted", "proposal_in_progress"]) {
      expect(markSent({ status }).wrote).toMatchObject({ status: "proposal_sent" });
    }
  });

  it("a negotiation keeps its status but still refreshes the dates", () => {
    // A revised proposal re-sent during negotiation restarts the chase clock
    // without dragging the stage backwards.
    const out = markSent({ status: "negotiation" });
    expect(out.wrote).not.toHaveProperty("status");
    expect(out.wrote).toMatchObject({ next_follow_up_at: dublinDate(7) });
    expect(out.wrote).toHaveProperty("last_contact_at");
  });

  it("a re-sent proposal_sent also restarts the clock", () => {
    const out = markSent({ status: "proposal_sent" });
    expect(out.wrote).not.toHaveProperty("status");
    expect(out.wrote).toMatchObject({ next_follow_up_at: dublinDate(7) });
  });

  it("a closed lead is never given a chase date back", () => {
    for (const status of CLOSED) expect(markSent({ status }).wrote).toBeNull();
  });
});

describe("the action matches the replay", () => {
  it("the unconditional promise is gone", () => {
    expect(CODE).not.toContain("follow-up scheduled in 7 days");
  });

  it("it captures the prospect update's error instead of discarding it", () => {
    expect(CODE).toContain("const { error: bumpError } = await admin");
    expect(CODE).toContain("bumpError");
  });

  it("it branches on all three no-chase cases", () => {
    expect(CODE).toContain("if (!prospect)");
    expect(CODE).toContain("CLOSED.includes(prospect.status)");
    expect(CODE).toContain("bumpError");
  });

  it("the working line names the real date, not a relative phrase", () => {
    expect(CODE).toContain("follow-up scheduled for ${dublinDate(7)}");
  });

  it("the same two status lists the replay uses", () => {
    expect(CODE).toContain('const CLOSED = ["won", "lost", "do_not_contact", "archived"]');
    expect(CODE).toContain('const LATER_THAN_SENT = ["proposal_sent", "negotiation"]');
  });

  it("refreshes every prospect surface, since next_follow_up_at just moved", () => {
    // The call list tiers on next_follow_up_at — see prospect-surfaces.ts.
    expect(CODE).toContain("revalidateProspectSurfaces(proposal.prospect_id)");
    expect(ACTIONS).toContain(
      'import { revalidateProspectSurfaces } from "@/lib/growth/prospect-surfaces"'
    );
  });
});

describe("nothing about the working path changed", () => {
  it("still refuses a proposal that isn't there", () => {
    expect(CODE).toContain('return { error: "Proposal not found." }');
  });

  it("still checks the proposal update's own error first, and bails on it", () => {
    const i = CODE.indexOf("const { error } = await admin");
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(CODE.indexOf("const { data: prospect }"));
    expect(CODE).toContain("if (error) return { error: error.message }");
  });

  it("still marks the proposal itself sent", () => {
    expect(CODE).toContain('.update({ status: "sent" })');
  });

  it("still stamps last_contact_at — sending a proposal is contact", () => {
    expect(CODE).toContain("last_contact_at: new Date().toISOString()");
  });

  it("still writes a status_change activity naming the member", () => {
    expect(CODE).toContain('type: "status_change"');
    expect(CODE).toContain("Proposal marked as sent by ${member.name}");
  });

  it("still returns ok on the happy path", () => {
    expect(CODE.trimEnd().endsWith("return { ok: true };\n}")).toBe(true);
  });
});
