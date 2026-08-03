import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SOCIAL_LINK_FILTER, applySocialOnly } from "./prospect-query";
import { activeFilterChips, filterHref } from "./prospect-filters";

/**
 * Every "see them" link on the DM list went to the whole database.
 *
 * All four of its empty states quote a COUNT — "N prospects with a profile
 * link are still waiting on a DM draft" — and all four linked to
 * `/growth/prospects?sort=score`, which is NO FILTER AT ALL.
 *
 * This is the same defect fixed in the Jarvis panel two passes ago, recurring
 * on a different surface, which is exactly what CLAUDE.md says these classes
 * do. And prospect-query.ts states the rule it breaks: "the number shown must
 * equal the rows the click lands on, or the page looks broken".
 *
 * There was no filter that could match, because nothing expressed "reachable
 * by DM". `phone=1` had existed for the call list all along; this is its
 * mirror, defined once and applied by the page AND the CSV export — because
 * the export button sits on the filtered list and claims to export what you
 * are looking at.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");

const DMS = read("app", "growth", "(app)", "dms", "page.tsx");
const PROSPECTS = read("app", "growth", "(app)", "prospects", "page.tsx");
const EXPORT = read("app", "growth", "(app)", "reports", "export", "route.ts");

describe("the DM list's links now land on the people it counted", () => {
  it("no link on the page is a bare sort any more", () => {
    const code = DMS.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(code).not.toContain('href="/growth/prospects?sort=score"');
  });

  it("all four empty-state links carry the filter", () => {
    const links = [...DMS.matchAll(/\/growth\/prospects\?([^"]+)"/g)].map((m) => m[1]);
    expect(links).toHaveLength(4);
    for (const l of links) expect(l).toContain("social=1");
  });
});

describe("the filter itself", () => {
  it("matches a prospect on ANY of the three platforms", () => {
    expect(SOCIAL_LINK_FILTER).toContain("instagram_url.not.is.null");
    expect(SOCIAL_LINK_FILTER).toContain("facebook_url.not.is.null");
    expect(SOCIAL_LINK_FILTER).toContain("linkedin_url.not.is.null");
  });

  it("is the SAME predicate the DM list itself uses to build its pool", () => {
    // Otherwise "prospects with a profile link" means two different things on
    // the two pages, and the count still wouldn't match the list.
    expect(DMS).toContain(
      '"instagram_url.not.is.null,facebook_url.not.is.null,linkedin_url.not.is.null"'
    );
    expect(SOCIAL_LINK_FILTER).toBe(
      "instagram_url.not.is.null,facebook_url.not.is.null,linkedin_url.not.is.null"
    );
  });

  it("applies as one OR, and is a no-op when off", () => {
    const calls: string[] = [];
    const q = { or: (f: string) => (calls.push(f), q) };
    applySocialOnly(q, true);
    expect(calls).toEqual([SOCIAL_LINK_FILTER]);
    calls.length = 0;
    applySocialOnly(q, false);
    expect(calls).toEqual([]);
  });
});

describe("wired everywhere `phone` is, and nowhere else", () => {
  const pairs: [string, string, string][] = [
    ["reads the param", PROSPECTS, 'params.social === "1"'],
    ["narrows the query", PROSPECTS, "applySocialOnly(query, socialOnly)"],
    ["survives pagination", PROSPECTS, 'sp.set("social", "1")'],
    ["survives the export href", PROSPECTS, 'exportSp.set("social", "1")'],
    ["survives a search", PROSPECTS, 'name="social" value="1"'],
    ["is reachable as a checkbox", PROSPECTS, 'id="pf-social"'],
    ["the CSV export reads it", EXPORT, 'url.searchParams.get("social") === "1"'],
    ["the CSV export applies it", EXPORT, "applySocialOnly(query, socialOnly)"],
  ];
  for (const [what, src, needle] of pairs) {
    it(what, () => expect(src).toContain(needle));
  }

  it("counts as a filter for the 'matching your filters' line", () => {
    // Otherwise the header claims an unfiltered list while showing a filtered one.
    expect(PROSPECTS).toContain("phoneOnly || socialOnly");
  });

  it("counts as a filter for the export's own filtered/not-filtered flag", () => {
    expect(EXPORT).toContain("phoneOnly || socialOnly");
  });
});

describe("it behaves like every other chip", () => {
  it("renders a readable chip, not a raw param", () => {
    const chips = activeFilterChips({ social: "1" });
    expect(chips).toHaveLength(1);
    expect(chips[0].label).toBe("has a profile link");
    expect(chips[0].key).toBe("social");
  });

  it("clears only itself", () => {
    const href = filterHref({ social: "1", phone: "1", sort: "score" }, "social");
    expect(href).not.toContain("social=");
    expect(href).toContain("phone=1");
    expect(href).toContain("sort=score");
  });

  it("survives another chip being cleared", () => {
    // The bug fixed for `stage` in an earlier pass — a new param must be put
    // back into the URL or every other chip's clear drops it.
    const href = filterHref({ social: "1", phone: "1" }, "phone");
    expect(href).toContain("social=1");
    expect(href).not.toContain("phone=");
  });

  it("only ever accepts the literal 1", () => {
    expect(filterHref({ social: "yes" })).not.toContain("social");
    expect(activeFilterChips({ social: "true" })).toHaveLength(0);
  });
});

describe("nothing about the phone filter moved", () => {
  it("still filters, still has its checkbox, still exports", () => {
    expect(PROSPECTS).toContain('query.not("phone", "is", null)');
    expect(PROSPECTS).toContain('id="pf-phone"');
    expect(EXPORT).toContain('query.not("phone", "is", null)');
  });

  it("the call list's own link is untouched", () => {
    const CALL = read("app", "growth", "(app)", "call-list", "page.tsx");
    expect(CALL).toContain("/growth/prospects?phone=1");
  });
});
