import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * On a phone, the prospect workspace's Conversation tab put the call sheet
 * below the entire conversation history.
 *
 * `.grid-main-side` is two columns on desktop and stacks in DOM order below
 * 1024px. On the Conversation tab the two columns are:
 *
 *   main  the full history — up to 100 messages and 100 activities, each
 *         message body rendered in full in a pre-wrap paragraph
 *   side  the tap-to-call button, the per-business call sheet (opener, their
 *         pain points, the pitch, the price answer, the discovery questions,
 *         the voicemail), "Log their reply", and the task list
 *
 * Everything in the SIDE column is used during a call. Everything in the MAIN
 * column is the record you read afterwards. Stacked in DOM order, the phone
 * showed the record first.
 *
 * What makes it sharp rather than cosmetic: the call list's "Open workspace →"
 * deep-links to `?tab=conversation` on purpose, with this on it —
 *
 *   "Straight to the Conversation tab: that's where the full per-business call
 *    sheet and the thread live. Landing on Research mid-dial meant a tap to get
 *    to the script."
 *
 * — so the shortcut built to put the script one tap from the dial landed, on a
 * phone, at the top of the longest scroll on the page. And a lead worth a call
 * is a lead with history, so the worse the scroll, the more likely the call.
 *
 * The inbox had exactly this defect and exactly this fix already
 * (`.inbox-side`, "you scrolled past a full conversation to find out there were
 * others waiting"). This is the same rule applied to the second place it bites.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const CSS = readFileSync(path.join(ROOT, "app", "globals.css"), "utf8");
const PAGE = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "prospects", "[id]", "page.tsx"),
  "utf8"
);
const CALL_LIST = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "call-list", "page.tsx"),
  "utf8"
);

/** The Conversation tab's JSX, from its guard to the next tab's. */
const CONVERSATION = PAGE.slice(
  PAGE.indexOf('{tab === "conversation" && ('),
  PAGE.indexOf('{tab === "proposal" && (')
);

/** The one narrow-screen block that does the hoisting. */
const HOIST = CSS.slice(
  CSS.indexOf("@media (max-width: 1023px)"),
  CSS.indexOf("}", CSS.indexOf("order: -1;", CSS.indexOf("@media (max-width: 1023px)"))) + 3
);

describe("the side column is hoisted on narrow screens", () => {
  it("the Conversation tab's side column is marked", () => {
    expect(CONVERSATION).toContain('<div className="workspace-side">');
  });

  it("it is a DIRECT child of the grid, which is what the selector requires", () => {
    // `.grid-main-side > .workspace-side` — a nested div would not match.
    const grid = CONVERSATION.indexOf('className="grid-main-side"');
    const side = CONVERSATION.indexOf('className="workspace-side"');
    expect(grid).toBeGreaterThan(-1);
    expect(side).toBeGreaterThan(grid);
    // Exactly one element sits between them: the main <section>.
    const between = CONVERSATION.slice(grid, side);
    expect((between.match(/className="grid-main-side"/g) ?? []).length).toBe(1);
  });

  it("the rule exists and applies to both columns that need it", () => {
    expect(HOIST).toContain(".grid-main-side > .inbox-side");
    expect(HOIST).toContain(".grid-main-side > .workspace-side");
    expect(HOIST).toContain("order: -1;");
  });

  it("it is scoped to narrow screens only — desktop is untouched", () => {
    expect(HOIST.startsWith("@media (max-width: 1023px)")).toBe(true);
    // The two-column layout is declared in its own min-width block, which must
    // not mention the hoist at all.
    const twoCol = CSS.slice(
      CSS.indexOf("@media (min-width: 1024px)"),
      CSS.indexOf("@media (max-width: 1023px)")
    );
    expect(twoCol).toContain(".grid-main-side {");
    expect(twoCol).not.toContain("order:");
  });

  it("the inbox's existing hoist still works — this only added a selector", () => {
    expect(CSS).toContain(".inbox-side");
    const inbox = readFileSync(
      path.join(ROOT, "app", "growth", "(app)", "inbox", "page.tsx"),
      "utf8"
    );
    expect(inbox).toContain('<div className="inbox-side">');
  });
});

describe("what the side column actually holds — i.e. why it goes first", () => {
  const side = CONVERSATION.slice(CONVERSATION.indexOf('className="workspace-side"'));

  it.each([
    ["the tap-to-call link", "href={`tel:"],
    ["the per-business call sheet", "OPENER:"],
    ["the price answer", 'IF THEY SAY:'],
    ["the voicemail script", "VOICEMAIL (20 seconds):"],
    ["log their reply", "Log their reply"],
    ["tasks and follow-ups", "Tasks &amp; follow-ups"],
  ])("holds %s", (_label, needle) => {
    expect(side).toContain(needle);
  });

  it("the main column is the history it used to sit under", () => {
    const main = CONVERSATION.slice(0, CONVERSATION.indexOf('className="workspace-side"'));
    expect(main).toContain("Conversation &amp; activity");
    // Every message body, in full — this is the wall that was in front.
    expect(main).toContain("{entry.m.body}");
  });

  it("the history really is unbounded enough to matter", () => {
    // 100 messages + 100 activities, each message printing its whole body.
    expect(PAGE).toContain(".limit(100)");
  });
});

describe("the deep link this fixes", () => {
  it("the call list sends you to the Conversation tab mid-dial", () => {
    expect(CALL_LIST).toContain("?tab=conversation");
    expect(CALL_LIST).toContain("Open workspace");
  });

  it("a touched lead OPENS on this tab, so it isn't only the deep link", () => {
    // DEFAULT_TAB_BY_STATUS: contacted / follow_up_sent / replied / negotiation.
    expect(PAGE).toContain('contacted: "conversation"');
    expect(PAGE).toContain('follow_up_sent: "conversation"');
  });
});

describe("nothing else about the tab changed", () => {
  it("the grid itself is untouched", () => {
    expect(CONVERSATION).toContain('<div className="grid-main-side">');
  });

  it("the timeline still merges messages and activities by messageInstant", () => {
    expect(CONVERSATION).toContain("messageInstant(m)");
    expect(CONVERSATION).toContain('kind: "activity" as const');
  });

  it("the call panel still hides itself when there is nothing to show", () => {
    expect(CONVERSATION).toContain("if (!prospect.phone && !script) return null;");
  });

  it("a saved Studio call draft still takes precedence over the generated sheet", () => {
    expect(CONVERSATION).toContain("const script = callDraft?.body ||");
  });
});
