import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  activeFilterChips,
  filterHref,
  hasActiveFilters,
  DUE_CHIP_LABELS,
} from "@/lib/growth/prospect-filters";

/**
 * Clearing a filter on the prospect database.
 *
 * The page renders "N prospects matching your filters" whenever anything is
 * narrowing the list — so it TELLS you the list is filtered. The only way back
 * was a "clear filter" link that rendered for exactly one filter (`due`).
 * Tick "Has phone", or pick a status, industry or campaign from the panel, and
 * the list narrowed with nothing on screen to widen it again.
 *
 * The one other clear affordance lived inside the EMPTY state, so it appeared
 * only when nothing matched — the clear link existed precisely when there was
 * nothing to clear from, and vanished the moment it became useful.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");

describe("a chip appears for every filter that narrows the list", () => {
  it.each([
    ["q", { q: "walsh" }],
    ["status", { status: "contacted" }],
    ["industry", { industry: "Plumbing" }],
    ["campaign", { campaign: "abc-123" }],
    ["phone", { phone: "1" }],
    ["due", { due: "cold" }],
  ])("%s", (key, params) => {
    const chips = activeFilterChips(params);
    expect(chips).toHaveLength(1);
    expect(chips[0].key).toBe(key);
  });

  it("shows one chip per filter when several are on", () => {
    const chips = activeFilterChips({
      q: "walsh",
      status: "contacted",
      phone: "1",
      due: "cold",
    });
    expect(chips.map((c) => c.key)).toEqual(["q", "status", "phone", "due"]);
  });

  it("shows nothing when the list is unfiltered", () => {
    expect(activeFilterChips({})).toEqual([]);
    expect(hasActiveFilters({})).toBe(false);
  });

  it("does NOT treat sort as a filter", () => {
    // Sort reorders; it hides nothing. Offering to "clear" it would imply
    // rows were being withheld.
    expect(activeFilterChips({ sort: "score" })).toEqual([]);
    expect(hasActiveFilters({ sort: "score" })).toBe(false);
  });

  it("ignores blank and whitespace-only values", () => {
    expect(activeFilterChips({ q: "   ", status: "", industry: "  " })).toEqual([]);
  });

  it("treats phone as on only for the literal '1'", () => {
    expect(activeFilterChips({ phone: "1" })).toHaveLength(1);
    expect(activeFilterChips({ phone: "0" })).toEqual([]);
    expect(activeFilterChips({ phone: "true" })).toEqual([]);
  });
});

describe("each chip clears only itself", () => {
  const params = { q: "walsh", status: "contacted", phone: "1", due: "cold" };

  it("drops its own filter", () => {
    for (const chip of activeFilterChips(params)) {
      expect(chip.clearHref, chip.key).not.toContain(`${chip.key}=`);
    }
  });

  it("keeps every other filter", () => {
    const chips = activeFilterChips(params);
    const phoneChip = chips.find((c) => c.key === "phone")!;
    expect(phoneChip.clearHref).toContain("q=walsh");
    expect(phoneChip.clearHref).toContain("status=contacted");
    expect(phoneChip.clearHref).toContain("due=cold");
    expect(phoneChip.clearHref).not.toContain("phone=");
  });

  it("returns the bare list when the last filter is dropped", () => {
    expect(activeFilterChips({ due: "cold" })[0].clearHref).toBe("/growth/prospects");
  });

  it("never carries the page number", () => {
    // Dropping a filter widens the result set; staying on page 7 of a list
    // that just changed shape lands on a page that no longer means anything.
    const href = filterHref({ q: "walsh", status: "contacted" }, "status");
    expect(href).not.toContain("page=");
  });

  it("keeps the sort, because widening shouldn't reshuffle the list", () => {
    expect(filterHref({ phone: "1", sort: "score" }, "phone")).toContain("sort=score");
  });

  it("round-trips an awkward search term intact", () => {
    // Assert the PROPERTY (it decodes back to what was typed), not a
    // particular escaping style — URLSearchParams escapes ' as %27 where
    // encodeURIComponent leaves it alone, and hand-rolling the expected
    // string just tests my guess at the encoder.
    const term = "o'brien & sons?x=1";
    const href = filterHref({ q: term, status: "contacted" }, "status");
    const parsed = new URLSearchParams(href.split("?")[1]);
    expect(parsed.get("q")).toBe(term);
    expect(parsed.get("status")).toBeNull();
  });
});

describe("the chips read as English, not as query params", () => {
  it("names the campaign rather than showing its id", () => {
    const chips = activeFilterChips({ campaign: "abc-123" }, (id) =>
      id === "abc-123" ? "Dublin plumbers Q3" : undefined
    );
    expect(chips[0].label).toBe("Dublin plumbers Q3");
    expect(chips[0].label).not.toContain("abc-123");
  });

  it("falls back to a word when the campaign can't be resolved", () => {
    // A deleted campaign must not put a raw uuid on screen.
    const chips = activeFilterChips({ campaign: "abc-123" });
    expect(chips[0].label).toBe("campaign");
  });

  it("un-snake-cases a status", () => {
    expect(activeFilterChips({ status: "follow_up_sent" })[0].label).toBe("follow up sent");
  });

  it("gives every due bucket a plain-English label", () => {
    for (const bucket of ["today", "overdue", "live", "cold", "unscheduled"]) {
      const label = activeFilterChips({ due: bucket })[0].label;
      expect(label, bucket).toBe(DUE_CHIP_LABELS[bucket]);
      expect(label, bucket).not.toBe(bucket);
    }
  });

  it("quotes the search term so it reads as a search", () => {
    expect(activeFilterChips({ q: "walsh" })[0].label).toContain("walsh");
  });
});

describe("the page is wired to it", () => {
  const PAGE = readFileSync(
    path.join(ROOT, "app", "growth", "(app)", "prospects", "page.tsx"),
    "utf8"
  );
  const CODE = PAGE.replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("renders a chip for every active filter, not just `due`", () => {
    expect(CODE).toContain("activeFilterChips(");
    expect(CODE).toContain("filterChips.map((chip)");
    // The old gate rendered the clear link for exactly one filter.
    expect(CODE).not.toMatch(/\{due && \(\s*<p style=\{\{ fontSize: 12\.5/);
  });

  it("offers a clear-all only when there is more than one to clear", () => {
    expect(CODE).toMatch(/filterChips\.length > 1/);
  });

  it("resolves campaign ids to names", () => {
    expect(CODE).toContain("campaignNameById");
  });

  it("fixes the export tooltip that omitted `due`", () => {
    // The export DOES carry `due`, so "Exports every prospect" on a cold-list
    // view was the tooltip contradicting the button.
    expect(CODE).toContain('filterChips.length > 0\n              ? "Exports the filtered list');
    expect(CODE).not.toMatch(
      /q \|\| status \|\| industry \|\| campaign \|\| phoneOnly\s*\n\s*\? "Exports the filtered/
    );
  });

  it("keeps the empty-state clear link — nothing was removed", () => {
    expect(CODE).toContain("Clear them");
  });

  it("keeps the header's 'matching your filters' line", () => {
    expect(CODE).toContain("matching your filters");
  });
});
