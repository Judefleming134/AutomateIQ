import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Delete, in the outreach queue, had neither of the two things a destructive
 * button needs.
 *
 * 1. NO CONFIRMATION. It sat a few millimetres from "Send email now", on a
 *    list that runs to dozens of rows of small buttons, and one tap destroyed
 *    a draft with no undo. Every other destructive action in the engine —
 *    prospects, proposals, templates, campaigns, team members — already asks
 *    first, using the confirmText prop ActionForm has had all along. This one
 *    was simply missed.
 *
 * 2. THE DELETE ERROR WAS DISCARDED. `await admin.delete()` with no error
 *    check, then `return { ok: true }`. A refused or failed delete reported
 *    success and the row stayed. On a QUEUED message that is the worst
 *    version: the page says the send is cancelled, the message is still
 *    queued, and the 07:00 cron sends it anyway.
 *
 * Both are named classes in CLAUDE.md — "destructive overwrite with no undo"
 * and "reporting success for work that didn't happen" — in the same six lines.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const PAGE = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "inbox", "page.tsx"),
  "utf8"
);
const ACTIONS = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "inbox", "actions.ts"),
  "utf8"
);
const FORM = readFileSync(path.join(ROOT, "components", "admin", "action-form.tsx"), "utf8");

/** deleteMessage's body alone. */
const DELETE_FN = ACTIONS.slice(
  ACTIONS.indexOf("export async function deleteMessage"),
  ACTIONS.indexOf("export", ACTIONS.indexOf("export async function deleteMessage") + 10)
);

/** The Delete form in the queue, with comments stripped. */
const DELETE_FORM = (() => {
  const i = PAGE.indexOf("<ActionForm\n                      action={deleteMessage}");
  return PAGE.slice(i, PAGE.indexOf("</ActionForm>", i));
})();

describe("the one irreversible button now asks first", () => {
  it("the delete form carries a confirmText", () => {
    expect(DELETE_FORM).toContain("confirmText=");
  });

  it("warns that deleting a QUEUED message cancels the 07:00 send", () => {
    // The consequence worth stopping to read: this is not just losing text,
    // it is cancelling a send that was otherwise going out.
    expect(DELETE_FORM).toContain('m.status === "queued"');
    expect(DELETE_FORM).toContain("scheduled to send at 07:00");
    expect(DELETE_FORM).toContain("cancels that send");
  });

  it("tells a failed message's reader to copy the text first", () => {
    expect(DELETE_FORM).toContain('m.status === "failed"');
    expect(DELETE_FORM).toContain("copy anything worth keeping first");
  });

  it("does not promise a draft can be regenerated identically", () => {
    // The Studio writes a NEW draft, not this one back. Saying "you can
    // regenerate it" would be the comforting lie.
    expect(DELETE_FORM).toContain("writes a new one, not this one");
  });

  it("names the prospect, so the wrong row is obvious in the dialog", () => {
    expect(DELETE_FORM).toContain("p?.company");
  });

  it("ActionForm actually blocks the submit on cancel", () => {
    // The prop is only worth anything if the form honours it.
    expect(FORM).toContain("if (confirmText && !window.confirm(confirmText)) e.preventDefault();");
  });

  it("matches how every other destructive action in the engine behaves", () => {
    for (const [file, action] of [
      ["app/growth/(app)/settings/page.tsx", "deleteTemplate"],
      ["app/growth/(app)/campaigns/[id]/page.tsx", "deleteCampaign"],
      ["app/growth/(app)/prospects/[id]/page.tsx", "deleteProspect"],
    ] as const) {
      const src = readFileSync(path.join(ROOT, file), "utf8");
      // Anchor on the FORM, not the first mention — the first mention is the
      // import at the top of the file, nowhere near the confirm. And the
      // opening tag wraps across lines in most of these, so walk back from
      // the action prop to the <ActionForm that owns it rather than matching
      // an exact one-line string.
      const propAt = src.indexOf(`action={${action}}`);
      expect(propAt, `no action={${action}} in ${file}`).toBeGreaterThan(-1);
      const open = src.lastIndexOf("<ActionForm", propAt);
      expect(open, `action={${action}} is not inside an ActionForm`).toBeGreaterThan(-1);
      const form = src.slice(open, src.indexOf("</ActionForm>", open));
      expect(form, `${action} lost its confirmText`).toContain("confirmText");
    }
  });
});

describe("a delete that fails no longer reports success", () => {
  it("captures the error instead of discarding it", () => {
    expect(DELETE_FN).toContain("const { error } = await admin");
    expect(DELETE_FN).toMatch(/\.delete\(\)\s*\.eq\("id", id\)/);
    // The exact shape of the bug: an awaited delete whose result is dropped.
    const code = DELETE_FN.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/^\s*await admin\.from\("ge_messages"\)\.delete\(\)/m);
  });

  it("says the queued message is STILL GOING OUT when the delete fails", () => {
    // Without this the user believes the send is cancelled and finds out at
    // 07:00. This is the whole reason the error matters here.
    expect(DELETE_FN).toContain("still queued and will send at 07:00");
  });

  it("returns an error, not ok, on failure", () => {
    const failureBranch = DELETE_FN.slice(DELETE_FN.indexOf("if (error)"));
    expect(failureBranch).toContain("return {");
    expect(failureBranch.slice(0, failureBranch.indexOf("}"))).not.toContain("ok: true");
  });

  it("only revalidates after a delete that actually happened", () => {
    // Refreshing on a failed delete would re-render the row it claimed to
    // remove, which reads as the page ignoring the click.
    expect(DELETE_FN.indexOf("if (error)")).toBeLessThan(
      DELETE_FN.indexOf("revalidateProspect(")
    );
  });

  it("the form surfaces the error to the user", () => {
    expect(FORM).toContain("state?.error");
  });
});

describe("nothing about the working path changed", () => {
  it("sent and received messages are still undeletable", () => {
    // The conversation record. This guard predates the fix and must survive.
    expect(DELETE_FN).toContain('["draft", "queued", "failed"].includes(message.status)');
    expect(DELETE_FN).toContain("conversation record");
  });

  it("still refuses a message that isn't there", () => {
    expect(DELETE_FN).toContain('return { error: "Message not found." }');
  });

  it("the other queue buttons are untouched", () => {
    expect(PAGE).toContain("Send email now");
    expect(PAGE).toContain("Mark as sent");
    expect(PAGE).toContain('label="Copy text"');
  });

  it("send and mark-sent deliberately have NO confirm", () => {
    // They are reversible-ish and used constantly; a dialog on every send
    // would be friction on the path that makes money.
    const sendForm = PAGE.slice(
      PAGE.indexOf("<ActionForm action={sendQueuedEmail}>"),
      PAGE.indexOf("</ActionForm>", PAGE.indexOf("<ActionForm action={sendQueuedEmail}>"))
    );
    expect(sendForm).not.toContain("confirmText");
  });
});
