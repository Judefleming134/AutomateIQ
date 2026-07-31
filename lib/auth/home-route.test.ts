import { describe, it, expect } from "vitest";
import { resolveHomeRoute } from "@/lib/auth/home-route";

/**
 * The routing table that replaced an infinite redirect.
 *
 * requireSession sent anyone without a business_id to /admin; requireAdmin
 * sent anyone who wasn't an admin to /portal. For role='customer' with no
 * business_id those two are a cycle, and the browser ends it with
 * ERR_TOO_MANY_REDIRECTS.
 *
 * That shape is what TradeIQ and Finance self-serve signup produces, so the
 * loop was reachable by any of their customers landing on /portal — including
 * straight from the main /login form, which defaults to /portal.
 */

const base = {
  role: "customer" as string | null,
  businessId: null as string | null,
  isGrowthMember: false,
  hasTradesAccount: false,
};

describe("resolveHomeRoute", () => {
  it("THE LOOP: a trades/finance signup no longer bounces between /portal and /admin", () => {
    // role='customer', no business_id, and a trades account — exactly what the
    // auth trigger plus TradeIQ signup produces.
    expect(resolveHomeRoute({ ...base, hasTradesAccount: true })).toBe("/tradeiq");
  });

  it("sends a portal customer to /portal", () => {
    expect(resolveHomeRoute({ ...base, businessId: "b1" })).toBe("/portal");
  });

  it("sends a platform admin to /admin", () => {
    expect(resolveHomeRoute({ ...base, role: "admin" })).toBe("/admin");
  });

  it("sends a growth team member to /growth", () => {
    expect(resolveHomeRoute({ ...base, isGrowthMember: true })).toBe("/growth");
  });

  it("a business always wins over an auto-created trades shell", () => {
    // requireTradesAccount() CREATES a trades_accounts row on first visit, so
    // a portal customer who once clicked into /tradeiq has one forever.
    // Without this precedence that shell would hijack their home permanently.
    expect(
      resolveHomeRoute({ ...base, businessId: "b1", hasTradesAccount: true })
    ).toBe("/portal");
  });

  it("an admin who has also been provisioned into the growth team goes to /admin", () => {
    expect(
      resolveHomeRoute({ ...base, role: "admin", isGrowthMember: true })
    ).toBe("/admin");
  });

  it("lands a homeless account on a TERMINAL page, never another guarded route", () => {
    // The property that makes a wrong answer here survivable: every fallback
    // must be a page that runs no guard of its own, so it can never redirect
    // onward and re-form a cycle.
    expect(resolveHomeRoute(base)).toBe("/account-unavailable");
  });

  it("never returns /admin for a non-admin, which was the loop's other leg", () => {
    const nonAdmins = [
      { ...base },
      { ...base, hasTradesAccount: true },
      { ...base, isGrowthMember: true },
      { ...base, businessId: "b1" },
      { ...base, role: null },
      { ...base, role: undefined },
    ];
    for (const flags of nonAdmins) {
      expect(resolveHomeRoute(flags)).not.toBe("/admin");
    }
  });

  it("always returns an absolute in-app path", () => {
    const combos = [true, false].flatMap((g) =>
      [true, false].flatMap((t) =>
        ["admin", "customer", null].flatMap((role) =>
          [null, "b1"].map((businessId) => ({
            role,
            businessId,
            isGrowthMember: g,
            hasTradesAccount: t,
          }))
        )
      )
    );
    for (const flags of combos) {
      const route = resolveHomeRoute(flags);
      expect(route.startsWith("/")).toBe(true);
      expect(route).not.toContain("//");
    }
  });
});
