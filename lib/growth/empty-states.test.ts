import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * An empty state that names a place you can't do the thing.
 *
 * The campaign detail page said, on a campaign with no prospects:
 *
 *     "None yet — assign prospects to this campaign from the Prospects screen."
 *
 * You cannot. That screen has a campaign FILTER and a campaign field on the
 * NEW-prospect form; there is no way to move an EXISTING prospect into a
 * campaign from it, and the bulk actions are Archive and Delete only. So the
 * single instruction on an empty campaign pointed at a screen where the thing
 * it named isn't — and an empty campaign is exactly when someone follows it.
 *
 * The two routes that DO exist are the CSV import (which has a Campaign
 * select, and is the fastest way to fill a niche campaign) and a prospect's
 * own Details tab. Both are asserted below to actually be there, because
 * shipping copy that names a capability which doesn't exist is precisely the
 * bug being fixed.
 *
 * Three other empty states named a destination in words without linking to it.
 * They now link. No logic anywhere changed — this is copy and hrefs.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");

const CAMPAIGN = read("app", "growth", "(app)", "campaigns", "[id]", "page.tsx");
const PROSPECTS = read("app", "growth", "(app)", "prospects", "page.tsx");
const WORKSPACE = read("app", "growth", "(app)", "prospects", "[id]", "page.tsx");
const INBOX = read("app", "growth", "(app)", "inbox", "page.tsx");
const ANALYTICS = read("app", "growth", "(app)", "analytics", "page.tsx");
const BULK = read("components", "growth", "bulk-actions.tsx");

describe("the campaign empty state no longer points at a screen that can't do it", () => {
  it("dropped the claim about the Prospects screen", () => {
    const code = CAMPAIGN.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(code).not.toContain("assign prospects to this campaign from the Prospects screen");
  });

  it("names the CSV import — which really does have a Campaign select", () => {
    expect(CAMPAIGN).toContain("import a CSV");
    // The capability being named, proven to exist.
    expect(PROSPECTS).toContain('htmlFor="imp-campaign"');
    expect(PROSPECTS).toContain('name="campaign_id"');
  });

  it("names the Details tab — which really does have a Campaign select", () => {
    expect(CAMPAIGN).toContain("<strong>Campaign</strong>");
    expect(CAMPAIGN).toContain("<strong>Details</strong>");
    expect(WORKSPACE).toContain('htmlFor="ep-campaign"');
  });

  it("and there is still no bulk campaign assignment to point at", () => {
    // If one is ever added, this fails and the copy should name it — it would
    // be the fastest route of the three.
    expect(BULK).toContain('value="archive"');
    expect(BULK).toContain('value="delete"');
    expect(BULK).not.toContain("campaign");
  });
});

describe("empty states that named a destination now link to it", () => {
  it("the outreach queue links to a prospect worth drafting for", () => {
    expect(INBOX).toContain("The queue is empty.");
    expect(INBOX).toContain("/growth/prospects?stage=ready_to_send&sort=score");
  });

  it("the research-dependent panel links to the leads that need researching", () => {
    expect(ANALYTICS).toContain("/growth/prospects?stage=to_research");
  });

  it("the tone table links to sending a first touch", () => {
    expect(ANALYTICS).toContain("Send a first touch");
    expect(ANALYTICS).toContain("/growth/prospects?stage=ready_to_send&sort=score");
  });

  it("every stage filter used in these links is a real bucket", () => {
    // A link to a bucket that doesn't resolve silently shows the whole
    // database — the defect fixed in the Jarvis panel. Don't reintroduce it.
    const used = [
      ...INBOX.matchAll(/stage=([a-z_]+)/g),
      ...ANALYTICS.matchAll(/stage=([a-z_]+)/g),
      ...CAMPAIGN.matchAll(/stage=([a-z_]+)/g),
    ].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    const QUERY = read("lib", "growth", "prospect-query.ts");
    for (const bucket of new Set(used)) {
      expect(QUERY, `stage=${bucket} is not a real bucket`).toContain(`${bucket}:`);
    }
  });
});

describe("the empty states that were already right are untouched", () => {
  it("a clean-pipeline state still reads as success, not as a task", () => {
    const DASH = read("app", "growth", "(app)", "page.tsx");
    expect(DASH).toContain("Nothing overdue — clean pipeline.");
    expect(DASH).toContain("Nothing due today.");
  });

  it("the filtered-prospects state still offers its clear link", () => {
    expect(PROSPECTS).toContain("No prospects match your search or filters.");
    expect(PROSPECTS).toContain("Clear them");
  });

  it("the call list still explains what fills it", () => {
    const CALL = read("app", "growth", "(app)", "call-list", "page.tsx");
    expect(CALL).toContain("Nothing left to call");
  });

  it("nothing was removed from the campaign page but the wrong sentence", () => {
    expect(CAMPAIGN).toContain("Prospects in this campaign");
    expect(CAMPAIGN).toContain("Filter view →");
    expect(CAMPAIGN).toContain("Showing the first 50 of");
  });
});
