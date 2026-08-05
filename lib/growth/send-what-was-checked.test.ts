import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sanitizeOutreachBody, draftLooksBroken } from "./email";

/**
 * Every send path must transmit the STRING IT CHECKED. One didn't.
 *
 * `sanitizeOutreachBody` is not a formatter — it is half of the placeholder
 * gate. It turns "[Your Name]" into "Jude" and strips a bare "[Your Title]"
 * line; `draftLooksBroken` then refuses anything with a "[placeholder]" left.
 * Run in that order the pair is sound. Run the check on the sanitized text and
 * then send the RAW text, and the pair inverts: every draft the sanitizer
 * quietly fixed passes the check and is delivered still broken.
 *
 * `composeMessage(mode: "send_email")` did exactly that —
 *
 *     const broken = draftLooksBroken(sanitizeOutreachBody(body));
 *     if (broken) return ...;
 *     const sent = await sendOutreachEmail({ to, subject, body });  // RAW
 *
 * — and it is the path behind the inbox "Respond" composer and the Message
 * Studio: the reply Jude writes BY HAND to a prospect who has just written
 * back. The warmest lead in the pipeline, sent an email signed "[Your Name]".
 *
 * The other two paths already carried the fix and the note explaining it:
 *
 *     sendAutopilotEmail   "SEND THE TEXT THE GATE REVIEWED"     (07:00 cron)
 *     sendQueuedEmail      "SEND THE TEXT THE GATE CHECKED"      (queue view)
 *
 * so this was the third and last one. CLAUDE.md's send-review gates are called
 * inviolable precisely because "an outreach email with the wrong company's
 * details in it costs a customer permanently"; a visible [placeholder] in a
 * reply is the same currency.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const INBOX = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "inbox", "actions.ts"),
  "utf8"
);
const AUTOPILOT = readFileSync(path.join(ROOT, "lib", "growth", "autopilot.ts"), "utf8");

/** The `send_email` branch of composeMessage. */
const COMPOSE = INBOX.slice(
  INBOX.indexOf("export async function composeMessage"),
  INBOX.indexOf("export async function sendQueuedEmail")
);
const QUEUED = INBOX.slice(
  INBOX.indexOf("export async function sendQueuedEmail"),
  INBOX.indexOf("export async function markMessageSent")
);
const AUTO = AUTOPILOT.slice(
  AUTOPILOT.indexOf("export async function sendAutopilotEmail"),
  AUTOPILOT.indexOf("export async function runQueuedEmailAutopilot")
);

/** Drafts the sanitizer repairs — i.e. the ones that used to leak. */
const REPAIRED = [
  ["AI sign-off placeholder", "Tuesday at 10 suits grand.\n\nBest,\n[Your Name]"],
  ["'my name' variant", "Happy to talk it through.\n\nRegards,\n[My Name]"],
  ["'sender name' variant", "I'll send the details over.\n\n[Sender Name]"],
  ["a bare title line", "Talk soon.\n\nJude\n[Your Title]"],
] as const;

/** Drafts the sanitizer canNOT repair — these must still be blocked outright. */
const UNFIXABLE = [
  ["an unknown placeholder", "Hi [Contact First Name], quick one."],
  ["an unfilled template key", "Hi {{first_name}}, quick one."],
  ["an invented sender", "Hi there — I'm Sarah from AutomateIQ and I wanted to reach out."],
  ["a made-up job title", "I'm a business analyst here at AutomateIQ."],
] as const;

describe("the gate and the wire now agree", () => {
  it.each(REPAIRED)("%s: passes the gate, and what's SENT is repaired", (_label, raw) => {
    const clean = sanitizeOutreachBody(raw);
    // It gets through the gate — correctly, because sanitising fixed it...
    expect(draftLooksBroken(clean)).toBeNull();
    // ...but the raw text is still broken, which is what used to go out.
    expect(draftLooksBroken(raw)).toBe("still contains a [placeholder]");
    // The fix: the shipped body is the checked body.
    expect(clean).not.toMatch(/\[[^\]\n]{2,40}\]/);
    expect(draftLooksBroken(clean)).toBeNull();
  });

  it("every repaired draft would have leaked, and now none does", () => {
    const leaked = REPAIRED.filter(([, raw]) => {
      const clean = sanitizeOutreachBody(raw);
      return draftLooksBroken(clean) === null && raw !== clean;
    });
    // All four: the gate passed them and the raw text differed from the checked
    // text, which is exactly the leak.
    expect(leaked.length).toBe(REPAIRED.length);
    // After the fix the sent string is `clean`, and none of those is broken.
    for (const [, raw] of leaked) {
      expect(draftLooksBroken(sanitizeOutreachBody(raw))).toBeNull();
    }
  });

  it.each(UNFIXABLE)("%s is still refused outright — the gate is not softened", (_label, raw) => {
    expect(draftLooksBroken(sanitizeOutreachBody(raw))).not.toBeNull();
  });

  it("a clean draft is untouched, so ordinary sends are unaffected", () => {
    const clean = "Thanks for coming back to me — Tuesday at 10 works.\n\nJude";
    expect(sanitizeOutreachBody(clean)).toBe(clean);
    expect(draftLooksBroken(clean)).toBeNull();
  });
});

describe("composeMessage sends what it checked", () => {
  it("it sanitizes once, into a named variable", () => {
    expect(COMPOSE).toContain("const cleanBody = sanitizeOutreachBody(row.body);");
  });

  it("the check runs on that variable", () => {
    expect(COMPOSE).toContain("const broken = draftLooksBroken(cleanBody);");
  });

  it("and THAT is what goes to Resend", () => {
    const send = COMPOSE.slice(COMPOSE.indexOf("await sendOutreachEmail({"));
    expect(send).toContain("body: cleanBody,");
    // The exact shape of the bug: the bare `body` argument.
    expect(send.slice(0, send.indexOf("});"))).not.toMatch(/\bbody,\s*$/m);
  });

  it("the repaired text is persisted, so the timeline shows what went out", () => {
    expect(COMPOSE).toContain("if (cleanBody !== row.body)");
    expect(COMPOSE).toContain('.update({ body: cleanBody })');
  });

  it("it sanitizes the STORED row, so sent = checked = recorded", () => {
    // row.body is already truncated to 10,000; sanitizing the untruncated
    // input instead could store one string and send another at the boundary.
    expect(COMPOSE).toContain("sanitizeOutreachBody(row.body)");
    expect(COMPOSE).toContain("body: body.slice(0, 10000)");
  });
});

describe("all three send paths do the same thing", () => {
  it.each([
    ["sendAutopilotEmail (07:00 cron)", () => AUTO],
    ["sendQueuedEmail (queue view)", () => QUEUED],
    ["composeMessage (inbox + Studio)", () => COMPOSE],
  ])("%s sanitizes, checks and sends one string", (_label, get) => {
    const src = get();
    expect(src).toMatch(/const cleanBody = sanitizeOutreachBody\(/);
    expect(src).toContain("body: cleanBody,");
    // The gate is `draftLooksBroken` on the two manual paths and the full
    // `reviewOutreachEmail` on the 07:00 one — which calls draftLooksBroken
    // itself and then adds length, subject and link checks. Either is fine;
    // what matters is that whichever runs, it runs on cleanBody.
    expect(src).toMatch(/(draftLooksBroken\(cleanBody\)|body: cleanBody,)/);
    expect(
      src.includes("draftLooksBroken(cleanBody)") ||
        src.includes("reviewOutreachEmail({")
    ).toBe(true);
  });

  it("the 07:00 path runs the FULL review on the same clean string", () => {
    // Stronger than the manual paths, deliberately: an unattended send gets
    // length, subject-quality and link checks too. It must still be the
    // sanitized body it reviews.
    const review = AUTO.slice(AUTO.indexOf("const held = reviewOutreachEmail({"));
    expect(review.slice(0, review.indexOf("});"))).toContain("body: cleanBody,");
  });

  it("none of them still passes a bare `body` to the sender", () => {
    for (const [label, src] of [
      ["auto", AUTO],
      ["queued", QUEUED],
      ["compose", COMPOSE],
    ] as const) {
      const i = src.indexOf("await sendOutreachEmail({");
      const call = src.slice(i, src.indexOf("})", i));
      expect(call, label).not.toMatch(/^\s*body,\s*$/m);
    }
  });
});

describe("nothing else about composeMessage changed", () => {
  it("still refuses a non-email channel for direct send", () => {
    expect(COMPOSE).toContain('return { ok: false, error: "Direct sending is only available for email." }');
  });

  it("still refuses a prospect with no email", () => {
    expect(COMPOSE).toContain("This prospect has no email address on file.");
  });

  it("still marks the row failed when Resend rejects it", () => {
    expect(COMPOSE).toContain('.update({ status: "failed" })');
  });

  it("still books the same CRM side-effects on success", () => {
    expect(COMPOSE).toContain("await recordOutreachSent(");
  });

  it("still updates an existing draft in place rather than duplicating it", () => {
    expect(COMPOSE).toContain("Studio flow: the row already exists as a draft");
    // The property: the SAME row id comes back, so a second save (or a later
    // send) edits that draft instead of creating a duplicate. Matched on the
    // id rather than the whole literal — the success result also carries the
    // send outcome now, and the shape must be free to grow.
    expect(COMPOSE).toMatch(/return \{ ok: true, messageId: message\.id[,}]/);
    expect(COMPOSE).toContain("message = { id: input.messageId };");
  });

  it("queue and draft modes are untouched — they are sanitized at send time", () => {
    // A queued row goes out via sendAutopilotEmail, which sanitizes; a draft is
    // sanitized by whichever path eventually sends it. Only send_email needed
    // this, so only send_email was changed.
    expect(COMPOSE).toContain('status: input.mode === "queue" ? "queued" : "draft"');
    expect(COMPOSE.indexOf("const cleanBody")).toBeGreaterThan(
      COMPOSE.indexOf('if (input.mode === "send_email")')
    );
  });
});
