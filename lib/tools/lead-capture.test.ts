import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { ALL_TOOL_SLUGS, TOOL_LABELS, toolLabel } from "@/lib/tools/slugs";

/**
 * A free tool that produces a report and doesn't ask for the email is a
 * favour, not a front door.
 *
 * Five of the six captured. `google-profile` did not — it has a full result
 * renderer (score ring, verdict, every finding, a link to the profile) and no
 * form. It was missed because it is gated behind GOOGLE_PLACES_API_KEY and
 * currently renders its "not switched on yet" state, so nobody working
 * through the tools ever saw its result screen.
 *
 * That gate is exactly what made it dangerous: J1 in docs/OUTSTANDING.md says
 * "adding the key switches it back on within one request, no deploy". So the
 * day the card goes on file, the tool would have gone live as the one that
 * shows a stranger their Google score and lets them walk away — with nothing
 * to notice it, because switching it on takes no ship.
 *
 * This test is the thing that notices.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const TOOLS_DIR = path.join(ROOT, "app", "freetools");

/** Every file under a tool's directory, concatenated. */
function toolSource(slug: string): string {
  const dir = path.join(TOOLS_DIR, slug);
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const full = path.join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(full)) out.push(readFileSync(full, "utf8"));
    }
  };
  walk(dir);
  return out.join("\n");
}

/** The tool directories that actually exist on disk. */
const TOOL_DIRS = readdirSync(TOOLS_DIR).filter((e) =>
  statSync(path.join(TOOLS_DIR, e)).isDirectory()
);

describe("every free tool asks for the email", () => {
  it("has a directory for every catalogued slug, and vice versa", () => {
    // A slug with no directory is a dead card on the hub; a directory with no
    // slug cannot capture a lead at all, because the API allow-lists slugs.
    expect([...TOOL_DIRS].sort()).toEqual([...ALL_TOOL_SLUGS].sort());
  });

  it("renders ToolLeadForm — ALL of them, with no exceptions", () => {
    // "<ToolLeadForm", not the bare name — a leftover import satisfies the
    // bare name and this guard would pass on a tool that renders nothing.
    // Caught by break-verifying: deleting the element left the import behind
    // and this test still went green.
    const missing = ALL_TOOL_SLUGS.filter(
      (slug) => !toolSource(slug).includes("<ToolLeadForm")
    );
    expect(
      missing,
      `these tools produce a result and never ask for the email: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("passes its own slug, so the lead is attributed to the right tool", () => {
    // The API allow-lists the slug precisely so a source cannot be invented;
    // passing the wrong one here would file the lead under another tool.
    for (const slug of ALL_TOOL_SLUGS) {
      expect(toolSource(slug), slug).toContain(`tool="${slug}"`);
    }
  });
});

describe("the form goes UNDER the result, never in front of it", () => {
  // NOT asserted per tool, deliberately. The six components name their state
  // differently (`audit`, `result`, …) and three are always-on calculators
  // with no nullable result at all, so any source-text regex broad enough to
  // pass all six would pass anything — decoration, not a guard. The invariant
  // is enforced in ONE place instead, and that is what the next test pins.

  it("the component still refuses to gate the report", () => {
    const FORM = readFileSync(
      path.join(ROOT, "components", "tools", "tool-lead-form.tsx"),
      "utf8"
    );
    expect(FORM).toContain("It appears under a finished result, never in front of one");
    // Failure stays quiet: they already have what they came for.
    expect(FORM).toContain("Swallowed on purpose");
  });
});

describe("the Google profile checker, specifically", () => {
  const SRC = toolSource("google-profile");

  it("sends something Jude can open a conversation with", () => {
    // A bare email is a lead. An email plus "47/100, and their opening hours
    // are missing" is a phone call.
    expect(SRC).toContain('subject={result.address');
    expect(SRC).toContain("headline={`${result.score}/100");
    expect(SRC).toContain("topFinding=");
  });

  it("says the right thing whether or not anything is wrong", () => {
    // A perfect profile still deserves a reason to leave an address.
    expect(SRC).toContain("problems.length > 0");
    expect(SRC).toContain("Every check passed");
  });

  it("keeps its 'not switched on yet' state — the tool is still gated", () => {
    expect(SRC).toContain("configured");
  });
});

describe("the slug list stays honest", () => {
  it("every slug has a human label", () => {
    for (const slug of ALL_TOOL_SLUGS) {
      expect(TOOL_LABELS[slug], slug).toBeTruthy();
      expect(toolLabel(slug), slug).not.toBe("free tool");
    }
  });

  it("an unknown slug falls back rather than throwing", () => {
    expect(toolLabel("nonsense")).toBe("free tool");
  });
});
