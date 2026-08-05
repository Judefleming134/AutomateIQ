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
export const KNOWN_SEGMENTS = new Set([
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

  // THE BRAND NAMES THAT ARE NOT ROUTE FOLDERS.
  //
  // These are redirect sources in next.config.ts pointing at the public
  // product pages. They belong here so /FinanceIQ, /PlanIQ, /QuoteIQ — the
  // forms actually printed on a card — get lowercased first and then land on
  // the redirect.
  //
  // This list was the reason #585 only half worked. That change gave every
  // product a vanity URL and added one explicit brand-cased redirect each
  // (/quoteIQ, /siteIQ, …), on the stated belief that "there is no middleware
  // in this app". There is: proxy.ts (Next 16's rename of the middleware
  // convention) calls canonicalPath() on any path whose first segment carries
  // a capital. So the general mechanism existed, and the eight new names were
  // simply missing from ITS list — which is why /quoteIQ worked afterwards but
  // /QuoteIQ and /QUOTEIQ still 404'd. Adding them here covers every casing;
  // the explicit redirects stay as a one-hop fast path.
  "assetiq",
  "assistiq",
  "clientiq",
  "contentiq",
  "customiq",
  "financeiq",
  "leadiq",
  // permitiq is kept alongside planiq: PermitIQ was the public name until
  // 2026-08-05 and is on cards, in signatures and in sent emails.
  "permitiq",
  "planiq",
  "quoteiq",
  "reputationiq",
  "siteiq",
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
