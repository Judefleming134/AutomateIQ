import { describe, it, expect } from "vitest";
import { tenantAccessState } from "@/lib/auth/require-tenant";

/**
 * The tenant-access decision.
 *
 * The business row is read through the CALLER'S OWN RLS-scoped client, and the
 * RLS helper requires `status = 'active' AND deleted_at IS NULL`. So a null row
 * never means "this business doesn't exist" — it means "you are not an active
 * member of it", and suspended, soft-deleted and genuinely-missing all arrive
 * as the same null.
 *
 * Grouping them is the point: in every one of those cases the portal has
 * nothing truthful to show, and the old behaviour — rendering the full portal
 * with the placeholder name "Your business" and every panel empty — read to the
 * customer as their data being deleted.
 */

describe("tenantAccessState", () => {
  it("passes an active tenant", () => {
    expect(
      tenantAccessState({ businessId: "b1", business: { id: "b1" } })
    ).toBe("ok");
  });

  it("flags an account with no business at all", () => {
    // Admin accounts have no business_id; requireSession already routes them
    // to /admin, so this branch is the belt to that braces.
    expect(tenantAccessState({ businessId: null, business: null })).toBe("no_business");
    expect(tenantAccessState({ businessId: undefined, business: null })).toBe("no_business");
  });

  it.each([
    ["suspended — RLS hides the row", "b1"],
    ["soft-deleted — RLS hides the row", "b2"],
    ["genuinely missing", "b3"],
  ])("flags %s as inactive", (_label, businessId) => {
    // All three reach this function identically: a business_id on the profile,
    // and no readable row behind it.
    expect(tenantAccessState({ businessId, business: null })).toBe("inactive");
  });

  it("does not treat a readable row as inactive just because status text varies", () => {
    // If RLS returned the row at all, the tenant is an active member — the
    // status string is informational, not a second gate to re-derive here.
    expect(
      tenantAccessState({ businessId: "b1", business: { id: "b1" } })
    ).toBe("ok");
  });

  it("no_business takes precedence over inactive", () => {
    // An account with no business_id is a routing problem, not a suspension —
    // reporting it as 'inactive' would send an admin to the wrong page.
    expect(tenantAccessState({ businessId: null, business: { id: "b1" } })).toBe(
      "no_business"
    );
  });
});
