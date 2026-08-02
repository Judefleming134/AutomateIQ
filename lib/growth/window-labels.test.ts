import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * A number under a heading that says "Last 30 days" had better be about the
 * last 30 days.
 *
 * The dashboard's KPI block is headed "Last 30 days" and holds seven tiles.
 * Six of them genuinely honour that window. `pipelineValue` does not — it is a
 * snapshot of every open and won deal, summed over ALL prospects with no date
 * filter at all, so it does not change when the window does.
 *
 * Sitting unmarked between six windowed tiles it read as "we built €X of
 * pipeline this month", on the one number that is about money.
 *
 * The Analytics page had already been fixed for exactly this, on exactly this
 * card, and its own comment says why:
 *
 *   "with genuinely windowed tiles either side of them, '7 days' made it read
 *    as though those deals were won and that pipeline built inside the week."
 *
 * The dashboard — read far more often — had never been given the same
 * treatment. These tests hold both surfaces to it.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const METRICS = readFileSync(path.join(ROOT, "lib", "growth", "metrics.ts"), "utf8");
const DASH = readFileSync(path.join(ROOT, "app", "growth", "(app)", "page.tsx"), "utf8");
const ANALYTICS = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "analytics", "page.tsx"),
  "utf8"
);

/** The `return { … }` block of computeGrowthMetrics. */
function returnedMetrics(): string {
  const from = METRICS.indexOf("  return {\n    windowDays: days,");
  expect(from, "metrics return block not found").toBeGreaterThan(-1);
  return METRICS.slice(from, METRICS.indexOf("\n  };", from));
}

describe("pipeline value is genuinely all-time", () => {
  it("is summed over every prospect with no date filter", () => {
    // If this ever GAINS a window, the hint below becomes the wrong label and
    // this test is where that gets noticed.
    const from = METRICS.indexOf("const pipelineValue = allProspects");
    expect(from, "pipelineValue definition moved").toBeGreaterThan(-1);
    const def = METRICS.slice(from, METRICS.indexOf(";", METRICS.indexOf("reduce", from)));
    expect(def).not.toContain("inWindow");
    expect(def).toContain("allProspects");
  });

  it("the other six tiles on that block DO honour the window", () => {
    // The asymmetry is the whole bug — one unmarked odd-one-out among six.
    const ret = returnedMetrics();
    // Directly windowed.
    expect(ret).toContain("leadsAdded: allProspects.filter((p) => inWindow(p.created_at))");
    // Windowed via their upstream sets, which are themselves date-filtered.
    expect(METRICS).toContain("inWindow(m.sent_at ?? m.created_at)");
    expect(METRICS).toContain("const wMeetings = allMeetings.filter((m) => inWindow(m.created_at))");
    expect(METRICS).toContain("const contactedIds = new Set(sent.map((m) => m.prospect_id))");
    expect(METRICS).toContain("const meetingIds = new Set(wMeetings.map((m) => m.prospect_id))");
    expect(ret).toContain('p.status === "sent" && inWindow(p.updated_at)');
  });
});

describe("the dashboard says so", () => {
  it("the KPI block still claims a 30-day window", () => {
    // If this heading ever changes, the hint may no longer be needed — but
    // silently dropping one without the other is how this bug happened.
    expect(DASH).toContain("Last 30 days");
    expect(DASH).toContain("loadGrowthMetrics(admin, 30");
  });

  it("marks the pipeline tile as all-time", () => {
    const from = DASH.indexOf('label="Pipeline value"');
    expect(from, "pipeline tile not found").toBeGreaterThan(-1);
    // To the END of the element, not the first "/>" — the <Euro /> icon prop
    // sits between the label and the hint, and slicing at that closed the
    // window before the thing being asserted on.
    const tile = DASH.slice(from, DASH.indexOf("/>", DASH.indexOf("hint", from)));
    expect(tile).toContain("all time");
  });

  it("does NOT mark the six that really are 30-day numbers", () => {
    // Over-labelling would be its own lie — these tiles are correct as they
    // stand and must not acquire a caveat they don't need.
    for (const label of [
      "Leads added",
      "Outreach sent",
      "Reply rate",
      "Meetings",
      "Conversion",
      "Proposals sent",
    ]) {
      const from = DASH.indexOf(`label="${label}"`);
      expect(from, label).toBeGreaterThan(-1);
      // A generous window past the whole element — deliberately wider than
      // the tile, so a caveat added anywhere near it would still be caught.
      const tile = DASH.slice(from, from + 260);
      expect(tile, label).not.toContain("all time");
    }
  });
});

describe("analytics, which already had this right, still does", () => {
  it("hints the pipeline card whenever a window is active", () => {
    expect(ANALYTICS).toContain(
      'hint={days === null ? undefined : "all time"}'
    );
  });

  it("keeps its all-time suffix on the other unwindowed figures", () => {
    // qualified / won / drafts / queued are snapshots too, and the page
    // already appends `allTime` to their hints.
    expect(ANALYTICS).toContain('const allTime = days === null ? "" : " · all time";');
    expect(ANALYTICS).toContain("${metrics.qualified} qualified${allTime}");
    expect(ANALYTICS).toContain("queued${allTime}");
  });

  it("keeps the two table caveats it already carries", () => {
    expect(
      (ANALYTICS.match(/all-time total/g) ?? []).length,
      "the industries and campaigns tables each carry this note"
    ).toBe(2);
  });
});
