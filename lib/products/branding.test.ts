import { describe, it, expect } from "vitest";
import { PRODUCT_REGISTRY, PRODUCT_FAMILIES } from "@/lib/products/registry";

/**
 * The *IQ branding, guarded.
 *
 * Every product carries the IQ suffix so the platform reads as one family
 * rather than a bag of "… Agent" tools. This test exists because the rename is
 * a DISPLAY change sitting on top of frozen entitlement keys, and the two must
 * never be confused: `key` is joined by `business_products`, so renaming one
 * silently strips the product from every customer who has it. `name` is copy
 * and can change any day.
 *
 * If a new product is added without the suffix, this fails before the portal
 * ships a tile that looks like it belongs to a different company.
 */

/**
 * No exemptions. Jude's call on 2026-07-31: EVERY product carries the IQ
 * suffix. I had argued for leaving "Custom Solutions" alone — that "CustomIQ"
 * implies an off-the-shelf module — and he overrode it, so the exemption set is
 * empty and stays empty. An exemption here is how a brand starts drifting.
 */
const EXEMPT = new Set<string>([]);

describe("product branding", () => {
  it("every product name ends in IQ", () => {
    const offenders = PRODUCT_REGISTRY.filter(
      (p) => !EXEMPT.has(p.key) && !p.name.endsWith("IQ")
    ).map((p) => `${p.key} → "${p.name}"`);
    expect(offenders).toEqual([]);
    // And the exemption door stays shut.
    expect(EXEMPT.size).toBe(0);
  });

  it("every family label carries the IQ brand", () => {
    // `includes`, not `endsWith`: the platform layer is "AutomateIQ Core",
    // which is correct as it stands — it is the core OF AutomateIQ, not a
    // vertical product called CoreIQ. The industry families (TradeIQ,
    // FinanceIQ, PermitIQ, ReputationIQ) do end in IQ, and the assertion below
    // still catches a family added with no brand at all.
    for (const f of PRODUCT_FAMILIES) {
      expect(f.label.includes("IQ"), `${f.key} → "${f.label}"`).toBe(true);
    }
  });

  it("every vertical family (i.e. not core) ends in IQ", () => {
    for (const f of PRODUCT_FAMILIES.filter((x) => x.key !== "core")) {
      expect(f.label.endsWith("IQ"), `${f.key} → "${f.label}"`).toBe(true);
    }
  });

  it("no product still carries the old '… Agent' naming", () => {
    const stale = PRODUCT_REGISTRY.filter((p) => /\bAgent\b/.test(p.name));
    expect(stale.map((p) => p.name)).toEqual([]);
  });

  it("the rename did NOT touch entitlement keys", () => {
    // The whole point: keys are the contract with business_products, names are
    // decoration. A key that drifted toward the new branding would revoke the
    // product from every customer holding it.
    expect(PRODUCT_REGISTRY.map((p) => p.key).sort()).toEqual(
      [
        "ai-assistant",
        "content-agent",
        "crm-agent",
        "custom-solutions",
        "instant-quote-agent",
        "permitiq",
        "review-agent",
        "speed-to-lead-agent",
        "website-agent",
      ].sort()
    );
  });

  it("routes are unchanged, so no customer bookmark breaks", () => {
    // Same reasoning as the keys: /portal/review-agent is linked from emails
    // and saved in browsers. Branding lives above the URL, not in it.
    const byKey = Object.fromEntries(PRODUCT_REGISTRY.map((p) => [p.key, p.href]));
    expect(byKey["review-agent"]).toBe("/portal/review-agent");
    expect(byKey["ai-assistant"]).toBe("/portal/ai-assistant");
    expect(byKey["speed-to-lead-agent"]).toBe("/portal/speed-to-lead-agent");
  });

  it("names are unique — two tiles must not read the same", () => {
    const names = PRODUCT_REGISTRY.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
