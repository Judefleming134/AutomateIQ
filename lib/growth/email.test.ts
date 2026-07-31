import { describe, it, expect } from "vitest";
import {
  reviewOutreachEmail,
  sanitizeOutreachBody,
  draftLooksBroken,
} from "@/lib/growth/email";

/**
 * The send-review gates.
 *
 * These run before anything leaves the platform unattended at 07:00. CLAUDE.md
 * calls them inviolable, and the reason is commercial rather than tidy: an
 * outreach email that goes out with a placeholder, an invented sender or a link
 * to someone else's website costs a customer permanently and damages a sending
 * domain that took a month to warm.
 *
 * Every case below is a real failure shape one of these gates was written to
 * catch. If a change makes one of these pass through, that is the alarm.
 */

/** A clean 40-word first touch — the control for every hold test. */
const GOOD_BODY = [
  "Hi Sarah,",
  "",
  "I noticed Kavanagh Plant Hire still takes booking enquiries by phone only, which usually means someone is tied to a desk during the busiest part of the day answering the same three questions.",
  "",
  "We build small systems that answer those automatically and put the booking straight into your calendar. Would fifteen minutes this week suit to show you?",
  "",
  "Jude",
].join("\n");

const GOOD_SUBJECT = "quick question about Kavanagh Plant Hire";

describe("reviewOutreachEmail — the pre-send gate", () => {
  it("passes a clean draft", () => {
    expect(reviewOutreachEmail({ subject: GOOD_SUBJECT, body: GOOD_BODY })).toBeNull();
  });

  it("holds a body that is too short to be a real first touch", () => {
    expect(
      reviewOutreachEmail({ subject: GOOD_SUBJECT, body: "Hi Sarah, fancy a chat? Jude" })
    ).toBe("body suspiciously short for a first touch");
  });

  it("holds a body too long for cold outreach", () => {
    const wall = Array.from({ length: 400 }, () => "word").join(" ");
    expect(reviewOutreachEmail({ subject: GOOD_SUBJECT, body: wall })).toBe(
      "body far too long for cold outreach"
    );
  });

  it("holds an empty subject", () => {
    expect(reviewOutreachEmail({ subject: "   ", body: GOOD_BODY })).toBe("empty subject");
  });

  it("holds a subject that will truncate badly", () => {
    expect(
      reviewOutreachEmail({ subject: "a".repeat(79), body: GOOD_BODY })
    ).toBe("subject too long — will truncate badly");
  });

  it.each([
    ["free", "Get a free audit for Kavanagh"],
    ["double bang", "Open this!!"],
    ["100%", "100% more bookings for Kavanagh"],
    ["guarantee", "We guarantee more bookings"],
    ["act now", "Act now — Kavanagh Plant Hire"],
    ["limited time", "Limited time offer for Kavanagh"],
  ])("holds a spam-trigger subject (%s)", (_label, subject) => {
    expect(reviewOutreachEmail({ subject, body: GOOD_BODY })).toBe("spam-trigger subject");
  });

  describe("link safety — the host must genuinely be ours", () => {
    const withLink = (url: string) => GOOD_BODY.replace("Jude", `${url}\n\nJude`);

    it.each([
      "https://automateiq.ie/book",
      "https://www.automateiq.ie/book",
      "https://booking.automateiq.ie/x",
    ])("allows %s", (url) => {
      expect(reviewOutreachEmail({ subject: GOOD_SUBJECT, body: withLink(url) })).toBeNull();
    });

    it.each([
      // Each of these merely MENTIONS our domain. A substring check — what this
      // gate used to do — waved all of them through.
      ["path lookalike", "https://evil.com/automateiq.ie"],
      ["subdomain lookalike", "https://automateiq.ie.attacker.com/phish"],
      // Not malicious, just an ordinary model hallucination — which is exactly
      // why this was reachable without anyone attacking anything.
      ["hallucinated search link", "https://google.com/search?q=automateiq.ie"],
      ["plain foreign link", "https://competitor.example/pricing"],
    ])("holds a %s", (_label, url) => {
      expect(reviewOutreachEmail({ subject: GOOD_SUBJECT, body: withLink(url) })).toBe(
        "contains a link to a non-AutomateIQ site"
      );
    });
  });

  it("runs draftLooksBroken first, so a placeholder is reported as such", () => {
    expect(
      reviewOutreachEmail({ subject: GOOD_SUBJECT, body: `${GOOD_BODY}\n\n[Your Company]` })
    ).toBe("still contains a [placeholder]");
  });
});

describe("draftLooksBroken", () => {
  it("passes a clean draft", () => {
    expect(draftLooksBroken(GOOD_BODY)).toBeNull();
  });

  it("catches a leftover [placeholder]", () => {
    expect(draftLooksBroken("Hi [Client Name], hope you're well.")).toBe(
      "still contains a [placeholder]"
    );
  });

  it("catches an unfilled {{template_key}}", () => {
    // A template merged for a prospect missing that field would otherwise paste
    // the raw token into a real inbox.
    expect(draftLooksBroken("Hi {{first_name}}, hope you're well.")).toBe(
      "still contains an unfilled {{placeholder}}"
    );
  });

  it("catches an invented sender name", () => {
    expect(draftLooksBroken("Hi there, I'm Sarah from AutomateIQ and I wanted to reach out.")).toBe(
      'signed by an invented name ("Sarah")'
    );
  });

  it("allows the real sender", () => {
    expect(draftLooksBroken("Hi there, I'm Jude from AutomateIQ and I wanted to reach out.")).toBeNull();
  });

  it("catches a made-up job title", () => {
    expect(draftLooksBroken("I'm a business analyst who works with firms like yours.")).toBe(
      "claims a made-up job title"
    );
  });
});

describe("sanitizeOutreachBody", () => {
  it.each(["[Your Name]", "[your name]", "[Name]", "[Sender Name]", "[My Name]"])(
    "replaces %s with the real sender",
    (placeholder) => {
      expect(sanitizeOutreachBody(`Thanks,\n${placeholder}`)).toBe("Thanks,\nJude");
    }
  );

  it("strips a bare [Title] line", () => {
    expect(sanitizeOutreachBody("Jude\n[Your Title]\nAutomateIQ")).toBe("Jude\n\nAutomateIQ");
  });

  it("collapses runs of blank lines and trims", () => {
    expect(sanitizeOutreachBody("\n\nHi there.\n\n\n\nThanks,\nJude\n\n")).toBe(
      "Hi there.\n\nThanks,\nJude"
    );
  });

  it("leaves a clean body untouched", () => {
    expect(sanitizeOutreachBody(GOOD_BODY)).toBe(GOOD_BODY);
  });

  it("output of the sanitizer is what the gate should be given", () => {
    // The autopilot sanitizes first and reviews the sanitized text, then sends
    // that same text — this pins the ordering the send path depends on.
    const messy = `${GOOD_BODY}\n\nThanks,\n[Your Name]`;
    const clean = sanitizeOutreachBody(messy);
    expect(clean).not.toContain("[Your Name]");
    expect(reviewOutreachEmail({ subject: GOOD_SUBJECT, body: clean })).toBeNull();
    // ...whereas the raw draft would have been held.
    expect(reviewOutreachEmail({ subject: GOOD_SUBJECT, body: messy })).toBe(
      "still contains a [placeholder]"
    );
  });
});
