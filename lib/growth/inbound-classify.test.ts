import { describe, it, expect } from "vitest";
import {
  classifyInbound,
  parseReturnDate,
  stripQuoted,
} from "@/lib/growth/inbound-classify";

/**
 * Inbound classification.
 *
 * Every inbound used to be treated as a human writing back: status → replied,
 * the chase sequence stopped, and a paid AI call made to draft a response.
 * At 50 sends a day a holiday auto-responder silently dropped live leads out
 * of the automation, and "remove me from your list" never set do_not_contact.
 *
 * The classifier is deliberately conservative — when unsure it says "human",
 * which is the behaviour that shipped before it existed. The six human cases
 * at the bottom are the ones that matter most: a false auto_reply parks a warm
 * lead, and that is the expensive direction to be wrong in.
 */

const NOW = new Date("2026-07-31T09:00:00Z");

describe("classifyInbound — auto-replies", () => {
  it.each([
    [
      "Outlook, subject-marked",
      "Automatic reply: question about Kavanagh Plant Hire",
      "I am out of the office until 12 August with limited access to email.\nFor urgent matters please contact Sinead on 087 123 4567.",
    ],
    [
      "Gmail vacation responder, no subject marker",
      "Re: quick question",
      "Thanks for your email. I'm currently on annual leave and will be back in the office on 4 August. I'll reply then.",
    ],
    ["terse, weekday only", "Out of Office", "Away from my desk, back Monday."],
    [
      "numeric Irish date",
      "Auto: Re: 15 minutes next week?",
      "On leave until 06/08/2026. Please contact info@acme.ie in my absence.",
    ],
    [
      "left the company",
      "Undeliverable: question about Doyle Motors",
      "The recipient no longer works at this company. This is an automated response.",
    ],
    [
      "minimal — two families only",
      "Re: 15 minutes?",
      "I am out of the office until Monday.",
    ],
  ])("classifies %s", (_label, subject, body) => {
    expect(classifyInbound(subject, body).kind).toBe("auto_reply");
  });

  it("honours an RFC 3834 header over any text heuristic", () => {
    const got = classifyInbound("Re: hello", "Back on 20 August.", {
      "Auto-Submitted": "auto-replied",
    });
    expect(got.kind).toBe("auto_reply");
    expect(got.reason).toContain("auto-submitted");
  });

  it("does NOT treat auto-submitted: no as an auto-reply", () => {
    expect(
      classifyInbound("Re: hello", "Sounds good, Thursday works for me.", {
        "Auto-Submitted": "no",
      }).kind
    ).toBe("human");
  });
});

describe("classifyInbound — opt-outs", () => {
  it.each([
    ["bare unsubscribe", "Unsubscribe"],
    ["remove me", "Please remove me from your mailing list."],
    ["stop emailing", "Stop emailing me. Thanks."],
    ["do not contact", "Do not contact me again about this."],
    ["GDPR erasure", "Delete my data and take me off your list."],
    ["opt out", "I'd like to opt out of these emails please."],
  ])("classifies %s", (_label, body) => {
    expect(classifyInbound("Re: intro", body).kind).toBe("opt_out");
  });
});

describe("classifyInbound — humans must stay human", () => {
  it.each([
    ["warm yes", "Sounds interesting — can you do Thursday at 10?"],
    [
      // The case that broke the first version of the classifier: two markers
      // fired off a single clause ("I'm out of" and "out of office"), which
      // parked a warm lead. Markers are grouped into families for this reason.
      "mentions being out of office in passing (ONE signal)",
      "I'm out of office next week but this sounds relevant — can we talk after?",
    ],
    [
      "asks about pricing",
      "What does something like this typically cost for a team of eight? We looked at a few before and they were all far too heavy for us.",
    ],
    ["polite no — not a removal request", "Thanks but we're not interested at the moment."],
    [
      "mentions a holiday mid-thread",
      "Great, thanks. One thing — the lads are on holidays the first week of August so let's aim for after that. Can you send the pricing in the meantime?",
    ],
  ])("keeps %s as human", (_label, body) => {
    expect(classifyInbound("Re: intro", body).kind).toBe("human");
  });

  it("is not fooled by an 'unsubscribe' in THEIR quoted footer", () => {
    // Our outreach carries no unsubscribe footer, but theirs might, and a
    // quoted thread would otherwise turn "yes please" into a false opt-out.
    const body = [
      "Yes please send it over.",
      "",
      "On 30 July 2026, Jude Fleming wrote:",
      "> Would 15 minutes suit?",
      "> To unsubscribe from these updates click here",
    ].join("\n");
    expect(classifyInbound("Re: question about Nolan Electrical", body).kind).toBe("human");
  });
});

describe("stripQuoted", () => {
  it("drops quoted lines and everything after a reply header", () => {
    const out = stripQuoted("My answer.\n\nOn 1 Jan 2026, X wrote:\n> old text");
    expect(out).toBe("My answer.");
  });

  it("drops an Outlook original-message divider", () => {
    expect(stripQuoted("Reply.\n-----Original Message-----\nold")).toBe("Reply.");
  });
});

describe("parseReturnDate", () => {
  it.each([
    ["day then month", "I am out of the office until 12 August.", "2026-08-12"],
    ["month then day", "Back on August 4 with limited access.", "2026-08-04"],
    ["numeric, day-first (Irish)", "On leave until 06/08/2026.", "2026-08-06"],
    ["ordinal", "I return on 3rd Sept.", "2026-09-03"],
  ])("reads %s", (_label, body, expected) => {
    expect(parseReturnDate(body, NOW)).toBe(expected);
  });

  it("refuses to guess at a weekday-only notice", () => {
    // A wrong guess silently moves a real chase and nobody would see why.
    expect(parseReturnDate("Away from my desk, back Monday.", NOW)).toBeNull();
  });

  it("ignores a date beyond the 90-day horizon", () => {
    expect(parseReturnDate("Back on 12 August 2028.", NOW)).toBeNull();
  });

  // These two are the regression this suite was written to catch. Before the
  // (?!\d) guard, the month-first pattern read the YEAR's first two digits as a
  // day: "25 August 2026" resolved to August 20 and the chase went out five
  // days early, while the prospect was still away.
  it("does not read a 4-digit year as a day", () => {
    expect(parseReturnDate("Back on 25 August 2026.", NOW)).toBe("2026-08-25");
  });

  it("does not invent a nearby date when the real one is out of range", () => {
    // "12 August 2028" is beyond the horizon; the answer is "we don't know",
    // not a phantom 2026 date.
    expect(parseReturnDate("Back on 12 August 2028.", NOW)).not.toBe("2026-08-20");
  });

  it("respects the 90-day horizon over the year roll-forward", () => {
    // In July, "back on 5 January" rolls to next year and is then rightly out
    // of range — an auto-reply that far out tells us nothing useful.
    expect(parseReturnDate("Back on 5 January.", NOW)).toBeNull();
  });

  it("rolls a bare day/month into next year across the year boundary", () => {
    // The case the roll-forward exists for: in December, "back on 5 January"
    // means next January and is comfortably inside the horizon.
    expect(parseReturnDate("Back on 5 January.", new Date("2026-12-15T09:00:00Z"))).toBe(
      "2027-01-05"
    );
  });
});
