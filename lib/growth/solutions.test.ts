import { describe, it, expect } from "vitest";
import { SOLUTION_CATALOG } from "@/lib/growth/solutions";
import { ANGLE_TERMS } from "@/lib/growth/news";

/**
 * The sales catalog and the LinkedIn story angles, guarded against a
 * HALF-rename.
 *
 * The *IQ rebrand matched full product names ("Review Agent", "Instant Quote
 * Agent") and missed every shorthand form the codebase also used —
 * "Speed-to-Lead", "AI Logistics", "Instant Quote", "+ CRM", "Website with
 * Lead Capture". Those shorthands live in exactly the wrong places: the sales
 * catalog the research engine pitches from, the savings calculator on the
 * public site, and the LinkedIn caption prompt whose output Jude posts under
 * his own name. The result was posts and proposals reading "Speed-to-Lead,
 * ReputationIQ, QuoteIQ, AI Logistics" — half one brand, half the other.
 *
 * A rename that lands in nine of eleven places is worse than not renaming at
 * all: it reads as carelessness to the exact audience it was meant to impress.
 * This pins it so the next rename can't half-land either.
 */

/** Names retired by the *IQ rebrand. None may survive in brand-facing copy. */
const RETIRED = [
  "Review Agent",
  "Website Agent",
  "AI Assistant",
  "Content Agent",
  "Instant Quote Agent",
  "Instant Quote",
  "CRM Agent",
  "Speed-to-Lead Agent",
  "Speed-to-Lead",
  "Voice Agent",
  "Instagram DM Setter",
  "AI Logistics Control Centre",
  "Logistics Control Centre",
  "AI Logistics",
  "Website with Lead Capture",
  "Website & Lead Capture",
  "TradeOS",
];

/**
 * Service CATEGORIES, not products — correctly not IQ-branded. A category
 * describes a body of work Jude sells; only a named product carries the brand.
 */
const CATEGORY_NAMES = new Set([
  "AI Receptionist",
  "Voice AI",
  "Workforce Management",
  "Asset Management",
  // Both forms are in use and both are correct: the catalog carries the long
  // label (it's a proposal line item), the LinkedIn angles the short one (it's
  // a caption tag). A pre-existing wording difference, not rebrand damage.
  "Health, Safety & Compliance (incl. SOP management)",
  "Health, Safety & Compliance",
  "Finance & Invoice Automation",
  "ERP Platform",
  "Business Operations Platform",
  "Bespoke AI Software",
]);

describe("solution catalog branding", () => {
  it("carries no retired product name", () => {
    const offenders: string[] = [];
    for (const s of SOLUTION_CATALOG) {
      for (const old of RETIRED) {
        if (s.name.includes(old)) offenders.push(`${s.key} → "${s.name}" (${old})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every entry is either an IQ product or a named service category", () => {
    const offenders = SOLUTION_CATALOG.filter(
      (s) => !s.name.endsWith("IQ") && !CATEGORY_NAMES.has(s.name)
    ).map((s) => `${s.key} → "${s.name}"`);
    expect(offenders).toEqual([]);
  });

  it("keys are stable — the rebrand must never touch them", () => {
    // Stored research reports and proposals reference solutions; the key is
    // the durable identifier, the name is copy.
    for (const s of SOLUTION_CATALOG) {
      expect(s.key).toMatch(/^[a-z0-9-]+$/);
      expect(s.key).not.toMatch(/IQ/);
    }
  });

  it("every solution has a blurb, so a renamed product still explains itself", () => {
    // "SiteIQ" means nothing to a stranger on its own — the blurb is what
    // carries "website with lead capture" into a proposal.
    for (const s of SOLUTION_CATALOG) {
      expect(s.blurb.length, s.key).toBeGreaterThan(20);
    }
  });
});

describe("LinkedIn story angles", () => {
  it("carry no retired product name", () => {
    const offenders: string[] = [];
    for (const a of ANGLE_TERMS) {
      for (const old of RETIRED) {
        if (a.angle.includes(old)) offenders.push(`"${a.angle}" (${old})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every angle is an IQ product or a named service category", () => {
    const offenders = ANGLE_TERMS.filter(
      (a) => !a.angle.endsWith("IQ") && !CATEGORY_NAMES.has(a.angle)
    ).map((a) => a.angle);
    expect(offenders).toEqual([]);
  });
});
