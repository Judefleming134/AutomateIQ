import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PRODUCT_FAMILIES } from "@/lib/products/registry";
import { PROOF } from "@/lib/proof";

/**
 * The homepage, guarded against drift.
 *
 * `public/index.html` is a hand-built static file outside the Next app. That is
 * a deliberate trade — see the note at the bottom of docs/SITE-MAP.md — but it
 * has one real cost: the app cannot reach it, so every codebase-wide change
 * misses it silently. That has now happened TWICE. The *IQ rebrand skipped it
 * because that pass only touched .ts/.tsx, and demo.html sat there for weeks
 * showing pre-rebrand product names to anyone with the URL.
 *
 * This is the fix that actually addresses the cause: the front page can stay
 * hand-crafted, but it can no longer disagree with the platform in silence. CI
 * runs this on every pull request, so the failure arrives in a diff instead of
 * in front of a customer.
 *
 * It deliberately checks FACTS, not design. Nothing here constrains layout,
 * copy or styling — only that the page tells the truth about what exists.
 */

const HTML = readFileSync(
  path.resolve(import.meta.dirname, "..", "public", "index.html"),
  "utf8"
);

/** Names retired by the rebrand. None may reappear on the front page. */
const RETIRED = [
  "TradeOS",
  "Review Agent",
  "Website Agent",
  "AI Assistant",
  "Content Agent",
  "Instant Quote Agent",
  "CRM Agent",
  "Speed-to-Lead",
  "Voice Agent",
  "Instagram DM Setter",
  "AI Logistics",
  "Custom Solutions",
];

describe("homepage — branding cannot drift", () => {
  it("shows no retired product name", () => {
    const found = RETIRED.filter((n) => HTML.includes(n));
    expect(found).toEqual([]);
  });

  it("names every product family the platform actually has", () => {
    // If a new vertical is added to the registry, the front page has to
    // acknowledge it. This is the check that would have caught PermitIQ being
    // invisible on the homepage for a day.
    const missing = PRODUCT_FAMILIES.filter((f) => !HTML.includes(f.label)).map(
      (f) => f.label
    );
    expect(missing).toEqual([]);
  });
});

describe("homepage — the proof point matches lib/proof.ts", () => {
  it("quotes the same jobs figure as every other surface", () => {
    // A prospect who reads one number in a cold email and another on the site
    // stops believing both.
    expect(HTML).toContain(PROOF.jobsProcessedLabel);
  });

  it("quotes the same revenue lift", () => {
    expect(HTML).toContain(PROOF.revenueLiftLabel);
  });

  it("names and links the client, so the claim is checkable", () => {
    expect(HTML).toContain(PROOF.client);
    expect(HTML).toContain(PROOF.clientUrl);
  });
});

describe("homepage — the conversion path exists", () => {
  it("sends people to the booking page", () => {
    expect(HTML).toContain('href="/book"');
  });

  it("sends people to the free tools", () => {
    expect(HTML).toContain('href="/freetools"');
  });

  it("has a pricing section, even though there is no price list", () => {
    // "We don't publish prices" is a position. Having no pricing section at all
    // is an omission, and buyers read the two very differently.
    expect(HTML).toContain('id="pricing"');
  });

  it("does not describe itself as pre-launch", () => {
    // The waitlist framing ("ahead of launch", "when we open the doors") was
    // costing bookings while the product was live and taking payments.
    const preLaunch = ["ahead of launch", "when we open the doors", "Request access"];
    expect(preLaunch.filter((p) => HTML.includes(p))).toEqual([]);
  });
});

describe("homepage — structural integrity", () => {
  it("has balanced section, div and anchor tags", () => {
    // A hand-edited 140KB file is exactly where an unclosed tag hides. Cheap to
    // check, and it has already caught a malformed anchor once.
    const count = (re: RegExp) => (HTML.match(re) ?? []).length;
    expect(count(/<section[\s>]/g)).toBe(count(/<\/section>/g));
    expect(count(/<div[\s>]/g)).toBe(count(/<\/div>/g));
    expect(count(/<a[\s>]/g)).toBe(count(/<\/a>/g));
    expect(count(/<p[\s>]/g)).toBe(count(/<\/p>/g));
  });

  it("numbers its sections sequentially with no gap or repeat", () => {
    // Inserting a section mid-page has twice left a duplicate number behind.
    const nums = [...HTML.matchAll(/<span class="num">(\d{2})<\/span>/g)].map((m) =>
      Number(m[1])
    );
    expect(nums.length).toBeGreaterThan(0);
    expect(nums).toEqual(nums.map((_, i) => i + 1));
  });

  it("every in-page anchor points at a section that exists", () => {
    const targets = [...HTML.matchAll(/href="#([a-z-]+)"/g)].map((m) => m[1]);
    const broken = [...new Set(targets)].filter(
      (t) => t !== "top" && !HTML.includes(`id="${t}"`)
    );
    expect(broken).toEqual([]);
  });
});
