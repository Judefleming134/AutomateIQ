import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { splitKnownKeys, entitlementNotice } from "./entitlements";

/**
 * Assigning products to a business — the write that decides what a paying
 * customer sees when they log in.
 *
 * Both callers discarded the result:
 *
 *     await supabase.from("business_products").insert(...)   // error dropped
 *     return { ok: true };
 *
 * So the two worst outcomes were invisible. Jude onboards a customer, ticks
 * the four products they bought, sees "Customer created" — and the customer
 * logs in to an empty portal. Or a Custom Solutions module is created while
 * the entitlement that makes it reachable silently is not, leaving a module
 * nobody can open.
 *
 * `products.key` is the entitlement foreign key, so a key that has been
 * renamed resolves to nothing and takes its product with it — quietly.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");

describe("which keys actually resolved", () => {
  it("separates the ones that exist from the ones that don't", () => {
    const r = splitKnownKeys(
      ["review-agent", "renamed-key", "website-agent"],
      [{ key: "review-agent" }, { key: "website-agent" }]
    );
    expect(r.known).toEqual(["review-agent", "website-agent"]);
    expect(r.unknown).toEqual(["renamed-key"]);
  });

  it("reports everything unknown when the lookup finds nothing", () => {
    const r = splitKnownKeys(["a", "b"], []);
    expect(r.known).toEqual([]);
    expect(r.unknown).toEqual(["a", "b"]);
  });

  it("does not double-count a key ticked twice", () => {
    const r = splitKnownKeys(["a", "a", "b"], [{ key: "a" }]);
    expect(r.known).toEqual(["a"]);
    expect(r.unknown).toEqual(["b"]);
  });

  it("preserves the order the admin chose", () => {
    const r = splitKnownKeys(["z", "y", "x"], [{ key: "x" }, { key: "z" }]);
    expect(r.known).toEqual(["z", "x"]);
  });

  it("handles an empty request", () => {
    expect(splitKnownKeys([], [{ key: "a" }])).toEqual({ known: [], unknown: [] });
  });
});

describe("what the admin is told", () => {
  it("says nothing at all when everything landed", () => {
    // A notice that fires on success is noise, and noise gets ignored on the
    // day it matters.
    expect(entitlementNotice({ assigned: ["a", "b"], unknown: [], error: null })).toBe("");
  });

  it("names the keys that were skipped", () => {
    const n = entitlementNotice({ assigned: ["a"], unknown: ["ghost-key"], error: null });
    expect(n).toContain("ghost-key");
    expect(n).toContain("Products tab");
  });

  it("gets the singular and plural right", () => {
    expect(entitlementNotice({ assigned: ["a"], unknown: ["x"], error: null })).toContain(
      "1 product,"
    );
    expect(entitlementNotice({ assigned: ["a", "b"], unknown: ["x", "y"], error: null })).toContain(
      "2 products,"
    );
  });

  it("tells the admin not to hand the account over when the write failed", () => {
    const n = entitlementNotice({ assigned: [], unknown: [], error: "permission denied" });
    expect(n).toContain("permission denied");
    expect(n).toMatch(/before telling them it's ready/);
  });
});

describe("both callers are wired to it", () => {
  const CUSTOMERS = readFileSync(
    path.join(ROOT, "app", "admin", "customers", "actions.ts"),
    "utf8"
  );
  const MODULES = readFileSync(
    path.join(ROOT, "app", "admin", "modules", "actions.ts"),
    "utf8"
  );

  it("createCustomer assigns through the shared helper", () => {
    expect(CUSTOMERS).toContain("assignProducts(supabase, business.id, productKeys)");
  });

  it("createCustomer no longer discards the write", () => {
    expect(CUSTOMERS).not.toMatch(/await supabase\.from\("business_products"\)\.insert/);
  });

  it("createCustomer surfaces the outcome instead of a bare ok", () => {
    expect(CUSTOMERS).toContain("entitlementNotice(entitlements)");
  });

  it("the audit log records what was assigned, not what was asked for", () => {
    // An audit log that records the intention rather than the outcome is
    // worse than none.
    expect(CUSTOMERS).toContain("products: entitlements.assigned");
    expect(CUSTOMERS).not.toMatch(/metadata: \{ businessName, email, products: productKeys \}/);
  });

  it("createModule enables Custom Solutions through the same helper", () => {
    expect(MODULES).toContain('assignProducts(supabase, businessId, ["custom-solutions"])');
  });

  it("createModule warns when the module would not be reachable", () => {
    // The comment there already stated the consequence; the code just wasn't
    // acting on it.
    expect(MODULES).toMatch(/entitlements\.assigned\.length === 0/);
    expect(MODULES).toContain("can't open it yet");
  });
});
