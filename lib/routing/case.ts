/**
 * Case-forgiving URLs for the brand names.
 *
 * Next.js routes are case-sensitive. The products are written **TradeIQ**,
 * **PermitIQ**, **FinanceIQ** — with capitals — on business cards, in email
 * signatures and out loud on a call. So the single most likely thing a new
 * customer types is `automateiq.ie/TradeIQ`, and until now that was a 404.
 *
 * THE PART THAT NEEDS CARE: only the FIRST path segment is lowercased, never
 * the whole path. `/tradeiq/doc/AbC123xyz` carries a signed token, and tokens
 * are case-sensitive — lowercasing the path would silently break every invoice
 * and quote link a tradesperson has emailed to their own customer. Same for
 * `/q/<token>` and `/b/<slug>`. The segment is only rewritten when its
 * lowercase form is a route we actually have, so a genuine 404 still 404s
 * instead of bouncing somewhere confusing.
 */

/** Top-level segments that exist as routes. Redirect targets, nothing else. */
const KNOWN_SEGMENTS = new Set([
  "account-unavailable",
  "admin",
  "auth",
  "b",
  "book",
  "demo",
  "embed",
  "finance",
  "freetools",
  "growth",
  "leaving",
  "login",
  "portal",
  "products",
  "q",
  "savings",
  "setup",
  "systems",
  "tradeiq",
]);

/**
 * Returns the corrected path when the first segment differs only by case,
 * or null when there is nothing to do.
 *
 * `/api` is deliberately excluded: an API client that gets a redirect instead
 * of a response is a debugging session nobody enjoys, and machines don't
 * mistype capitals off a business card.
 */
export function canonicalPath(pathname: string): string | null {
  if (!pathname.startsWith("/")) return null;
  if (pathname.startsWith("/api") || pathname.startsWith("/_next")) return null;

  const segments = pathname.split("/");
  const first = segments[1];
  if (!first) return null;

  // Nothing to fix if it's already lowercase.
  const lower = first.toLowerCase();
  if (first === lower) return null;

  // Only rewrite toward a route that exists. An unknown segment stays a 404 —
  // silently redirecting /Nonsense to /nonsense helps nobody.
  if (!KNOWN_SEGMENTS.has(lower)) return null;

  segments[1] = lower;
  return segments.join("/");
}
