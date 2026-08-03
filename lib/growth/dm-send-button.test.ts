import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * "Copy & open" said it had opened a tab that a popup blocker had stopped.
 *
 * The button does two things in one tap, deliberately: copy THIS prospect's
 * DM and open THEIR profile, so the clipboard and the open tab can never
 * belong to two different businesses. It already got the hard part right —
 * window.open runs synchronously, before the clipboard await, or Safari and
 * Firefox treat it as a popup.
 *
 * What it did not do was say when the popup was blocked anyway. The branch
 * existed, with a comment ("Popup blocked: the copy still worked, but nothing
 * opened"), and then folded that state into "done" — so the button read
 * "Copied — reopen Instagram" and no tab had appeared.
 *
 * On a 15-DM session behind a blocker that is every single tap: the copy
 * works, the profile never shows, and the button insists it did its job.
 *
 * The ordering of the three failure states is the part worth pinning. A
 * clipboard failure must always win over a blocked tab, because pasting the
 * PREVIOUS prospect's message is the thing this button exists to prevent, and
 * a missing tab is merely annoying.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SRC = readFileSync(
  path.join(ROOT, "components", "growth", "dm-send-button.tsx"),
  "utf8"
);

/** The decision, transcribed from the component. */
const outcome = (copied: boolean, opened: boolean) =>
  !copied ? "failed" : opened ? "done" : "blocked";

/** What it used to do: blocked was indistinguishable from success. */
const before = (copied: boolean) => (copied ? "done" : "failed");

describe("every combination lands somewhere honest", () => {
  it.each([
    ["everything works", true, true, "done"],
    ["popup blocker on", true, false, "blocked"],
    ["clipboard denied", false, true, "failed"],
    ["blocker AND clipboard denied", false, false, "failed"],
  ])("%s", (_label, copied, opened, expected) => {
    expect(outcome(copied as boolean, opened as boolean)).toBe(expected);
  });

  it("the blocked case used to look exactly like success", () => {
    expect(before(true)).toBe("done");
    expect(outcome(true, false)).toBe("blocked");
    expect(outcome(true, false)).not.toBe(before(true));
  });

  it("a clipboard failure always outranks a blocked tab", () => {
    // Pasting the previous prospect's message is the failure this button
    // exists to prevent. A missing tab is an inconvenience.
    expect(outcome(false, false)).toBe("failed");
    expect(outcome(false, true)).toBe("failed");
  });
});

describe("the component says it, and gives a way through", () => {
  it("has a distinct blocked state", () => {
    expect(SRC).toContain('"idle" | "done" | "failed" | "blocked"');
    expect(SRC).toContain('setState(!copied ? "failed" : win ? "done" : "blocked")');
  });

  it("no longer folds a blocked popup into done", () => {
    // The bug, in one expression.
    expect(SRC).not.toContain('setState((s) => (s === "failed" ? "failed" : "done"))');
  });

  it("offers a real anchor, not another window.open", () => {
    // A direct click can't be blocked; a second programmatic open would be.
    // Comments stripped first — the branch's own comment says "not another
    // window.open", and matching that would be the test reading the excuse
    // rather than the code.
    const block = SRC.slice(SRC.indexOf('{state === "blocked" &&')).replace(
      /\/\*[\s\S]*?\*\//g,
      ""
    );
    expect(block).toContain("<a href={link}");
    expect(block).toContain('target="_blank"');
    expect(block).not.toContain("window.open(");
  });

  it("tells them the message IS copied, so they don't re-copy the wrong one", () => {
    // Whitespace-collapsed: JSX wraps this copy across lines, and pinning the
    // exact wrapping would break on a reformat without anything being wrong.
    const block = SRC.slice(SRC.indexOf('{state === "blocked" &&')).replace(/\s+/g, " ");
    expect(block).toContain("Copied — but your browser blocked the new tab");
    expect(block).toContain("allow pop-ups for this site");
  });

  it("announces itself to a screen reader", () => {
    const block = SRC.slice(SRC.indexOf('{state === "blocked" &&'));
    expect(block).toContain('role="alert"');
  });
});

describe("the hard part it already got right is untouched", () => {
  it("still opens BEFORE awaiting the clipboard", () => {
    // Awaiting first loses the user gesture and Safari/Firefox block the tab —
    // which would turn the new "blocked" state into the normal case.
    expect(SRC.indexOf("window.open(link")).toBeLessThan(
      SRC.indexOf("await navigator.clipboard.writeText")
    );
  });

  it("still opens with noopener,noreferrer", () => {
    expect(SRC).toContain('"_blank", "noopener,noreferrer"');
  });

  it("still shouts on a clipboard failure", () => {
    const flat = SRC.replace(/\s+/g, " ");
    expect(flat).toContain("Couldn&apos;t copy to your clipboard");
    expect(flat).toContain("the last prospect&apos;s message");
  });

  it("still copies and opens in ONE action", () => {
    // Two buttons is how the previous prospect's message got pasted.
    const go = SRC.slice(SRC.indexOf("async function go()"), SRC.indexOf("return ("));
    expect(go).toContain("window.open");
    expect(go).toContain("clipboard.writeText");
  });
});
