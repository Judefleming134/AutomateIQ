import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * "Archive selected" moved up to a hundred prospects with no number and no
 * prompt — and quietly threw their follow-up dates away.
 *
 * The prospects table pages at 100 (PAGE_SIZE in its page.tsx) and the header
 * checkbox ticks every row on the page in one click. The bulk bar then offered
 * two buttons reading "Archive selected" and "Delete selected". Delete asked
 * first and named the count; ARCHIVE ASKED NOTHING — the only bulk mutation in
 * the engine that didn't, while the inbox's own delete note observes that
 * "every other destructive action in the engine already asks first".
 *
 * And archive is not a status flip you can undo by flipping it back:
 *
 *     .update({ status: "archived", next_follow_up_at: null })
 *
 * The chase date goes with it. Setting a status back later restarts that
 * prospect's follow-up from scratch — so a mis-click on a full page destroyed
 * a hundred follow-up dates, silently, on the list Jude works his chases from.
 * "Destructive with no undo", named in CLAUDE.md.
 *
 * Verified in headless Chromium against a 100-row harness carrying the same
 * markup shape (checkboxes OUTSIDE the form, associated by `form=`), all 8
 * behaviours correct: the count reaches 100 on select-all, archive prompts and
 * cancelling blocks the submit, unticking returns to 0 and disables both
 * buttons, and delete's own prompt is untouched.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const BULK = readFileSync(
  path.join(ROOT, "components", "growth", "bulk-actions.tsx"),
  "utf8"
);
const ACTIONS = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "prospects", "actions.ts"),
  "utf8"
);
const TABLE = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "prospects", "page.tsx"),
  "utf8"
);

describe("the scale one click reaches", () => {
  it("a page is 100 rows, and the header checkbox ticks all of them", () => {
    expect(TABLE).toContain("const PAGE_SIZE = 100;");
    expect(BULK).toContain('querySelectorAll<HTMLInputElement>(\'input[name="ids"][form="prospect-bulk"]\')');
  });

  it("and the action really does accept that many", () => {
    expect(ACTIONS).toContain('formData.getAll("ids").map(String).filter(Boolean).slice(0, 500)');
  });
});

describe("archive asks first now, and says the part that isn't obvious", () => {
  it("there is a confirm on the archive intent at all", () => {
    expect(BULK).toContain('intent === "archive" &&');
    expect(BULK).toMatch(/intent === "archive" &&\s*!window\.confirm\(/);
  });

  it("it names the number, not just 'the selected ones'", () => {
    expect(BULK).toContain("`Archive ${selected} prospect${selected === 1 ? \"\" : \"s\"}?");
  });

  it("it warns that the follow-up date is cleared", () => {
    // THE non-obvious half. Without this the loss is discovered a week later,
    // when nobody got chased.
    expect(BULK).toContain("their follow-up date is cleared");
    expect(BULK).toContain("restarts its chase from scratch");
  });

  it("…and that warning is TRUE — the action really nulls it", () => {
    // A prompt that describes a consequence the code doesn't have is its own
    // bug. Pinned to the update itself.
    expect(ACTIONS).toContain('.update({ status: "archived", next_follow_up_at: null })');
  });

  it("it mentions the live-deal skip, which is also real", () => {
    expect(BULK).toContain("Live deals (replied, qualified, booked, in proposal, won) are skipped");
    expect(ACTIONS).toContain('.not("status", "in", liveDealFilter)');
    for (const s of ["replied", "qualified", "meeting_booked", "proposal_sent", "won"]) {
      expect(ACTIONS, s).toContain(`"${s}"`);
    }
  });

  it("cancelling archive stops the submit, and doesn't fall through to delete", () => {
    // The delete branch gained an early `return` so a cancelled DELETE can no
    // longer run on into the archive confirm and ask a second question.
    const guard = BULK.slice(BULK.indexOf("onSubmit={(e) => {"), BULK.indexOf("<span style={{ fontSize: 12"));
    expect(guard).toContain("e.preventDefault();\n          return;\n        }");
    expect((guard.match(/e\.preventDefault\(\);/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("delete's own confirm is untouched", () => {
    expect(BULK).toContain("Permanently delete ${selected} prospect");
    expect(BULK).toContain("This also removes their research, messages and full history");
  });
});

describe("the buttons say how many they will act on", () => {
  it("both carry the live count", () => {
    expect(BULK).toContain('{ticked > 0 ? `Archive ${noun(ticked)}` : "Archive selected"}');
    expect(BULK).toContain('{ticked > 0 ? `Delete ${noun(ticked)}` : "Delete selected"}');
  });

  it("and are disabled with nothing ticked", () => {
    expect((BULK.match(/disabled=\{pending \|\| ticked === 0\}/g) ?? []).length).toBe(2);
    // The zero-selection alert stays as the backstop — a checkbox associated
    // by `form=` can be re-rendered by the server between count and submit.
    expect(BULK).toContain("Tick at least one prospect first.");
  });

  it("the count is recounted from the real form, never from arithmetic", () => {
    // The same lesson the autopilot panel learned: a remembered number drifts
    // the moment the browser restores checked state on a back-navigation.
    expect(BULK).toContain('new FormData(form).getAll("ids").length');
    expect(BULK).not.toMatch(/setTicked\((?:ticked|t)\s*[+-]/);
  });

  it("it listens on DOCUMENT, because the rows are outside the form", () => {
    // A checkbox associated by the `form` attribute lives in the table, so its
    // change event bubbles up the table and never reaches the <form> element.
    // Listening on the form would have counted zero, forever.
    expect(BULK).toContain('document.addEventListener("change", onChange)');
    expect(BULK).not.toContain('form.addEventListener("change"');
  });

  it("select-all is marked so the recount sees it", () => {
    // Ticking every row programmatically fires no change event on the rows,
    // so without this the count sits at 0 after the one click that selects a
    // hundred — the exact case that most needed a number.
    expect(BULK).toContain('data-select-all="true"');
    expect(BULK).toContain('t?.matches?.("input[data-select-all]")');
  });

  it("it recounts once on mount too", () => {
    expect(BULK).toContain("// Once on mount: a back-navigation can restore ticks before this runs.");
  });

  it("and removes its listener", () => {
    expect(BULK).toContain('document.removeEventListener("change", onChange)');
  });
});

describe("nothing was taken away", () => {
  it("both buttons still exist, with their original labels at zero", () => {
    expect(BULK).toContain('value="archive"');
    expect(BULK).toContain('value="delete"');
    expect(BULK).toContain('"Archive selected"');
    expect(BULK).toContain('"Delete selected"');
  });

  it("delete is still owner-only", () => {
    expect(BULK).toContain("{isOwner && (");
    expect(ACTIONS).toContain('if (member.role !== "owner") return { error: "Only owners can delete prospects." };');
  });

  it("the 'this page only' note is still there", () => {
    expect(BULK).toContain("Applies to the ticked rows on this page");
  });
});
