/**
 * Where a signed-in account actually belongs.
 *
 * This exists because the old answer was a guess that could loop forever.
 * requireSession() sent anyone without a business_id to /admin, and
 * requireAdmin() sent anyone who wasn't an admin to /portal. For an account
 * with role='customer' and no business_id, those two are a cycle:
 *
 *     /portal → requireSession → /admin → requireAdmin → /portal → …
 *
 * The browser stops it with ERR_TOO_MANY_REDIRECTS. requireAdmin's escape
 * hatch — role === 'growth' → /growth — can never fire, because the CHECK
 * constraint on profiles.role only permits 'admin' and 'customer'.
 *
 * That account shape is not hypothetical or rare. TradeIQ and Finance both
 * have self-serve signup, and the auth trigger creates exactly this profile
 * when no business_id is supplied in the user metadata. So every TradeIQ or
 * Finance customer who reaches /portal hits the loop — including from the main
 * /login form, which defaults to /portal after a successful sign-in.
 *
 * Kept pure and separate from the lookups so the routing table itself is
 * testable without a database or a request context.
 */

export type HomeRouteFlags = {
  role: string | null | undefined;
  businessId: string | null | undefined;
  isGrowthMember: boolean;
  hasTradesAccount: boolean;
};

/**
 * Order matters, and each step is a deliberate choice:
 *
 * 1. A portal business wins first. A trades_accounts row is NOT proof of a
 *    trades customer — requireTradesAccount() CREATES one on first visit, so a
 *    portal customer who once clicked into /tradeiq has a shell row forever.
 *    Checking the business first stops that shell from hijacking their home.
 * 2. Admin next: platform staff.
 * 3. Growth team: the internal sales workspace.
 * 4. A real trades/finance account.
 * 5. Otherwise the account is signed in with nowhere to be — a terminal page,
 *    never another guarded route, so a wrong answer here can't become a loop.
 */
export function resolveHomeRoute(flags: HomeRouteFlags): string {
  if (flags.businessId) return "/portal";
  if (flags.role === "admin") return "/admin";
  if (flags.isGrowthMember) return "/growth";
  if (flags.hasTradesAccount) return "/tradeiq";
  return "/account-unavailable";
}
