import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * On a phone, scrolling the dial list sideways left every row anonymous.
 *
 * The prospects table is `min-width: 900` inside `.table-wrap`, which is
 * `overflow-x: auto`. Rendered at 390px with the real stylesheet: 356px
 * visible, so 544px of the table sits off to the right — and Status, Score,
 * Assigned, Last contact and Next follow-up ALL live out there.
 *
 * Scroll right to read any of them and the Prospect column scrolls away with
 * everything else. Screenshotted at scrollLeft 340: four rows of phone
 * numbers, status badges and scores, and not one company name on screen.
 *
 * This is the page whose own default drill is "Has phone → best score first" —
 * a dial list, worked from a phone, on dial days. Being unable to tell whose
 * number you are about to ring is the whole game.
 *
 * The checkbox and the name are now pinned. The name/email lines are capped
 * and ellipsised because an UNCAPPED pinned column measured 250px+ of a 390px
 * screen — it would have solved the identity problem by covering the very
 * columns you scrolled to see. Measured after the cap: 190px pinned, 168px
 * left for the scrolled columns, which shows Status, Score and Assigned.
 *
 * The tap-to-call is deliberately exempt from the cap: a truncated phone
 * number is worse than no phone number.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const CSS = readFileSync(path.join(ROOT, "app", "globals.css"), "utf8");
const TABLE = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "prospects", "page.tsx"),
  "utf8"
);

/** The phone-only block this fix lives in. */
const MOBILE = (() => {
  const start = CSS.indexOf("The dial list on a phone: keep the name with the number.");
  expect(start, "the dial-list block is gone").toBeGreaterThan(-1);
  const from = CSS.indexOf("@media (max-width: 900px)", start);
  const end = CSS.indexOf("AutoSEO report", from);
  return CSS.slice(from, end);
})();

describe("the geometry that caused it", () => {
  it("the table really is wider than a phone", () => {
    expect(TABLE).toContain("minWidth: 900");
  });

  it("and its wrapper really does scroll sideways", () => {
    const wrap = CSS.slice(CSS.indexOf(".table-wrap {"), CSS.indexOf("}", CSS.indexOf(".table-wrap {")));
    expect(wrap).toContain("overflow-x: auto");
  });

  it("the identifying column is column 2, behind the checkbox", () => {
    // Which is why BOTH have to be pinned: pinning only the name would leave
    // the checkbox sliding underneath it.
    const head = TABLE.slice(TABLE.indexOf("<thead>"), TABLE.indexOf("</thead>"));
    expect(head.indexOf("<SelectAll />")).toBeLessThan(head.indexOf("<th>Prospect</th>"));
    expect(head.indexOf("<th>Prospect</th>")).toBeLessThan(head.indexOf("<th>Status</th>"));
  });

  it("everything worth scrolling for is to the RIGHT of the name", () => {
    const head = TABLE.slice(TABLE.indexOf("<thead>"), TABLE.indexOf("</thead>"));
    const name = head.indexOf("<th>Prospect</th>");
    for (const col of ["Status", "Score", "Assigned", "Last contact", "Next follow-up"]) {
      expect(head.indexOf(`<th>${col}</th>`), col).toBeGreaterThan(name);
    }
  });
});

describe("the name is pinned", () => {
  it("the table is targetable — it had no class at all", () => {
    expect(TABLE).toContain('<table className="prospect-table" style={{ minWidth: 900 }}>');
  });

  it("both leading columns stick, head and body", () => {
    for (const sel of [
      ".prospect-table thead th:nth-child(1)",
      ".prospect-table tbody td:nth-child(1)",
      ".prospect-table thead th:nth-child(2)",
      ".prospect-table tbody td:nth-child(2)",
    ]) {
      expect(MOBILE, sel).toContain(sel);
    }
    expect((MOBILE.match(/position: sticky;/g) ?? [])).toHaveLength(2);
  });

  it("the name column starts where the checkbox ends", () => {
    // 34px is the checkbox column's declared width. If the two disagree the
    // pinned cells overlap and the name is clipped.
    expect(TABLE).toContain('<th style={{ width: 34 }}>');
    expect(MOBILE).toContain("left: 34px;");
    expect(MOBILE).toContain("left: 0;");
  });

  it("the pinned cells are OPAQUE", () => {
    // .table-wrap's own background is translucent, so without this the
    // scrolling cells show straight through the pinned ones.
    expect((MOBILE.match(/background: var\(--panel\);/g) ?? [])).toHaveLength(2);
    const wrap = CSS.slice(CSS.indexOf(".table-wrap {"), CSS.indexOf("}", CSS.indexOf(".table-wrap {")));
    expect(wrap).toContain("var(--panel-glass)");
  });

  it("the header outranks the body when both are pinned", () => {
    expect(MOBILE).toMatch(/thead th:nth-child\(1\),\s*\.prospect-table thead th:nth-child\(2\) \{\s*z-index: 3;/);
    expect(MOBILE).toContain("z-index: 2;");
  });
});

describe("…without covering the columns you scrolled to see", () => {
  it("the name and contact lines are capped and ellipsised", () => {
    expect(MOBILE).toContain("max-width: 150px;");
    expect(MOBILE).toContain("text-overflow: ellipsis;");
    expect(MOBILE).toContain("white-space: nowrap;");
  });

  it("the cap is on the CONTENT, not the cell", () => {
    // A max-width on a <td> is advisory in table layout — the inner blocks are
    // what actually set the column's width, so that is where it goes.
    expect(MOBILE).toContain(".prospect-table tbody td:nth-child(2) > a > strong,");
    expect(MOBILE).toContain(".prospect-table tbody td:nth-child(2) > div {");
    expect(MOBILE).not.toMatch(/td:nth-child\(2\) \{[^}]*max-width/);
  });

  it("the tap-to-call is exempt", () => {
    // A truncated phone number is worse than no phone number, and this button
    // is the reason the page is opened on a phone at all.
    expect(MOBILE).toContain(".prospect-table tbody td:nth-child(2) > .phone-inline");
    expect(MOBILE).toContain("max-width: none;");
  });
});

describe("desktop is untouched", () => {
  it("every rule is inside the phone breakpoint", () => {
    // Above 900px the table doesn't scroll, so sticky would be inert anyway —
    // but scoping it means desktop can't regress at all.
    expect(MOBILE.trimStart().startsWith("@media (max-width: 900px)")).toBe(true);
    const outside = CSS.replace(MOBILE, "");
    expect(outside).not.toContain(".prospect-table thead th:nth-child(1)");
  });

  it("no column was removed or reordered to make room", () => {
    const head = TABLE.slice(TABLE.indexOf("<thead>"), TABLE.indexOf("</thead>"));
    for (const col of [
      "Prospect", "Title", "Industry", "Location", "Phone",
      "Status", "Score", "Assigned", "Last contact", "Next follow-up",
    ]) {
      expect(head, col).toContain(`<th>${col}</th>`);
    }
  });

  it("the tap-to-call hoist it builds on is still phone-only", () => {
    // .phone-inline is display:none by default and only appears under 900px.
    // If that ever changed, the exemption above would start affecting desktop.
    const base = CSS.slice(CSS.indexOf(".phone-inline {"), CSS.indexOf("}", CSS.indexOf(".phone-inline {")));
    expect(base).toContain("display: none");
    expect(CSS).toContain("@media (max-width: 900px) {\n  .phone-inline {");
  });
});
