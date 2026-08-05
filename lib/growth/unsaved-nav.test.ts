import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { shouldConfirmLeaving, type NavClick } from "./unsaved-nav";

/**
 * The prospect workspace's Details tab threw away edits on a tab click.
 *
 * Sixteen fields — company, contact, job title, industry, website, location,
 * email, phone, LinkedIn, Instagram, Facebook, campaign, owner, follow-up date,
 * pipeline value, notes — behind ONE Save button at the bottom. The workspace
 * tabs sit directly above them and are `<Link>`s, so tapping "Conversation"
 * mid-edit is a client-side navigation: React unmounts the form and every
 * uncommitted keystroke is gone. No warning, nothing to undo it with.
 *
 * "Destructive overwrite with no undo" is one of CLAUDE.md's named classes.
 * This is that, wearing ordinary clothes — and it is the likeliest way to lose
 * a phone number just copied off a company's website, which is exactly what
 * the Details tab is for on a dial day.
 *
 * The guard has to be conservative in BOTH directions. Interrupting a click
 * that was never going to lose anything is the fastest way to train someone to
 * hit OK without reading, and then the one prompt that mattered gets dismissed
 * too. So the rule lives here, as a pure function, rather than tangled into
 * the DOM listener — the suite is deliberately node-only (see vitest.config),
 * and a decision this fiddly should not be asserted by reading source.
 */

const click = (over: Partial<NavClick> = {}): NavClick => ({
  dirty: true,
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
  href: "/growth/prospects/abc?tab=conversation",
  linkTarget: null,
  ...over,
});

describe("the click that loses the work", () => {
  it("a plain tap on a workspace tab, mid-edit", () => {
    // THE case. This is what silently discarded sixteen fields.
    expect(shouldConfirmLeaving(click())).toBe(true);
  });

  it("any other in-app link too — the sidebar, 'Open prospect', a breadcrumb", () => {
    for (const href of ["/growth/inbox", "/growth/prospects", "/growth", "/growth/meetings"]) {
      expect(shouldConfirmLeaving(click({ href })), href).toBe(true);
    }
  });

  it("and an external one, which is still leaving", () => {
    expect(shouldConfirmLeaving(click({ href: "https://example.com" }))).toBe(true);
  });
});

describe("the clicks it must NOT interrupt", () => {
  it("an untouched form — reading the tab and clicking away costs nothing", () => {
    expect(shouldConfirmLeaving(click({ dirty: false }))).toBe(false);
  });

  it("a BUTTON, including this form's own Save", () => {
    // href null = the click wasn't on an anchor at all. Submitting is how you
    // stop being dirty; prompting on save would be the most annoying possible
    // reading of an unsaved-changes guard, and the fastest way to get every
    // prompt dismissed unread.
    expect(shouldConfirmLeaving(click({ href: null }))).toBe(false);
  });

  it.each([
    ["cmd-click", { metaKey: true }],
    ["ctrl-click", { ctrlKey: true }],
    ["shift-click", { shiftKey: true }],
    ["alt-click", { altKey: true }],
    ["middle-click", { button: 1 }],
  ])("%s — opens a NEW tab, this form stays put", (_label, over) => {
    expect(shouldConfirmLeaving(click(over))).toBe(false);
  });

  it('target="_blank" — same reason', () => {
    // The prospect page is full of these: the website link, the social
    // profiles. Every one of them would have prompted.
    expect(shouldConfirmLeaving(click({ linkTarget: "_blank" }))).toBe(false);
  });

  it("a #hash link — scrolls, doesn't navigate", () => {
    expect(shouldConfirmLeaving(click({ href: "#access" }))).toBe(false);
  });

  it("a click something else already handled", () => {
    expect(shouldConfirmLeaving(click({ defaultPrevented: true }))).toBe(false);
  });
});

describe("dirtiness gates everything", () => {
  it("no combination of flags prompts on a clean form", () => {
    // The single most important property: a form nobody typed in never
    // interrupts anything, whatever is clicked.
    const flags: Partial<NavClick>[] = [
      {},
      { href: "https://example.com" },
      { href: "#x" },
      { linkTarget: "_blank" },
      { metaKey: true },
      { button: 1 },
      { href: null },
      { defaultPrevented: true },
    ];
    for (const f of flags) {
      expect(shouldConfirmLeaving(click({ ...f, dirty: false })), JSON.stringify(f)).toBe(false);
    }
  });
});

describe("the component is only wiring", () => {
  const ROOT = path.resolve(import.meta.dirname, "..", "..");
  const GUARD = readFileSync(
    path.join(ROOT, "components", "growth", "unsaved-guard.tsx"),
    "utf8"
  );
  const PAGE = readFileSync(
    path.join(ROOT, "app", "growth", "(app)", "prospects", "[id]", "page.tsx"),
    "utf8"
  );
  const FORM = readFileSync(
    path.join(ROOT, "components", "admin", "action-form.tsx"),
    "utf8"
  );

  it("it calls the rule rather than re-deciding in the listener", () => {
    expect(GUARD).toContain("shouldConfirmLeaving({");
    // No second copy of the conditions.
    expect(GUARD).not.toMatch(/e\.metaKey \|\| e\.ctrlKey/);
  });

  it("the click listener is CAPTURE phase", () => {
    // preventDefault in the bubble phase is too late — Next's router has
    // already taken the click.
    expect(GUARD).toContain('document.addEventListener("click", onClick, true)');
  });

  it("it clears the flag on submit, not on unmount", () => {
    // React re-renders the form in place after a server action resolves, so
    // there is no unmount to hang the reset on. Leave it out and the form
    // stays "dirty" forever after the first save.
    expect(GUARD).toContain('form.addEventListener("submit", clean)');
  });

  it("it removes every listener it added", () => {
    for (const ev of ["input", "change", "submit"]) {
      expect(GUARD, ev).toContain(`form.removeEventListener("${ev}", `);
    }
    expect(GUARD).toContain('window.removeEventListener("beforeunload", onBeforeUnload)');
    expect(GUARD).toContain('document.removeEventListener("click", onClick, true)');
  });

  it("it also covers a reload or a tab close", () => {
    expect(GUARD).toContain('window.addEventListener("beforeunload", onBeforeUnload)');
  });

  it("it does nothing at all if the form isn't there", () => {
    // A defensive early return, because the id is a string that could drift.
    expect(GUARD).toContain("if (!(form instanceof HTMLFormElement)) return;");
  });
});

describe("it is wired to the form it claims to guard", () => {
  const ROOT = path.resolve(import.meta.dirname, "..", "..");
  const PAGE = readFileSync(
    path.join(ROOT, "app", "growth", "(app)", "prospects", "[id]", "page.tsx"),
    "utf8"
  );
  const FORM = readFileSync(
    path.join(ROOT, "components", "admin", "action-form.tsx"),
    "utf8"
  );

  it("the profile form carries the id the guard looks for", () => {
    expect(PAGE).toContain('<ActionForm action={updateProspect} id="prospect-profile">');
    expect(PAGE).toContain('formId="prospect-profile"');
  });

  it("ActionForm actually puts that id on the <form> element", () => {
    // The guard finds the form by getElementById. An id prop that was accepted
    // and then dropped would leave it watching nothing, silently.
    expect(FORM).toContain("id?: string;");
    expect(FORM).toContain("<form\n      id={id}");
  });

  it("the id prop is optional, so every other ActionForm is unchanged", () => {
    expect(FORM).toContain("id?: string;");
    expect(FORM).not.toContain("id: string;");
  });

  it("the message names the actual consequence", () => {
    // "Are you sure?" tells you nothing. This says what is lost and where.
    expect(PAGE).toContain("You've edited this prospect's details and haven't saved");
  });
});
