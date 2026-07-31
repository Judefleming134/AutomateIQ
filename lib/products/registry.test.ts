import { describe, it, expect } from "vitest";
import {
  PRODUCT_REGISTRY,
  PRODUCT_FAMILIES,
  productsByFamily,
  getProductByKey,
} from "@/lib/products/registry";

/**
 * The product registry and its family grouping.
 *
 * `key` is an entitlement foreign key: `business_products` joins on it and
 * `guardProduct("review-agent")` is called across the codebase. Renaming one
 * silently revokes that product from every customer who has it, which is why
 * the vertical structure is a display-only `family` field.
 *
 * The frozen-keys test below is the guard on that. If someone "tidies up" a
 * key, this fails before it reaches a customer.
 */

/** The keys entitlements depend on. Changing this list is a data migration. */
const FROZEN_KEYS = [
  "ai-assistant",
  "content-agent",
  "crm-agent",
  "custom-solutions",
  "instant-quote-agent",
  "permitiq",
  "review-agent",
  "speed-to-lead-agent",
  "website-agent",
].sort();

describe("product keys are frozen", () => {
  it("has exactly the keys entitlements are written against", () => {
    expect(PRODUCT_REGISTRY.map((p) => p.key).sort()).toEqual(FROZEN_KEYS);
  });

  it("every key is unique", () => {
    const keys = PRODUCT_REGISTRY.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("getProductByKey resolves every registered key", () => {
    for (const key of FROZEN_KEYS) {
      expect(getProductByKey(key)?.key).toBe(key);
    }
    expect(getProductByKey("no-such-product")).toBeUndefined();
  });
});

describe("productsByFamily", () => {
  const groups = productsByFamily();

  it("renders every product exactly once — none lost in the grouping", () => {
    const flat = groups.flatMap((g) => g.products.map((p) => p.key));
    expect(flat.sort()).toEqual(FROZEN_KEYS);
  });

  it("never renders a product twice", () => {
    const flat = groups.flatMap((g) => g.products.map((p) => p.key));
    expect(new Set(flat).size).toBe(flat.length);
  });

  it("drops empty families rather than rendering placeholder sections", () => {
    for (const g of groups) expect(g.products.length).toBeGreaterThan(0);
    // PermitIQ now has a product (coming_soon), so its family renders.
    // FinanceIQ still has none and must not appear at all.
    expect(groups.map((g) => g.family.key)).toContain("permitiq");
    expect(groups.map((g) => g.family.key)).not.toContain("financeiq");
  });

  it("preserves the hand-tuned registry order inside each family", () => {
    for (const g of groups) {
      const expected = PRODUCT_REGISTRY.filter((p) => p.family === g.family.key).map((p) => p.key);
      expect(g.products.map((p) => p.key)).toEqual(expected);
    }
  });

  it("follows the declared family render order", () => {
    const declared = PRODUCT_FAMILIES.map((f) => f.key);
    const rendered = groups.map((g) => g.family.key);
    expect(rendered).toEqual(declared.filter((k) => rendered.includes(k)));
  });

  it("assigns every product to a declared family", () => {
    const declared = new Set(PRODUCT_FAMILIES.map((f) => f.key));
    for (const p of PRODUCT_REGISTRY) expect(declared.has(p.family)).toBe(true);
  });

  it("every family carries a label and tagline for the portal heading", () => {
    for (const f of PRODUCT_FAMILIES) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.tagline.length).toBeGreaterThan(0);
    }
  });
});
