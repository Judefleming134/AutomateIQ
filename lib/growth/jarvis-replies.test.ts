import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isHumanReply } from "./awaiting";
import { classifyInbound } from "./inbound-classify";

/**
 * Jarvis was handed the twelve newest inbound messages, unclassified — so it
 * called out-of-office bounces "replies", and never saw the real ones.
 *
 * Two separate faults in one `.limit(12)`:
 *
 *   1. THE CAP RAN BEFORE ANY CLASSIFICATION. August in Ireland: a day where
 *      a dozen holiday auto-responders land fills the twelve-row window with
 *      bounces, and the two genuine replies underneath never reach the model
 *      at all. Jarvis then answers "who replied?" off a snapshot that had
 *      silently dropped the answer — a confident wrong answer, not a short one.
 *   2. WHAT DID ARRIVE WAS UNLABELLED. An out-of-office reads exactly like a
 *      person, so "Kelly Roofing replied — answer them today" was a sentence
 *      Jarvis could produce about an automated bounce. An opt-out could land
 *      in a "who should I contact" answer the same way.
 *
 * Replayed over a realistic day (12 auto-replies/opt-outs, 2 real replies):
 *
 *   OLD  rows seen 12 · actual people among them 0 · real replies never seen 2
 *   NEW  replies from people 2 · auto-replies & opt-outs 12, labelled · missed 0
 *
 * The morning brief fixed exactly this shape (REPLY_SCAN 60, filter after) and
 * the dashboard, the inbox and the webhook are all on the same classifier.
 * Jarvis's chat was the last surface counting a bounce as a person — and the
 * one that talks in sentences, so it is the one that says it out loud.
 *
 * Nothing is hidden: the non-human inbound is still in the snapshot, on its
 * own labelled block, so "did anyone opt out?" and "who's on holiday?" stay
 * answerable.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const JARVIS = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "jarvis", "actions.ts"),
  "utf8"
);
const BRIEF = readFileSync(
  path.join(ROOT, "lib", "cron", "jarvis-morning-brief.ts"),
  "utf8"
);

type In = { company: string; subject: string; body: string };
const OOO = (company: string): In => ({
  company,
  subject: "Out of office",
  body: "I am on annual leave and will return on 12 August. For urgent matters contact the office.",
});
const STOP = (company: string): In => ({
  company,
  subject: "Re: quick question",
  body: "Please unsubscribe me and remove my details.",
});
const REAL = (company: string, body: string): In => ({
  company,
  subject: "Re: quick question",
  body,
});

/** A realistic August day: holidays everywhere, two real replies underneath. */
const day: In[] = [
  OOO("Kelly Roofing"), OOO("Nolan Electrical"), OOO("Byrne Plumbing"),
  OOO("Doyle Tiling"), STOP("Walsh Fencing"), OOO("Quinn Glazing"),
  OOO("Farrell Paving"), OOO("Moran Windows"), OOO("Hayes Solar"),
  STOP("Casey Security"), OOO("Lynch Joinery"), OOO("Brady Roofing"),
  REAL("Murphy Groundworks", "Interesting — what would this cost for 6 vans?"),
  REAL("O'Shea Interiors", "Can you do a demo Thursday morning?"),
];

describe("the day that broke it", () => {
  it("the old cap saw twelve rows and not one person", () => {
    const seen = day.slice(0, 12); // .limit(12) on raw inbound
    expect(seen).toHaveLength(12);
    expect(seen.filter(isHumanReply)).toHaveLength(0);
  });

  it("and both real replies were never fetched at all", () => {
    const seen = day.slice(0, 12);
    const realTotal = day.filter(isHumanReply).length;
    expect(realTotal).toBe(2);
    expect(realTotal - seen.filter(isHumanReply).length).toBe(2);
  });

  it("scanning wide finds them, every time", () => {
    const scanned = day.slice(0, 60); // .limit(60)
    const human = scanned.filter(isHumanReply);
    expect(human.map((m) => m.company)).toEqual([
      "Murphy Groundworks",
      "O'Shea Interiors",
    ]);
  });

  it("the auto-replies are kept, not dropped — just moved and labelled", () => {
    const scanned = day.slice(0, 60);
    const other = scanned.filter((m) => !isHumanReply(m));
    expect(other).toHaveLength(12);
    // And each one can say what it is.
    const labels = other.map((m) => classifyInbound(m.subject, m.body).kind);
    expect(new Set(labels)).toEqual(new Set(["auto_reply", "opt_out"]));
    expect(labels.filter((k) => k === "opt_out")).toHaveLength(2);
  });

  it("an out-of-office that names a date carries it through", () => {
    // Worth mentioning as a reason to chase THEN — which the prompt now says.
    const c = classifyInbound("Out of office", OOO("x").body);
    expect(c.returnsOn).toBe("2026-08-12");
  });

  it("nobody is counted twice — the two lists partition the scan", () => {
    const scanned = day.slice(0, 60);
    const human = scanned.filter(isHumanReply);
    const other = scanned.filter((m) => !isHumanReply(m));
    expect(human.length + other.length).toBe(scanned.length);
    expect(human.filter((m) => other.includes(m))).toEqual([]);
  });
});

describe("the snapshot Jarvis is built from", () => {
  it("scans wide before it caps", () => {
    expect(JARVIS).toContain(".limit(60)");
    expect(JARVIS).toContain("const REPLY_LIST_CAP = 12;");
    // The classification happens on the fetched rows, not in the query.
    expect(JARVIS).toContain("const humanInbound = (inbound ?? []).filter((m) => isHumanReply(m));");
    expect(JARVIS).toContain("const otherInbound = (inbound ?? []).filter((m) => !isHumanReply(m));");
  });

  it("no longer caps raw inbound at twelve", () => {
    // The exact shape of the bug.
    const inboundQuery = JARVIS.slice(
      JARVIS.indexOf('.eq("direction", "inbound")'),
      JARVIS.indexOf('.eq("direction", "inbound")') + 200
    );
    expect(inboundQuery).not.toContain(".limit(12)");
  });

  it("fetches the SUBJECT, which the classifier needs", () => {
    // classifyInbound reads subject and body together — an out-of-office is
    // most reliably identified by its subject line. Selecting only the body
    // would have quietly weakened every classification here.
    expect(JARVIS).toContain(
      '.select("prospect_id, channel, subject, body, sentiment, created_at, ge_prospects(company)")'
    );
  });

  it("says how many replies it is NOT listing", () => {
    expect(JARVIS).toContain("more replies not listed here");
  });

  it("gives the non-human inbound its own labelled block", () => {
    expect(JARVIS).toContain("AUTO-REPLIES & OPT-OUTS (not replies");
    expect(JARVIS).toContain("autoInboundLines");
    expect(JARVIS).toContain('"OPTED OUT"');
    expect(JARVIS).toContain("`AUTO-REPLY, back ${c.returnsOn}`");
  });

  it("the replies header says it means PEOPLE", () => {
    // The old header was "RECENT INBOUND REPLIES", which reads as all inbound.
    expect(JARVIS).toContain("RECENT REPLIES FROM PEOPLE");
    expect(JARVIS).not.toContain('"RECENT INBOUND REPLIES:"');
  });
});

describe("the rule is spelled out to the model, not just in the data", () => {
  it("there is a hard rule saying an auto-reply is not a reply", () => {
    expect(JARVIS).toContain("AN AUTO-REPLY IS NOT A REPLY");
  });

  it("it covers all three ways it used to go wrong", () => {
    const rule = JARVIS.slice(
      JARVIS.indexOf("AN AUTO-REPLY IS NOT A REPLY"),
      JARVIS.indexOf("JUDGE REPLY RATES AGAINST SEND AGE")
    );
    expect(rule).toContain("counted as a reply");
    expect(rule).toContain("named as one");
    expect(rule).toContain("put on a list of people to answer");
  });

  it("and it tells Jarvis what a return date is actually good for", () => {
    expect(JARVIS).toContain("a reason to chase THEN, not now");
  });

  it("the do-not-contact rule is untouched", () => {
    expect(JARVIS).toContain("NEVER put a prospect marked 'Do not contact' into a dial list");
    expect(JARVIS).toContain("[DO NOT CALL]");
  });
});

describe("every surface is finally on the one classifier", () => {
  it.each([
    ["the morning brief", () => BRIEF],
    ["Jarvis's chat", () => JARVIS],
  ])("%s classifies inbound before counting it", (_label, get) => {
    expect(get()).toMatch(/classifyInbound|isHumanReply/);
  });

  it("Jarvis uses the shared helper, not its own copy of the rule", () => {
    expect(JARVIS).toContain('from "@/lib/growth/awaiting"');
    expect(JARVIS).toContain('from "@/lib/growth/inbound-classify"');
  });

  it("and it scans as wide as the brief does", () => {
    // The brief settled on 60 for the same reason. If one moves, the two
    // surfaces start answering "who replied?" differently again.
    expect(BRIEF).toContain("const REPLY_SCAN = 60;");
    expect(JARVIS).toContain(".limit(60)");
  });
});
