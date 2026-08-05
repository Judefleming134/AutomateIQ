import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { canDial } from "./dialling";

/**
 * The meetings page offered a one-tap dial to prospects who had opted out —
 * and, unlike every other list, gave no sign of it whatsoever.
 *
 * lib/growth/dialling.ts draws the line deliberately: a LIST withholds the
 * tel: link, the WORKSPACE keeps it as a considered override, because the
 * workspace already opens with a panel saying outreach is off for this lead.
 * The prospects table has honoured that since canDial was written. The
 * meetings page never did.
 *
 * And it was worse there than it had ever been on the prospects table. The
 * only badge on a meeting card is the MEETING's status — booked, completed,
 * no-show — so a prospect carrying do_not_contact had NO signal on the card at
 * all. On the prospects table the badge at least existed, four columns of
 * horizontal scrolling away.
 *
 * The combination is reachable without Jude touching anything:
 *
 *   1. a lead books a Strategy Session      → ge_meetings row, status booked
 *   2. they reply STOP to a later follow-up → the inbound classifier sets
 *                                             do_not_contact AUTOMATICALLY
 *   3. the meeting card still shows a tel: link under his thumb
 *
 * That is the exact accident canDial's own docstring was written about: "one
 * tap is all it takes to ring someone who asked him to stop — which is a
 * reputational and an ePrivacy problem, not an inconvenience."
 *
 * The number is not hidden. Only the link is withheld, and the card now says
 * why — with a pointer to the workspace, where the override still lives.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");

const MEETINGS = read("app", "growth", "(app)", "meetings", "page.tsx");
const PROSPECTS = read("app", "growth", "(app)", "prospects", "page.tsx");
const WORKSPACE = read("app", "growth", "(app)", "prospects", "[id]", "page.tsx");
const DIALLING = read("lib", "growth", "dialling.ts");

describe("the rule itself", () => {
  it("only do_not_contact withholds the dial", () => {
    expect(canDial("do_not_contact")).toBe(false);
    for (const s of [
      "new", "researching", "research_complete", "outreach_ready", "contacted",
      "follow_up_sent", "replied", "qualified", "meeting_booked",
      "proposal_sent", "negotiation", "won", "lost", "archived",
    ]) {
      expect(canDial(s), s).toBe(true);
    }
  });

  it("an unknown or missing status still dials", () => {
    // Fail OPEN here, deliberately: withholding a dial from a lead who never
    // opted out costs a customer too, and this is not a security boundary.
    expect(canDial(null)).toBe(true);
    expect(canDial(undefined)).toBe(true);
    expect(canDial("")).toBe(true);
  });

  it("the rule is stated where it is enforced", () => {
    expect(DIALLING).toContain("the list");
    expect(DIALLING).toContain("do_not_contact");
  });
});

describe("every LIST that offers a dial honours it", () => {
  it.each([
    ["the prospects table", () => PROSPECTS],
    ["the meetings page", () => MEETINGS],
  ])("%s calls canDial before rendering a tel: link", (_label, get) => {
    const src = get();
    expect(src).toContain('from "@/lib/growth/dialling"');
    expect(src).toMatch(/canDial\(\w+[?.]*\.?status\)/);
  });

  it("the meetings page fetches the status it needs to decide", () => {
    // It selected id, company, contact_name, phone — so it could not have
    // honoured the rule even if it had tried.
    expect(MEETINGS).toContain('.select("id, company, contact_name, phone, status")');
    expect(MEETINGS).toContain("status: string;");
  });

  it("both keep the number visible — only the link goes", () => {
    for (const [label, src] of [
      ["prospects", PROSPECTS],
      ["meetings", MEETINGS],
    ] as const) {
      // The withheld branch still renders the number, struck through.
      expect(src, label).toContain('textDecoration: "line-through"');
      expect(src, label).toContain("dialling is disabled here on purpose");
    }
  });
});

describe("the meetings card says WHY, because it shows no prospect status", () => {
  it("the only badge on the card is the MEETING's status", () => {
    // Which is exactly why a bare struck-through number would read as a bug.
    expect(MEETINGS).toContain("MEETING_STATUS_META[m.status as MeetingStatus]");
  });

  it("so an opted-out prospect gets a badge of their own", () => {
    expect(MEETINGS).toContain("Do not contact");
    expect(MEETINGS).toContain("they opted out");
  });

  it("and is told where the override lives", () => {
    // The workspace keeps its tel: link on purpose — the rule is "withhold on
    // the list", not "never dial again".
    expect(MEETINGS).toContain("dial from their page if you need to override");
  });
});

describe("the workspace override is untouched", () => {
  it("the prospect page still offers the dial", () => {
    // Deliberate, and documented in dialling.ts: it already opens with a panel
    // saying outreach is off for this lead, so the dial there is a considered
    // act rather than a mis-tap.
    expect(WORKSPACE).toContain("href={`tel:${prospect.phone.replace(/[^\\d+]/g, \"\")}`}");
    expect(DIALLING).toContain("The prospect workspace keeps its tel: link on purpose");
  });
});

describe("the sequence that makes this reachable", () => {
  it("a booked meeting and an opt-out can coexist", () => {
    // Nothing clears a meeting when a prospect opts out, and nothing should —
    // the meeting happened, or is about to be cancelled by a human.
    const meeting = { status: "booked" };
    const prospect = { status: "do_not_contact" };
    expect(meeting.status).toBe("booked");
    expect(canDial(prospect.status)).toBe(false);
  });

  it("and the opt-out arrives without anyone touching the record", () => {
    // The half that makes this a real accident rather than a hypothetical.
    const route = read("app", "api", "webhooks", "inbound-email", "route.ts");
    expect(route).toContain("do_not_contact");
  });
});
