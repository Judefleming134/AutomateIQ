import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { canDial } from "./dialling";

/**
 * Jarvis would hand Jude the phone number of someone who had opted out.
 *
 * There are three dial surfaces in the engine. Two of them guard this:
 *
 *   prospects table   canDial(p.status) → the number renders struck through
 *                     and NOT as a tel: link
 *   call list         WORKABLE statuses exclude do_not_contact outright
 *   JARVIS            no guard at all
 *
 * Jarvis's prospect snapshot is `.order("lead_score").limit(150)` with NO
 * status filter, so a do-not-contact lead is in the data it reasons over —
 * and being high-scoring, near the top of it. The DIAL PREP rule told it to
 * "Skip prospects with no phone, and any already replied/qualified/booked",
 * which does not mention opt-outs. "Prep my dial list — top 10 calls with
 * numbers, openers and why" is the FIRST starter button in the chat.
 *
 * Replayed on a five-row fixture, the opted-out lead sorted FIRST (score 91)
 * and appeared on the generated call sheet with its number.
 *
 * canDial's own doc comment already sets out why this matters, for the table:
 *
 *   "the inbound classifier began setting `do_not_contact` AUTOMATICALLY on an
 *    opt-out reply. Before that, the status only appeared because Jude set it —
 *    he knew. Now a prospect can carry it without him ever touching the record.
 *    … one tap is all it takes to ring someone who asked him to stop — which is
 *    a reputational and an ePrivacy problem, not an inconvenience."
 *
 * All of that is equally true of a call sheet Jarvis reads out.
 *
 * Fixed the way the doctrine says: the number is NOT hidden ("The number itself
 * is never hidden"), but the prohibition now travels with it — the snapshot
 * tags it [DO NOT CALL], so a number copied into a call sheet drags the warning
 * along — plus a hard rule and an explicit exclusion in DIAL PREP.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const JARVIS = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "jarvis", "actions.ts"),
  "utf8"
);
const CHAT = readFileSync(
  path.join(ROOT, "components", "growth", "jarvis-chat.tsx"),
  "utf8"
);
const TABLE = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "prospects", "page.tsx"),
  "utf8"
);
const CALL_LIST = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "call-list", "page.tsx"),
  "utf8"
);

type Row = { company: string; status: string; score: number; phone: string | null };

const FIXTURE: Row[] = [
  { company: "Murphy Plumbing", status: "contacted", score: 88, phone: "+353871234567" },
  { company: "Byrne Electrical", status: "do_not_contact", score: 91, phone: "+353861112223" },
  { company: "Kelly Builders", status: "follow_up_sent", score: 74, phone: "+353851239876" },
  { company: "Walsh Roofing", status: "archived", score: 79, phone: "+353877654321" },
  { company: "Nolan Tiling", status: "outreach_ready", score: 66, phone: null },
];

/** The snapshot query: score-ordered, no status filter. */
const snapshot = () => [...FIXTURE].sort((a, b) => b.score - a.score);

/** The phone field of a snapshot line, as the shipped code now builds it. */
function phoneField(r: Row): string | null {
  if (!r.phone) return null;
  return canDial(r.status) ? `☎ ${r.phone}` : `☎ ${r.phone} [DO NOT CALL — they opted out]`;
}

describe("the opted-out lead really does reach Jarvis", () => {
  it("it is in the snapshot at all — there is no status filter", () => {
    expect(JARVIS).toContain('.select(SNAPSHOT_COLS)');
    const snap = JARVIS.slice(
      JARVIS.indexOf('.from("ge_prospects")\n        .select(SNAPSHOT_COLS)'),
      JARVIS.indexOf('.limit(150)') + 12
    );
    // The DUE query filters closed statuses; this one deliberately does not,
    // so Jude can still ask "who opted out?".
    expect(snap).not.toContain("activeFilter");
  });

  it("and it sorts to the TOP, because opt-outs are often high-scoring", () => {
    expect(snapshot()[0].company).toBe("Byrne Electrical");
    expect(snapshot()[0].status).toBe("do_not_contact");
  });

  it("the other two dial surfaces would both have refused it", () => {
    const WORKABLE = ["contacted", "follow_up_sent", "outreach_ready", "research_complete"];
    const optedOut = FIXTURE.find((r) => r.status === "do_not_contact")!;
    expect(canDial(optedOut.status)).toBe(false);
    expect(WORKABLE.includes(optedOut.status)).toBe(false);
  });
});

describe("the prohibition now travels with the number", () => {
  it("an opted-out prospect's number is tagged", () => {
    const optedOut = FIXTURE.find((r) => r.status === "do_not_contact")!;
    expect(phoneField(optedOut)).toContain("[DO NOT CALL — they opted out]");
  });

  it("the number is still THERE — it is never hidden", () => {
    // Same doctrine as canDial's comment and the prospects table.
    const optedOut = FIXTURE.find((r) => r.status === "do_not_contact")!;
    expect(phoneField(optedOut)).toContain(optedOut.phone!);
  });

  it("every dialable prospect is completely unchanged", () => {
    for (const r of FIXTURE.filter((x) => x.phone && canDial(x.status))) {
      expect(phoneField(r)).toBe(`☎ ${r.phone}`);
      expect(phoneField(r)).not.toContain("DO NOT CALL");
    }
  });

  it("a prospect with no phone still contributes nothing", () => {
    expect(phoneField(FIXTURE.find((r) => !r.phone)!)).toBeNull();
  });

  it("exactly one row in the fixture carries the tag", () => {
    const tagged = FIXTURE.filter((r) => (phoneField(r) ?? "").includes("DO NOT CALL"));
    expect(tagged.map((r) => r.company)).toEqual(["Byrne Electrical"]);
  });

  it("the snapshot builder uses the shared canDial rule, not its own test", () => {
    expect(JARVIS).toContain('import { canDial } from "@/lib/growth/dialling";');
    expect(JARVIS).toContain("? canDial(p.status)");
    expect(JARVIS).toContain("[DO NOT CALL — they opted out]");
  });
});

describe("the prompt tells it the rule, twice", () => {
  it("a hard rule forbids opt-outs in any contact list", () => {
    expect(JARVIS).toContain(
      "NEVER put a prospect marked 'Do not contact' into a dial list"
    );
    // Says WHY it can appear without Jude knowing.
    expect(JARVIS).toContain("sets that status AUTOMATICALLY on an opt-out reply");
  });

  it("it still permits answering a direct question about opt-outs", () => {
    // A ban that also blocked "how many opted out?" would be worse, not safer.
    expect(JARVIS).toContain("when he asks specifically about opt-outs");
  });

  it("DIAL PREP names the exclusion explicitly", () => {
    expect(JARVIS).toContain("anyone marked 'Do not contact' (never dial an opt-out");
  });

  it("the old rule's other exclusions are still there", () => {
    expect(JARVIS).toContain("Skip prospects with no phone");
    expect(JARVIS).toContain("already replied/qualified/booked");
  });
});

describe("this is a real one-tap path, not a hypothetical", () => {
  it("'Prep my dial list' is a starter button in the chat", () => {
    expect(CHAT).toContain("Prep my dial list");
  });

  it("the two guarded surfaces still guard", () => {
    // If either regressed, the doctrine this fix follows would be gone.
    expect(TABLE).toContain("canDial(p.status)");
    expect(CALL_LIST).toContain(
      'const WORKABLE = ["contacted", "follow_up_sent", "outreach_ready", "research_complete"]'
    );
  });

  it("canDial still blocks only do_not_contact", () => {
    // lost/archived are Jude's own decisions, not the prospect's — ringing a
    // lost lead to reopen it is legitimate, so this must not widen.
    expect(canDial("do_not_contact")).toBe(false);
    for (const s of ["contacted", "lost", "archived", "won", "replied", "new"]) {
      expect(canDial(s), s).toBe(true);
    }
  });
});
